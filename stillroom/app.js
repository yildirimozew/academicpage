import { extensionId } from "./extension-id.js";

const thread = document.getElementById("thread");
const status = document.getElementById("connection");
const input = document.getElementById("prompt");
const send = document.getElementById("send");
const summarize = document.getElementById("summarize");

function request(action, query) {
  const runtime = globalThis.chrome?.runtime;
  if (!runtime?.sendMessage) return Promise.resolve(null);

  return new Promise((resolve) => {
    try {
      runtime.sendMessage(extensionId, { action, query }, (response) => {
        resolve(runtime.lastError ? null : response);
      });
    } catch {
      resolve(null);
    }
  });
}

function message(role, text) {
  const bubble = document.createElement("div");
  bubble.className = "message " + role;
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  bubble.append(paragraph);
  thread.append(bubble);
  thread.scrollTop = thread.scrollHeight;
  return bubble;
}

function isInstagramMedia(source) {
  try {
    const url = new URL(source);
    return url.protocol === "https:" && !url.username && !url.password &&
      /(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(url.hostname);
  } catch {
    return false;
  }
}

function renderPost(post) {
  const card = document.createElement("article");
  card.className = "post";
  const images = (post.images || [post.image]).filter((source) =>
    /^data:image\/(?:jpeg|png|webp|avif);base64,[a-z0-9+/=]+$/i.test(source || "") || isInstagramMedia(source));
  for (const [index, source] of images.entries()) {
    const image = document.createElement("img");
    image.src = source;
    image.alt = index === 0 && post.alt ? post.alt : "Instagram image " + (index + 1);
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    card.append(image);
  }

  const playable = isInstagramMedia(post.videoSrc);
  if (playable) {
    const video = document.createElement("video");
    video.controls = true;
    video.playsInline = true;
    video.preload = "none";
    video.src = post.videoSrc;
    card.append(video);
  }

  const copy = document.createElement("div");
  const author = document.createElement("h2");
  const kind = post.kind === "story" ? "Story" : post.kind === "reel" ? "Reel" : "";
  author.textContent = [post.handle, kind].filter(Boolean).join(" · ") || "Instagram post";
  copy.append(author);
  if (post.caption) {
    const caption = document.createElement("p");
    caption.textContent = post.caption;
    copy.append(caption);
  }
  if (/^https:\/\/www\.instagram\.com\/(?:[\w.]+\/)?(?:p|reels?)\/[\w-]+\/?$/.test(post.permalink || "")) {
    const link = document.createElement("a");
    link.href = post.permalink;
    link.textContent = kind === "Reel" ? "Open Reel on Instagram" : "Open post on Instagram";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    copy.append(link);
  } else if (kind === "Story" && !images.length && !playable) {
    const fallback = document.createElement("p");
    fallback.textContent = "Story preview unavailable.";
    copy.append(fallback);
  }
  card.append(copy);
  return card;
}

async function showStatus() {
  const response = await request("status");
  if (!response) {
    status.textContent = "Extension disconnected";
    return;
  }

  status.textContent = response.provider === "deepseek" ? "DeepSeek enabled" : "Local matching";
}

async function runRequest(action, query) {
  if (send.disabled) return;
  send.disabled = true;
  summarize.disabled = true;

  const oneClick = action === "summarize";
  if (!oneClick) message("user", query);
  const reply = message("assistant", oneClick ? "Checking feed posts and Stories…" : "Checking…");
  try {
    const response = await request(action, query);
    if (!response) {
      const connection = await request("status");
      if (!connection) {
        reply.firstChild.textContent = "Open this page in the same desktop Chrome profile where the extension is installed and enabled.";
      } else if (oneClick) {
        reply.firstChild.textContent = "Chrome can reach the extension, but the extension didn’t answer the summary request. Download the latest extension, replace the installed folder’s files, then click Reload in chrome://extensions.";
      } else {
        reply.firstChild.textContent = "Chrome can reach the extension, but this request didn’t finish. Try again.";
      }
      return;
    }
    reply.firstChild.textContent = response.message;
    reply.append(...(response.posts || []).map(renderPost));
  } finally {
    send.disabled = false;
    summarize.disabled = false;
    thread.scrollTop = thread.scrollHeight;
    void showStatus();
  }
}

summarize.addEventListener("click", () => void runRequest("summarize"));
document.getElementById("chat").addEventListener("submit", (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (!query || send.disabled) return;
  input.value = "";
  void runRequest("ask", query);
});

void showStatus();
