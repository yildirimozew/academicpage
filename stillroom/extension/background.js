"use strict";

importScripts("deepseek.js", "stories.js", "media.js");

const siteOrigins = new Set([
  "https://stillroom-instagram-digest.mildtitan4.chatgpt.site",
  "https://stillroom.yildirimozen.com",
]);
const feedUrl = "https://www.instagram.com/";
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);
const limit = 4;
const digestPrompt = "Summarize the important updates in the Instagram feed posts and Stories provided. Prioritize meaningful personal updates and useful information. Skip ads and engagement bait. Keep it brief. If the sample has no substantive updates, say so.";
const maxImageBytes = 80_000;
const maxDownloadBytes = 8 * 1024 * 1024;

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
  return { provider: deepseekKey ? "deepseek" : "unconfigured", imageReview: true };
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

  if (!deepseekKey) {
    return { message: "Add a DeepSeek API key in the extension options to review Instagram images." };
  }

  let tab;
  try {
    tab = await chrome.tabs.create({ url: feedUrl, active: false });
    const { candidates, note } = await collect(tab.id, query, overview, deepseekKey);
    const result = await reviewDigest(tab.id, candidates, query, deepseekKey);
    await chrome.storage.local.set({ digest: { posts: result.posts } });
    const response = { message: result.summary, posts: result.posts, imageReview: true };
    if (note) response.message += "\n\n" + note;
    return response;
  } catch (error) {
    const message = error instanceof FeedError || error instanceof DeepSeekError ? error.message : "The Instagram check couldn’t finish. Try again.";
    return { message };
  } finally {
    if (tab?.id !== undefined) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function reviewDigest(tabId, candidates, query, apiKey) {
  const imageCache = new Map();
  const previews = await prepareReviewImages(candidates, imageCache, 1);
  if (!previews.length) {
    return { posts: [], summary: "I couldn’t load any images for DeepSeek to review." };
  }

  const shortlist = await summarizeWithDeepSeek(previews, query, apiKey, limit);
  if (!shortlist.posts.length) return shortlist;

  const details = [];
  for (const post of shortlist.posts) details.push(await resolvePostMedia(tabId, post));
  const complete = await prepareReviewImages(details, imageCache, 20);
  if (!complete.length) {
    return { posts: [], summary: "I couldn’t load the selected posts’ images for review." };
  }

  const needsReview = complete.length !== shortlist.posts.length || complete.some((post, index) => {
    const preview = shortlist.posts[index].visualImages;
    return post.visualImages.length !== preview.length ||
      post.visualImages.some((image, imageIndex) => image !== preview[imageIndex]);
  });
  const review = needsReview
    ? await summarizeWithDeepSeek(complete, query, apiKey, limit)
    : { posts: complete, summary: shortlist.summary };
  return {
    summary: review.summary,
    posts: review.posts.map(({ visualImages, ...post }) => ({ ...post, images: visualImages })),
  };
}

async function prepareReviewImages(posts, imageCache, perPostLimit) {
  const entries = posts.map((post) => ({
    post,
    sources: [...new Set((post.images || [post.imageUrl]).map(instagramMediaUrl).filter(Boolean))].slice(0, perPostLimit),
  }));
  const urls = [...new Set(entries.flatMap(({ sources }) => sources))].filter((url) => !imageCache.has(url));
  for (let start = 0; start < urls.length; start += 6) {
    await Promise.all(urls.slice(start, start + 6).map(async (url) => {
      imageCache.set(url, await readImage(url).catch(() => null));
    }));
  }
  return entries.map(({ post, sources }) => ({
    ...post,
    visualImages: sources.map((url) => imageCache.get(url)).filter(Boolean),
  })).filter((post) => post.visualImages.length);
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
    if (length > maxDownloadBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const file = new Blob(chunks, { type });
  const supported = type !== "image/avif";
  if (supported && file.size <= maxImageBytes) return imageDataUrl(file);

  const bitmap = await createImageBitmap(file);
  try {
    for (const [side, quality] of [[900, .82], [700, .74], [512, .66], [384, .55]]) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const jpeg = await canvas.convertToBlob({ type: "image/jpeg", quality });
      if (jpeg.size <= maxImageBytes) return await imageDataUrl(jpeg);
    }
  } finally {
    bitmap.close();
  }
  return null;
}

async function imageDataUrl(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return "data:" + file.type + ";base64," + btoa(binary);
}
