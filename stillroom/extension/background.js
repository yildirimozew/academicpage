"use strict";

importScripts("deepseek.js", "stories.js");

const siteOrigins = new Set([
  "https://stillroom-instagram-digest.mildtitan4.chatgpt.site",
  "https://stillroom.yildirimozen.com",
]);
const feedUrl = "https://www.instagram.com/";
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const limit = 4;
const maxImageBytes = 750_000;
const stopWords = new Set(
  "a an all about at can catch check could daily digest find for from get give i instagram latest me my new of on please post posts see show the this today todays up want what whats would you".split(" ")
);
const topicWords = new Map([
  ["hiking", ["hike", "hiking", "trail", "trek"]],
  ["photography", ["photography", "photographer", "camera", "portrait"]],
]);

let activeCheck;

function trustedSender(sender) {
  if (sender.frameId !== 0 || !sender.url) return false;
  const url = new URL(sender.url);
  if (url.origin === "https://yildirimozen.com") {
    return ["/stillroom/", "/stillroom/index.html"].includes(url.pathname);
  }
  return siteOrigins.has(url.origin) && ["/", "/index.html"].includes(url.pathname);
}

chrome.runtime.onMessageExternal.addListener((request, sender, reply) => {
  if (!trustedSender(sender) || !["status", "ask"].includes(request?.action)) return false;
  if (request.action === "ask" &&
      (typeof request.query !== "string" || !request.query.trim() || request.query.length > 250)) return false;

  const operation = request.action === "status" ? status() : ask(request.query);
  operation.then(reply, () => reply({ message: "Couldn’t read the saved digest. Try again." }));
  return true;
});

async function status() {
  const { deepseekKey } = await chrome.storage.local.get("deepseekKey");
  return { provider: deepseekKey ? "deepseek" : "local" };
}

function isClearRequest(query) {
  return /^(clear|delete) (?:my |the )?(?:saved posts|saved digest)$/i.test(query.trim());
}

async function ask(query) {
  if (isClearRequest(query)) {
    if (activeCheck) return { message: "Wait for the current check to finish before clearing saved posts." };
    await chrome.storage.local.remove("digest");
    return { message: "Saved posts cleared." };
  }

  if (activeCheck) return { message: "An Instagram check is already running." };

  activeCheck = run(query);
  try {
    return await activeCheck;
  } finally {
    activeCheck = undefined;
  }
}

async function run(query) {
  const { deepseekKey } = await chrome.storage.local.get("deepseekKey");

  try {
    const candidates = await collect(query);
    const result = await choosePosts(candidates, query, deepseekKey);
    const posts = await Promise.all(result.posts.map(async ({ imageUrl, ...post }) => {
      const image = await readImage(imageUrl).catch(() => null);
      return { ...post, image };
    }));
    await chrome.storage.local.set({ digest: { posts } });
    return present(posts, result);
  } catch (error) {
    const message = error instanceof FeedError ? error.message : "Instagram didn’t load in time. Try again.";
    return { message };
  }
}

async function choosePosts(posts, query, apiKey) {
  if (apiKey && posts.length) {
    try {
      return await summarizeWithDeepSeek(posts, query, apiKey, limit);
    } catch (error) {
      return { posts: select(posts, query), fallback: error instanceof DeepSeekError ? error.message : "DeepSeek didn’t respond." };
    }
  }
  return { posts: select(posts, query) };
}

function present(posts, { summary, fallback }) {
  if (summary) return { message: summary, posts };
  const response = describeResults(posts);
  if (fallback) response.message = fallback + " Used local matching. " + response.message;
  return response;
}

function describeResults(posts) {
  if (!posts.length) {
    return { message: "Nothing in the posts I checked matched that request." };
  }

  const noun = posts[0].kind === "story" ? (posts.length === 1 ? "story" : "stories") : (posts.length === 1 ? "post" : "posts");
  const count = posts.length + " " + noun;
  return { message: "Found " + count + ".", posts };
}

function select(posts, prompt) {
  const query = prompt.toLowerCase().replace(/[’']/g, "");
  const stories = storyRequest(prompt);
  if (stories?.length) {
    return posts.filter((post) => stories.some(([account]) => post.handle === "@" + account)).slice(0, limit);
  }
  if (stories) return posts.slice(0, limit);
  const accounts = query.match(/@[a-z0-9_.]+/g)?.map((account) => account.replace(/\.+$/, "")) ?? [];
  const terms = query.replace(/@[a-z0-9_.]+/g, "").match(/[\p{L}\p{N}]+/gu)
    ?.filter((term) => !stopWords.has(term)) ?? [];

  return posts.filter((post) => {
    const handle = post.handle.toLowerCase();
    const searchable = (post.caption + " " + post.alt + " " + handle).toLowerCase();
    return (!accounts.length || accounts.includes(handle)) &&
      terms.every((term) => (topicWords.get(term) || [term]).some((word) => searchable.includes(word)));
  }).slice(0, limit);
}

class FeedError extends Error {}

async function collect(query) {
  const tab = await chrome.tabs.create({ url: feedUrl, active: false });
  try {
    await waitForLoad(tab.id);
    const stories = storyRequest(query);
    if (stories) {
      const posts = await collectStories(tab.id, stories);
      if (!posts.length) {
        const hint = stories.length ? "Check that the account has an active story you can see." : "Try asking for stories from a specific @account.";
        throw new FeedError("I couldn’t read any active Instagram stories. " + hint);
      }
      return posts;
    }

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scanFeed,
    });
    if (result?.result?.needsLogin) {
      throw new FeedError("Instagram needs a sign-in in this Chrome profile. Sign in, then try again.");
    }
    if (!result?.result?.posts?.length) {
      throw new FeedError("I couldn’t find readable posts in the Instagram feed. Try again.");
    }
    return result.result.posts;
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function waitForLoad(tabId) {
  const deadline = Date.now() + 13_000;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") {
      if (!tab.url?.startsWith(feedUrl)) throw new FeedError("Instagram opened a sign-in or verification page. Check your session, then try again.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new FeedError("Instagram didn’t load in time. Try again.");
}

// Runs inside the one inactive Instagram tab created by the extension.
async function scanFeed() {
  const posts = new Map();
  const looksSignedOut = () => /\/(accounts\/(login|onetap)|challenge|checkpoint)(\/|$)/.test(location.pathname) ||
    Boolean(document.querySelector('input[name="password"]'));

  for (let step = 0; step < 5 && posts.size < 12; step += 1) {
    if (looksSignedOut()) return { needsLogin: true };
    for (const article of document.querySelectorAll("main article, main [role=article], article")) {
      const links = [...article.querySelectorAll("a[href]")];
      const permalink = links.find((link) => /^\/(?:[\w.]+\/)?(?:p|reel)\/[\w-]+\/?$/.test(link.pathname));
      if (!permalink || posts.has(permalink.pathname)) continue;

      const profile = links.find((link) =>
        /^\/[\w.]+\/$/.test(link.pathname) &&
        !/^\/(p|reel|reels|explore|accounts|direct|stories)\/$/.test(link.pathname));
      const handle = profile ? "@" + profile.pathname.split("/")[1] : "";
      const image = [...article.querySelectorAll("img")].find((item) =>
        !item.closest("header") && item.naturalWidth >= 180 && item.naturalHeight >= 120);
      const caption = article.querySelector("h1, [data-testid='post-caption']")?.textContent.trim() ||
        findCaption(article, handle);
      if (!image && !caption) continue;

      posts.set(permalink.pathname, {
        handle,
        caption: caption.slice(0, 360),
        alt: (image?.alt || "").slice(0, 240),
        imageUrl: image?.currentSrc || "",
      });
      if (posts.size === 12) break;
    }
    if (step < 4 && posts.size < 12) {
      if (posts.size) window.scrollBy(0, Math.max(500, window.innerHeight * .85));
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return { posts: [...posts.values()] };

  function findCaption(article, handle) {
    if (!handle) return "";
    for (const link of article.querySelectorAll("a[href]")) {
      if (link.pathname.toLowerCase() !== "/" + handle.slice(1).toLowerCase() + "/") continue;
      let node = link.parentElement;
      for (let depth = 0; node && node !== article && depth < 4; depth += 1, node = node.parentElement) {
        const sibling = node.nextElementSibling;
        const text = sibling?.textContent.trim() || "";
        if (sibling?.matches("span, [dir=auto]") && text.length > 8 &&
            !/^(follow|original audio|suggested for you|view all|add a comment)/i.test(text)) return text;
      }
    }
    return "";
  }
}

async function readImage(source) {
  if (!source) return null;
  const url = new URL(source);
  if (url.protocol !== "https:" || !/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(url.hostname)) return null;

  const response = await fetch(url, {
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(5_000),
  });
  const type = response.headers.get("content-type")?.split(";")[0];
  if (!response.ok || !imageTypes.has(type) || !response.body) return null;

  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > maxImageBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  let binary = "";
  for (const chunk of chunks) {
    for (let offset = 0; offset < chunk.length; offset += 8192) {
      binary += String.fromCharCode(...chunk.subarray(offset, offset + 8192));
    }
  }
  return "data:" + type + ";base64," + btoa(binary);
}
