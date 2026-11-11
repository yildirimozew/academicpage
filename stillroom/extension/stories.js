"use strict";

function storyRequest(query) {
  const urls = [...query.matchAll(/https:\/\/www\.instagram\.com\/stories\/([a-z0-9_.]{1,30})(?:\/(\d+))?(?:[/?#\s]|$)/gi)];
  if (!urls.length && !/\bstor(?:y|ies)\b/i.test(query)) return null;

  const targets = new Map();
  for (const [, account, id] of urls) {
    if (account.toLowerCase() !== "highlights") targets.set(account.toLowerCase(), id || "");
  }
  for (const [, handle] of query.matchAll(/@([a-z0-9_.]{1,30})/gi)) {
    const account = handle.toLowerCase().replace(/\.+$/, "");
    if (account && !targets.has(account)) targets.set(account, "");
  }
  return [...targets].slice(0, 4);
}

async function collectStories(tabId, targets) {
  const posts = [];
  if (targets.length) {
    for (const [account, id] of targets) {
      const path = "stories/" + encodeURIComponent(account) + "/" + (id ? id + "/" : "");
      await chrome.tabs.update(tabId, { url: feedUrl + path });
      await waitForLoad(tabId);
      const story = await waitForStory(tabId, account, "");
      if (story) posts.push(story.post);
    }
    return posts;
  }

  const opening = await findStoryTray(tabId);
  if (!opening) return posts;
  if (opening.path) {
    await chrome.tabs.update(tabId, { url: new URL(opening.path, feedUrl).href });
    await waitForLoad(tabId);
  }

  let previous = "";
  const seen = new Set();
  for (let step = 0; step < limit; step += 1) {
    const story = await waitForStory(tabId, "", previous);
    if (!story || seen.has(story.key)) break;

    seen.add(story.key);
    posts.push(story.post);
    previous = story.key;

    if (step === limit - 1) break;
    const next = await inspectStories(tabId, "next");
    if (!next?.clicked && !next?.key) break;
  }
  return posts;
}

async function findStoryTray(tabId) {
  const deadline = Date.now() + 7000;
  do {
    const result = await inspectStories(tabId, "open");
    if (result?.needsLogin) throw new FeedError("Instagram needs a sign-in in this Chrome profile. Sign in, then try again.");
    if (result?.clicked || result?.path) return result;
    await new Promise((resolve) => setTimeout(resolve, 350));
  } while (Date.now() < deadline);
  return null;
}

async function waitForStory(tabId, account, previous) {
  const deadline = Date.now() + 7000;
  let opened = false;
  do {
    const result = await inspectStories(tabId, opened ? "read" : "enter");
    if (result?.clicked) opened = true;
    if (result?.needsLogin) throw new FeedError("Instagram needs a sign-in in this Chrome profile. Sign in, then try again.");
    if (result?.key && result.key !== previous && (!account || result.post.handle === "@" + account)) return result;
    await new Promise((resolve) => setTimeout(resolve, 350));
  } while (Date.now() < deadline);
  return null;
}

async function inspectStories(tabId, action) {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: inspectStoryPage,
      args: [action],
    });
    return injection?.result;
  } catch {
    // A viewer transition can replace the document between inspections.
    return null;
  }
}

// Chrome serializes this function to run in Instagram's page.
function inspectStoryPage(action) {
  const isSignedOut = /\/(?:accounts\/(?:login|onetap)|challenge|checkpoint)(?:\/|$)/.test(location.pathname) ||
    document.querySelector('input[name="password"]');
  if (isSignedOut) return { needsLogin: true };

  const route = location.pathname.match(/^\/stories\/([\w.]+)(?:\/(\d+))?\/?$/);
  const controls = "button, [role=button]";
  const label = (node) => (node.getAttribute("aria-label") || node.getAttribute("title") ||
    node.querySelector("svg[aria-label]")?.getAttribute("aria-label") || node.innerText || "").trim();
  const normalize = (text) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/ı/g, "i");
  const ownStory = (text) => /\b(your story|hikayen|hikayeniz|hikaye ekle|add story|create story)\b/.test(normalize(text));
  const visible = (node) => {
    const box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return box.width > 0 && box.height > 0 && box.right > 0 && box.bottom > 0 &&
      box.left < innerWidth && box.top < innerHeight && style.visibility !== "hidden" && style.display !== "none" &&
      !node.closest('[aria-hidden="true"], [inert]');
  };

  if (action === "open" && location.pathname === "/") {
    if (scrollY > 0) window.scrollTo({ top: 0, behavior: "instant" });
    const links = document.querySelectorAll('main a[href^="/stories/"], a[href^="/stories/"]');
    const link = [...links].find((node) =>
      /^\/stories\/(?!highlights\/)[\w.]+(?:\/\d+)?\/?$/.test(node.pathname) &&
      !ownStory(label(node)) && visible(node));
    if (link) return { path: link.pathname };

    const tray = [...document.querySelectorAll('[role=list], [role=menu], [aria-label]')].find((node) =>
      /^(stories|hikayeler)$/.test(normalize(node.getAttribute("aria-label") || "")) && visible(node));
    const feed = document.querySelector('main, [role="main"]') || document;
    const candidates = [...(tray || feed).querySelectorAll(controls)].filter(visible);
    const storyRings = candidates.filter((node) => {
      const bounds = node.getBoundingClientRect();
      return bounds.top >= 0 && bounds.top < 245 && bounds.width <= 145 &&
        bounds.height <= 150 && node.querySelector("img") && node.querySelector("canvas");
    });
    const button = candidates.find((node) => {
      const name = normalize(label(node));
      const englishStory = /\b(?:view|watch) (?:.+ )?stor(?:y|ies)\b|\bstory by\b|\b[\w.]+['’]s story\b/.test(name);
      const turkishStory = /['’](?:dan|den|tan|ten) hikaye\b/.test(name);
      return !ownStory(name) && (englishStory || turkishStory ||
        Boolean(tray && /^[\w.]{1,30}$/.test(name) && node.querySelector("img")));
    }) || storyRings.find((node) => {
      if (ownStory(label(node))) return false;
      const top = node.getBoundingClientRect().top;
      return storyRings.filter((peer) => Math.abs(peer.getBoundingClientRect().top - top) < 12).length >= 3;
    });
    if (button) {
      button.click();
      return { clicked: true };
    }
    return null;
  }

  if (!route || route[1].toLowerCase() === "highlights") return null;
  const viewer = [...document.querySelectorAll('[role=dialog]')].find((node) =>
    visible(node) && node.querySelector("video, img")) || document;
  const media = [...viewer.querySelectorAll("video, img")].filter((node) => {
    if (!visible(node)) return false;
    const box = node.getBoundingClientRect();
    const center = box.left + box.width / 2;
    return box.width >= 110 && box.height >= 190 && Math.abs(center - innerWidth / 2) <= innerWidth * .24;
  }).sort((left, right) => {
    const a = left.getBoundingClientRect();
    const b = right.getBoundingClientRect();
    return b.width * b.height - a.width * a.height;
  })[0];
  if (!media && action === "enter") {
    const open = [...viewer.querySelectorAll(controls)].find((node) =>
      visible(node) && /^(?:(?:view|watch) story|hikayeyi (?:gor|goruntule|izle))$/.test(normalize(label(node))));
    if (open) {
      open.click();
      return { clicked: true };
    }
  }
  if (!media) return null;

  if (action === "next") {
    const button = [...viewer.querySelectorAll(controls)].find((node) =>
      visible(node) && /^(next|next story|ileri|sonraki|sonraki hikaye)$/.test(normalize(label(node))));
    if (button) {
      button.click();
      return { clicked: true };
    }
    // The viewer can also advance itself, so let the reader watch for a new frame.
    return { key: location.pathname };
  }

  const video = media.tagName === "VIDEO";
  const imageUrl = video ? media.poster : (media.currentSrc || media.src);
  const videoUrl = video ? [media.currentSrc, media.src, media.querySelector("source[src]")?.src]
    .find((source) => source?.startsWith("https://")) : "";
  if (!video && (!media.complete || !media.naturalWidth || !imageUrl)) return null;
  const caption = [...viewer.querySelectorAll('[data-testid="story-text"], [aria-label="Story text"]')]
    .filter(visible).map((node) => node.innerText.trim()).filter(Boolean).join(" ").slice(0, 360);
  const key = route[2] ? location.pathname : [location.pathname, imageUrl || media.currentSrc || media.src || "", caption].join("|");

  return {
    key,
    post: {
      kind: "story",
      handle: "@" + route[1].toLowerCase(),
      caption,
      alt: (video ? "" : media.alt || "").slice(0, 240),
      imageUrl: imageUrl || "",
      videoUrl: videoUrl || "",
      video,
    },
  };
}
