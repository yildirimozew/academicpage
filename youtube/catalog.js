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
    channelId: item.snippet.channelId,
    description: item.snippet.description,
    thumbnail: item.snippet.thumbnails?.medium?.url,
    publishedAt: item.snippet.publishedAt,
    duration: item.contentDetails.duration,
  }));
}

// The public API does not expose a reliable Shorts flag. Entertainment uses
// videos over three minutes; broad searches request both medium and long videos.
function regularVideo(item) {
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(item.duration || "");
  return Boolean(match && Number(match[1] || 0) * 86400 + Number(match[2] || 0) * 3600 +
    Number(match[3] || 0) * 60 + Number(match[4] || 0) > 180);
}

function words(text) {
  return (text || "").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

function matchScore(query, text) {
  const ignored = new Set(["give", "me", "some", "show", "find", "watch", "videos", "video", "please", "the", "a", "of", "from", "on", "youtube"]);
  const terms = [...new Set(words(query).filter((word) => !ignored.has(word)))];
  if (!terms.length) return 0;
  const target = words(text);
  return terms.filter((term) => target.includes(term)).length / terms.length;
}

async function channelUploads(channelIds, window, query = "", regularOnly = false) {
  const channelPages = await parallelBatches(groups([...new Set(channelIds)], 50), (batch) =>
    youtube("channels", { part: "contentDetails", id: batch.join(",") }));
  const playlists = channelPages.flatMap((page) =>
    page.items.map((item) => item.contentDetails.relatedPlaylists.uploads).filter(Boolean));
  const pages = await parallelBatches(playlists, async (playlistId) => {
    try {
      return await youtube("playlistItems", { part: "snippet,contentDetails", playlistId, maxResults: "50" });
    } catch (error) {
      if (error.status === 404) return { items: [] };
      throw error;
    }
  });
  const latest = new Map();
  for (const page of pages) {
    for (const { contentDetails: upload, snippet } of page.items) {
      if (withinWindow(upload.videoPublishedAt, window)) {
        latest.set(upload.videoId, {
          publishedAt: Date.parse(upload.videoPublishedAt),
          score: matchScore(query, (snippet?.videoOwnerChannelTitle || snippet?.channelTitle || "") + " " + (snippet?.title || "")),
        });
      }
    }
  }
  // Rank for the request before limiting, so unrelated busy subscriptions cannot
  // crowd out a matching channel. Review extra details before removing Shorts.
  const ids = [...latest].sort((a, b) => b[1].score - a[1].score || b[1].publishedAt - a[1].publishedAt)
    .slice(0, regularOnly ? 200 : 40).map(([id]) => id);
  return (await videoDetails(ids)).filter((item) =>
    withinWindow(item.publishedAt, window) && (!regularOnly || regularVideo(item)));
}

export async function subscriptionVideos(period = "recent", query = "") {
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
  return (await channelUploads([...channelIds], window, query, Boolean(query))).slice(0, 40);
}

function channelResults(page) {
  return page.items.map(({ id, snippet }) => ({
    id: id.channelId,
    kind: "channel",
    title: snippet.title,
    description: snippet.description,
    thumbnail: snippet.thumbnails?.medium?.url,
  }));
}

export async function searchYouTube(query, channels, period = "any", mode = "informative") {
  if (channels) {
    return channelResults(await youtube("search", {
      part: "snippet", q: query, type: "channel", maxResults: "20",
    }));
  }
  const window = uploadWindow(period);
  const regularOnly = mode === "entertainment";
  const options = {
    part: "snippet", q: query, type: "video", maxResults: regularOnly ? "25" : "20",
    order: "relevance", videoEmbeddable: "true", videoSyndicated: "true",
    ...(window.after ? { publishedAfter: window.after } : {}),
    publishedBefore: window.before,
  };
  if (!regularOnly) {
    const page = await youtube("search", options);
    return (await videoDetails([...new Set(page.items.map((item) => item.id.videoId).filter(Boolean))]))
      .filter((item) => withinWindow(item.publishedAt, window));
  }

  // Find channels independently of the date filter: the channel can be old even
  // when the requested uploads must be from today. Titles need not repeat its name.
  const [channelPage, mediumPage, longPage] = await Promise.all([
    youtube("search", { part: "snippet", q: query, type: "channel", maxResults: "10" }),
    youtube("search", { ...options, videoDuration: "medium" }),
    youtube("search", { ...options, videoDuration: "long" }),
  ]);
  const matchingChannels = channelResults(channelPage)
    .map((item) => ({ ...item, score: matchScore(query, item.title) }))
    .filter((item) => item.score >= 0.6)
    .sort((a, b) => b.score - a.score).slice(0, 3);
  const broadIds = [...new Set(mediumPage.items.flatMap((item, index) =>
    [item.id.videoId, longPage.items[index]?.id.videoId]).concat(longPage.items.map((item) => item.id.videoId)).filter(Boolean))];
  const [uploads, broad] = await Promise.all([
    channelUploads(matchingChannels.map((item) => item.id), window, query, true),
    videoDetails(broadIds),
  ]);
  const eligibleBroad = broad.filter((item) => withinWindow(item.publishedAt, window) && regularVideo(item));
  // Reserve room for both channel uploads and broader results within the
  // extension's forty-candidate review limit, with channel matches first.
  const candidates = [...uploads.slice(0, 20), ...eligibleBroad, ...uploads.slice(20)];
  return [...new Map(candidates.map((item) => [item.id, item])).values()].slice(0, 40);
}
