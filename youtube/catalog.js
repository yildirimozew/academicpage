import { uploadWindow, withinWindow } from "./date-filter.js?v=4";

const scope = "https://www.googleapis.com/auth/youtube.readonly";
const googleScript = "https://accounts.google.com/gsi/client";
let authentication;
let token;
let expiresAt = 0;

export function connected() {
  return Boolean(token && Date.now() < expiresAt);
}

export function loadGoogle() {
  if (!authentication) {
    authentication = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = googleScript;
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    }).catch(() => {
      authentication = undefined;
      throw new Error("Google sign-in couldn’t load.");
    });
  }
  return authentication;
}

export function connect(clientId) {
  const oauth = globalThis.google?.accounts?.oauth2;
  if (!oauth) throw new Error("Google sign-in is still loading. Try again.");
  return new Promise((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: clientId,
      scope,
      include_granted_scopes: false,
      callback(response) {
        if (!response.access_token || !oauth.hasGrantedAllScopes(response, scope)) {
          reject(new Error("Google didn’t grant read-only YouTube access."));
          return;
        }
        token = response.access_token;
        expiresAt = Date.now() + Math.max(0, Number(response.expires_in) - 30) * 1000;
        resolve();
      },
      error_callback() { reject(new Error("Google sign-in was closed or blocked.")); },
    });
    client.requestAccessToken({ prompt: "" });
  });
}

async function youtube(resource, options) {
  if (!connected()) throw new Error("Connect YouTube to continue.");
  const response = await fetch("https://www.googleapis.com/youtube/v3/" + resource + "?" + new URLSearchParams(options), {
    headers: { Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(12_000),
  });
  const data = await response.json();
  if (response.status === 401) {
    token = undefined;
    throw new Error("Your YouTube session expired. Connect again.");
  }
  if (!response.ok) {
    const reason = data.error?.errors?.[0]?.reason;
    if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
      throw new Error("This Google project has reached its YouTube API quota.");
    }
    const error = new Error("YouTube couldn’t complete the request. Check that YouTube Data API v3 is enabled for this client.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function groups(items, size) {
  const batches = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

async function parallelBatches(items, run) {
  const output = [];
  for (const batch of groups(items, 6)) {
    output.push(...await Promise.all(batch.map(run)));
  }
  return output;
}

async function videoDetails(ids) {
  if (!ids.length) return [];
  const pages = await parallelBatches(groups(ids, 50), (batch) =>
    youtube("videos", { part: "snippet,status,contentDetails", id: batch.join(",") }));
  const byId = new Map(pages.flatMap((page) => page.items).map((item) => [item.id, item]));
  return ids.map((id) => byId.get(id)).filter((item) =>
    item?.status.embeddable && item.snippet.liveBroadcastContent === "none" &&
    item.contentDetails.contentRating?.ytRating !== "ytAgeRestricted").map((item) => ({
    id: item.id,
    kind: "video",
    title: item.snippet.title,
    channel: item.snippet.channelTitle,
    description: item.snippet.description,
    thumbnail: item.snippet.thumbnails?.medium?.url,
    publishedAt: item.snippet.publishedAt,
    duration: item.contentDetails.duration,
  }));
}

export async function subscriptionVideos(period = "recent") {
  const window = uploadWindow(period);
  const channelIds = new Set();
  let pageToken;
  do {
    const page = await youtube("subscriptions", {
      part: "snippet", mine: "true", maxResults: "50", ...(pageToken ? { pageToken } : {}),
    });
    for (const entry of page.items) channelIds.add(entry.snippet.resourceId.channelId);
    pageToken = page.nextPageToken;
  } while (pageToken);

  const channelPages = await parallelBatches(groups([...channelIds], 50), (batch) =>
    youtube("channels", { part: "contentDetails", id: batch.join(",") }));
  const playlists = channelPages.flatMap((page) =>
    page.items.map((item) => item.contentDetails.relatedPlaylists.uploads).filter(Boolean));
  const latest = new Map();

  const pages = await parallelBatches(playlists, async (playlistId) => {
    try {
      return await youtube("playlistItems", { part: "contentDetails", playlistId, maxResults: "50" });
    } catch (error) {
      if (error.status === 404) return { items: [] };
      throw error;
    }
  });
  for (const page of pages) {
    for (const { contentDetails: upload } of page.items) {
      const publishedAt = Date.parse(upload.videoPublishedAt);
      if (withinWindow(upload.videoPublishedAt, window)) latest.set(upload.videoId, publishedAt);
    }
  }
  const ids = [...latest].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([id]) => id);
  return (await videoDetails(ids)).filter((item) => withinWindow(item.publishedAt, window));
}

export async function searchYouTube(query, channels, period = "any") {
  const window = channels ? null : uploadWindow(period);
  const page = await youtube("search", {
    part: "snippet", q: query, type: channels ? "channel" : "video", maxResults: "20",
    ...(channels ? {} : {
      videoEmbeddable: "true", videoSyndicated: "true",
      ...(window.after ? { publishedAfter: window.after } : {}),
      publishedBefore: window.before,
    }),
  });
  if (!channels) {
    const videos = await videoDetails([...new Set(page.items.map((item) => item.id.videoId).filter(Boolean))]);
    return videos.filter((item) => withinWindow(item.publishedAt, window));
  }
  return page.items.map(({ id, snippet }) => ({
    id: id.channelId,
    kind: "channel",
    title: snippet.title,
    description: snippet.description,
    thumbnail: snippet.thumbnails?.medium?.url,
  }));
}
