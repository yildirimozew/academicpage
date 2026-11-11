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

function renderPost(post) {
  const card = document.createElement("article");
  card.className = "post";
  if (post.image && /^data:image\/(?:jpeg|png|webp|avif);base64,[a-z0-9+/=]+$/i.test(post.image)) {
    const image = document.createElement("img");
    image.src = post.image;
    image.alt = post.alt || (post.handle ? "Photo from " + post.handle : "Instagram photo");
    image.addEventListener("load", () => {
      if (thread.lastElementChild === card.parentElement) thread.scrollTop = thread.scrollHeight;
    });
    card.append(image);
  }
  const copy = document.createElement("div");
  const author = document.createElement("h2");
  const story = post.kind === "story";
  author.textContent = [post.handle, story ? "Story" : ""].filter(Boolean).join(" · ") || "Instagram post";
  copy.append(author);
  const storyPreview = post.video
    ? (post.image ? "Video story preview" : "Video story · Preview unavailable")
    : "Story image unavailable";
  const text = post.caption || (story && (post.video || !post.image) ? storyPreview : "");
  if (text) {
    const caption = document.createElement("p");
    caption.textContent = text;
    copy.append(caption);
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
        reply.firstChild.textContent = "Open Stillroom in the same desktop Chrome profile where the extension is installed and enabled.";
      } else if (oneClick) {
        reply.firstChild.textContent = "Chrome can reach Stillroom, but the extension didn’t answer the summary request. Download version 0.3.1, replace the installed folder’s files, then click Reload in chrome://extensions.";
      } else {
        reply.firstChild.textContent = "Chrome can reach Stillroom, but this request didn’t finish. Try again.";
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
