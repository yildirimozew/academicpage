"use strict";

function instagramMediaUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      /(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(url.hostname) ? url.href : "";
  } catch {
    return "";
  }
}

async function resolvePostMedia(tabId, post) {
  let images = post.images || [post.imageUrl];
  let video = post.videoUrl;
  if (post.path) {
    try {
      await chrome.tabs.update(tabId, { url: new URL(post.path, feedUrl).href });
      await waitForLoad(tabId, 6000);
      const [result] = await chrome.scripting.executeScript({
        target: { tabId }, func: readPostMedia, args: [post.path],
      });
      const detail = result?.result;
      if (detail?.images?.length) images = detail.images;
      video = detail?.video || video;
    } catch {
      // The feed preview remains usable if Instagram cannot open the detail page.
    }
  }
  const { imageUrl, videoUrl, images: previews, visualImages, path, ...metadata } = post;
  const sources = [...new Set(images.map(instagramMediaUrl).filter(Boolean))];
  return {
    ...metadata,
    images: sources,
    videoSrc: instagramMediaUrl(video),
    permalink: path ? new URL(path, feedUrl).href : "",
  };
}

// This runs in the selected Instagram post, where carousel controls and the player are mounted.
async function readPostMedia(expectedPath) {
  const id = (path) => path.match(/\/(?:p|reels?)\/([\w-]+)/)?.[1];
  if (!id(expectedPath) || id(location.pathname) !== id(expectedPath)) return null;
  const deadline = Date.now() + 10_000;
  const images = new Set();
  let video = "";

  function snapshot() {
    const scope = document.querySelector('[role="dialog"] article, main article, article') ||
      document.querySelector('[role="dialog"], main, [role="main"]');
    if (!scope) return { images: [] };
    const media = [...scope.querySelectorAll("img, video")].filter((element) => {
      const box = element.getBoundingClientRect();
      return !element.closest('header, nav, [aria-hidden="true"]') &&
        box.width >= 160 && box.height >= 130 &&
        (element.tagName === "VIDEO" || (element.complete && element.naturalWidth >= 160));
    });
    const player = media.find((element) => element.tagName === "VIDEO");
    const playerSources = [player?.currentSrc, player?.src, player?.querySelector("source[src]")?.src]
      .filter((source) => source?.startsWith("https://"));
    const next = [...scope.querySelectorAll('button, [role="button"]')].find((button) => {
      const name = button.getAttribute("aria-label") || button.getAttribute("title") ||
        button.querySelector("svg[aria-label]")?.getAttribute("aria-label");
      const box = button.getBoundingClientRect();
      const normalized = (name || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/ı/g, "i");
      return /^(?:next|next photo|next image|next slide|ileri|sonraki|sonraki fotograf)$/.test(normalized) &&
        box.width > 0 && box.height > 0 && !button.disabled &&
        !button.closest('[aria-hidden="true"], [aria-disabled="true"]');
    });
    return {
      images: [...media.filter((element) => element.tagName === "IMG").map((image) => image.currentSrc || image.src),
        player?.poster].filter(Boolean),
      video: playerSources[0] || document.querySelector('meta[property="og:video:secure_url"], meta[property="og:video"]')?.content || "",
      next,
    };
  }

  let previous = "";
  let pendingUntil = deadline;
  const signature = (view) => [...view.images, view.video || ""].filter(Boolean).join("|");
  for (let advance = 0; advance < 20 && Date.now() < deadline; advance += 1) {
    let current;
    do {
      current = snapshot();
      if (signature(current) && signature(current) !== previous) break;
      await new Promise((resolve) => setTimeout(resolve, 160));
    } while (Date.now() < pendingUntil);

    const key = signature(current);
    if (!key || key === previous) break;
    for (const source of current.images) images.add(source);
    video ||= current.video;
    if (!current.next) break;

    previous = key;
    pendingUntil = Math.min(deadline, Date.now() + 1800);
    current.next.click();
  }
  if (!images.size) {
    const preview = document.querySelector('meta[property="og:image"]')?.content;
    if (preview) images.add(preview);
  }
  if (!video && /\/reels?\//.test(expectedPath) && document.querySelectorAll("video").length === 1) {
    const sources = performance.getEntriesByType("resource").filter((entry) => {
      const url = new URL(entry.name);
      return entry.initiatorType === "video" && /\.mp4$/i.test(url.pathname) &&
        !url.searchParams.has("bytestart") && !url.searchParams.has("byteend");
    });
    const unique = [...new Set(sources.map((entry) => entry.name))];
    if (unique.length === 1) video = unique[0];
  }
  return { images: [...images].slice(0, 20), video };
}
