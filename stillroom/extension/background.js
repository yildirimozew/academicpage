"use strict";

importScripts("deepseek.js", "stories.js", "media.js");

const siteOrigins = new Set([
  "https://stillroom-instagram-digest.mildtitan4.chatgpt.site",
  "https://stillroom.yildirimozen.com",
]);
const feedUrl = "https://www.instagram.com/";
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const limit = 4;
const digestPrompt = "Summarize the important updates in the Instagram feed posts and Stories provided. Prioritize meaningful personal updates and useful information. Skip ads and engagement bait. Keep it brief. If the sample has no substantive updates, say so.";
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
  if (!trustedSender(sender) || !["status", "ask", "summarize"].includes(request?.action)) return false;
  if (request.action === "ask" &&
      (typeof request.query !== "string" || !request.query.trim() || request.query.length > 250)) return false;

  const overview = request.action === "summarize";
  const operation = request.action === "status" ? status() : ask(overview ? digestPrompt : request.query, overview);
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

async function ask(query, overview) {
  if (isClearRequest(query)) {
    if (activeCheck) return { message: "Wait for the current check to finish before clearing saved posts." };
    await chrome.storage.local.remove("digest");
    return { message: "Saved posts cleared." };
  }

  if (activeCheck) return { message: "An Instagram check is already running." };

  activeCheck = run(query, overview);
  try {
    return await activeCheck;
  } finally {
    activeCheck = undefined;
  }
}

async function run(query, overview) {
  const { deepseekKey } = await chrome.storage.local.get("deepseekKey");

  let tab;
  try {
    tab = await chrome.tabs.create({ url: feedUrl, active: false });
    const { candidates, note } = await collect(tab.id, query, overview, deepseekKey);
    const result = await choosePosts(candidates, query, deepseekKey, overview);
    const posts = [];
    for (const post of result.posts) posts.push(await resolvePostMedia(tab.id, post));
    await chrome.storage.local.set({ digest: { posts } });
    const response = present(posts, result);
    if (note) response.message += "\n\n" + note;
    return response;
  } catch (error) {
    const message = error instanceof FeedError ? error.message : "Instagram didn’t load in time. Try again.";
    return { message };
  } finally {
    if (tab?.id !== undefined) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function choosePosts(posts, query, apiKey, overview) {
  let fallback;
  if (apiKey && posts.length) {
    try {
      return await summarizeWithDeepSeek(posts, query, apiKey, limit);
    } catch (error) {
      fallback = error instanceof DeepSeekError ? error.message : "DeepSeek didn’t respond.";
    }
  }

  if (overview) {
    const feed = posts.filter((post) => post.kind !== "story");
    const stories = posts.filter((post) => post.kind === "story");
    const firstStories = stories.slice(0, limit / 2);
    const firstFeed = feed.slice(0, limit - firstStories.length);
    return {
      posts: [...firstFeed, ...stories.slice(0, limit - firstFeed.length)],
      summary: (fallback || "Enable DeepSeek in the extension options for summaries.") + " Here’s a sample from this check.",
    };
  }

  return { posts: select(posts, query), fallback };
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

async function collect(tabId, query, overview, apiKey) {
  await waitForLoad(tabId);
  if (overview) return collectOverview(tabId, query, apiKey);

  const stories = storyRequest(query);
  if (!stories) return { candidates: await readFeed(tabId, query, apiKey) };

  const candidates = await collectStories(tabId, stories);
  if (!candidates.length) {
    const hint = stories.length ? "Check that the account has an active story you can see." : "Try asking for stories from a specific @account.";
    throw new FeedError("I couldn’t read any active Instagram stories. " + hint);
  }
  return { candidates };
}

async function collectOverview(tabId, query, apiKey) {
  let feedError;
  const feed = await readFeed(tabId, query, apiKey).catch((error) => {
    feedError = error;
    return [];
  });
  const stories = await collectStories(tabId, []).catch(() => []);

  if (!feed.length && !stories.length) throw feedError;
  const note = feed.length
    ? (stories.length ? "" : "I couldn’t read any Stories in this check.")
    : "I couldn’t read any feed posts in this check.";
  return { candidates: [...feed, ...stories], note };
}

async function readFeed(tabId, query, apiKey) {
  const posts = new Map();
  let scroll = false;
  for (let remaining = 3; remaining >= 0; remaining -= 1) {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId }, func: scanFeed, args: [[...posts.keys()], scroll],
    });
    if (injection?.result?.needsLogin) {
      throw new FeedError("Instagram needs a sign-in in this Chrome profile. Sign in, then try again.");
    }
    const batch = injection?.result?.posts || [];
    if (!batch.length) break;
    for (const post of batch) posts.set(post.path, post);

    if (!apiKey || !remaining) break;
    scroll = await shouldScrollFeed([...posts.values()], query, apiKey, remaining).catch(() => false);
    if (!scroll) break;
  }
  if (!posts.size) throw new FeedError("I couldn’t find readable posts in the Instagram feed. Try again.");
  return [...posts.values()];
}

async function waitForLoad(tabId, timeout = 13_000) {
  const deadline = Date.now() + timeout;
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
async function scanFeed(knownPaths, scroll) {
  const known = new Set(knownPaths);
  const selector = "main article, main [role=article], article";
  const looksSignedOut = () => /\/(accounts\/(login|onetap)|challenge|checkpoint)(\/|$)/.test(location.pathname) ||
    Boolean(document.querySelector('input[name="password"]'));
  const postPath = (article) => [...article.querySelectorAll("a[href]")].find((link) =>
    link.origin === location.origin && /^\/(?:[\w.]+\/)?(?:p|reels?)\/[\w-]+\/?$/.test(link.pathname))?.pathname;
  if (scroll) {
    const lastKnown = [...document.querySelectorAll(selector)].filter((article) => {
      const bottom = article.getBoundingClientRect().bottom;
      return bottom > 0 && bottom < innerHeight * 2 && known.has(postPath(article));
    }).at(-1);
    window.scrollBy({ top: Math.max(innerHeight * .85, (lastKnown?.getBoundingClientRect().bottom || 0) - 80), behavior: "instant" });
  }

  const deadline = Date.now() + 7500;
  const batch = new Map();
  let changedAt;
  do {
    if (looksSignedOut()) return { needsLogin: true };
    for (const article of document.querySelectorAll(selector)) {
      const box = article.getBoundingClientRect();
      if (box.bottom <= 0 || box.top > innerHeight + 250) continue;
      const path = postPath(article);
      if (!path || known.has(path) || batch.has(path)) continue;

      const profile = [...article.querySelectorAll("a[href]")].find((link) =>
        /^\/[\w.]+\/$/.test(link.pathname) &&
        !/^\/(p|reel|reels|explore|accounts|direct|stories)\/$/.test(link.pathname));
      const handle = profile ? "@" + profile.pathname.split("/")[1] : "";
      const images = [...article.querySelectorAll("img")].filter((item) => {
        const size = item.getBoundingClientRect();
        return !item.closest("header") && (item.naturalWidth >= 160 || (size.width >= 160 && size.height >= 130));
      });
      const player = article.querySelector("video");
      const caption = article.querySelector("h1, [data-testid='post-caption']")?.textContent.trim() ||
        findCaption(article, handle);

      if (!caption && !images.some((image) => image.complete && image.naturalWidth) && !player) continue;
      changedAt = Date.now();
      batch.set(path, {
        path,
        kind: /\/reels?\//.test(path) ? "reel" : "post",
        handle,
        caption: caption.slice(0, 360),
        alt: (images[0]?.alt || "").slice(0, 240),
        images: [...images.map((image) => image.currentSrc || image.src), player?.poster].filter(Boolean),
        videoUrl: player?.currentSrc || player?.src || "",
      });
      if (batch.size >= 8) break;
    }
    if (batch.size >= 8 || (changedAt && Date.now() - changedAt >= 500)) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  return { posts: [...batch.values()] };

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
  const url = instagramMediaUrl(source);
  if (!url) return null;

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
