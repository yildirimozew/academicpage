import { extensionId } from "../stillroom/extension-id.js";
import { connect, connected, loadGoogle, searchYouTube, subscriptionVideos } from "./catalog.js";
import { balance, watch } from "./budget.js";

const $ = (id) => document.getElementById(id);
const status = $("status");
const results = $("results");
const clientId = $("client-id");
const clientKey = "youtube-oauth-client-v1";
const categories = ["informative", "entertainment"];
let closePlayer;
let busy = false;

function extension(action, payload) {
  const runtime = globalThis.chrome?.runtime;
  return new Promise((resolve, reject) => {
    const missing = () => reject(new Error("Open this page in desktop Chrome with extension 0.6.0 or later enabled."));
    if (!runtime?.sendMessage) return missing();
    try {
      runtime.sendMessage(extensionId, { action, ...payload }, (response) => {
        if (runtime.lastError || !response) return missing();
        if (response.error) reject(new Error(response.error));
        else resolve(response);
      });
    } catch {
      missing();
    }
  });
}

function displayBudgets() {
  for (const category of categories) {
    const seconds = Math.ceil(balance(category) / 1000);
    $(category).textContent = Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0") + " left";
  }
}

function play(video, category) {
  if (closePlayer || !/^[\w-]{11}$/.test(video.id)) return;
  status.textContent = "";
  try {
    closePlayer = watch(category, {
      start() {
        const iframe = document.createElement("iframe");
        iframe.title = video.title + " · YouTube video";
        iframe.src = "https://www.youtube-nocookie.com/embed/" + video.id + "?rel=0&playsinline=1";
        iframe.allowFullscreen = true;
        iframe.allow = "encrypted-media; picture-in-picture";
        $("playing").textContent = video.title;
        $("frame").replaceChildren(iframe);
        $("player").hidden = false;
        $("close-player").focus();
      },
      update: displayBudgets,
      end(error) {
        closePlayer = undefined;
        $("frame").replaceChildren();
        $("player").hidden = true;
        displayBudgets();
        if (error) status.textContent = error.message;
        else if (!balance(category)) status.textContent = "You’ve used today’s " + category + " budget.";
      },
    });
  } catch (error) {
    status.textContent = error.message;
  }
}

function render(items, category) {
  const cards = items.map((item) => {
    const card = document.createElement("article");
    if (item.thumbnail?.startsWith("https://i.ytimg.com/")) {
      const image = document.createElement("img");
      image.src = item.thumbnail;
      image.alt = "";
      image.loading = "lazy";
      card.append(image);
    }

    const text = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = item.title;
    text.append(title);
    const source = document.createElement("p");
    source.textContent = item.channel ? item.channel + " · YouTube" : "YouTube channel";
    text.append(source);
    if (item.reason) {
      const reason = document.createElement("p");
      reason.textContent = item.reason;
      text.append(reason);
    }
    if (item.kind === "channel") {
      const link = document.createElement("a");
      link.href = "https://www.youtube.com/channel/" + encodeURIComponent(item.id);
      link.textContent = "Channel on YouTube";
      text.append(link);
    }
    card.append(text);
    if (item.kind === "video") {
      const button = document.createElement("button");
      button.textContent = "Open player";
      button.addEventListener("click", () => play(item, category));
      card.append(button);
    }
    return card;
  });
  results.replaceChildren(...cards);
}

async function classify(items, query, mode) {
  if (!items.length) return [];
  const candidates = items.map(({ title, description, channel, duration }) => ({
    title: title.slice(0, 180),
    description: description?.slice(0, 500) || "",
    channel: channel?.slice(0, 100) || "",
    duration: duration || "",
  }));
  const { picks } = await extension("youtubeReview", { query, mode, candidates });
  return picks.map(({ index, reason }) => ({ ...items[index], reason }));
}

async function run(label, operation) {
  if (busy) return;
  busy = true;
  $("refresh").disabled = true;
  $("connect").disabled = true;
  $("search").querySelector("button").disabled = true;
  status.textContent = label;
  results.replaceChildren();
  try {
    await operation();
  } catch (error) {
    status.textContent = error.message || "Something went wrong. Try again.";
    if (!connected()) $("setup").open = true;
  } finally {
    busy = false;
    $("refresh").disabled = false;
    $("connect").disabled = false;
    $("search").querySelector("button").disabled = false;
  }
}

function checkSubscriptions() {
  return run("Checking recent subscription uploads…", async () => {
    await extension("youtubeStatus");
    const items = await subscriptionVideos();
    const selected = await classify(items, "", "informative");
    render(selected, "informative");
    status.textContent = selected.length
      ? selected.length + " informative picks from the latest subscription uploads."
      : "No informative uploads matched in the latest seven days.";
  });
}

$("connect").addEventListener("click", () => {
  if (busy) return;
  const id = clientId.value.trim();
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(id)) {
    status.textContent = "Enter your Google OAuth web client ID.";
    return;
  }
  let permission;
  try {
    permission = connect(id);
  } catch (error) {
    status.textContent = error.message;
    return;
  }
  void run("Connecting to YouTube…", async () => {
    await permission;
    localStorage.setItem(clientKey, id);
    $("setup").open = false;
    status.textContent = "YouTube connected. Check subscriptions or enter a request.";
  });
});

$("refresh").addEventListener("click", () => void checkSubscriptions());
$("search").addEventListener("submit", (event) => {
  event.preventDefault();
  const query = $("query").value.trim();
  if (!query) return;
  const mode = $("mode").value;
  void run("Looking for matches…", async () => {
    if (!connected()) throw new Error("Connect YouTube to continue.");
    if (mode === "channels") {
      const { educational } = await extension("youtubeReview", { query, mode: "topic", candidates: [] });
      if (!educational) throw new Error("Channel recommendations require an informative topic. Try describing what you want to learn.");
    } else {
      await extension("youtubeStatus");
    }
    if (mode === "entertainment") {
      status.textContent = "Checking recent uploads from your subscriptions…";
      const recent = await subscriptionVideos();
      const matches = await classify(recent, query, mode);
      if (matches.length) {
        render(matches, "entertainment");
        status.textContent = matches.length === 1
          ? "1 recent match from your subscriptions."
          : matches.length + " recent matches from your subscriptions.";
        return;
      }
      status.textContent = "Searching beyond your subscriptions…";
    }
    const items = await searchYouTube(query, mode === "channels");
    const selected = await classify(items, query, mode);
    render(selected, mode === "entertainment" ? "entertainment" : "informative");
    status.textContent = selected.length ? selected.length + " matches." : "No results met the request.";
  });
});

$("close-player").addEventListener("click", () => closePlayer?.());
window.addEventListener("pagehide", () => closePlayer?.());
window.addEventListener("storage", displayBudgets);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) closePlayer?.();
  else displayBudgets();
});

clientId.value = localStorage.getItem(clientKey) || "";
$("setup").open = true;
displayBudgets();
setInterval(displayBudgets, 30_000);
loadGoogle().catch((error) => { status.textContent = error.message; });
