import { extensionId } from "./extension-id.js";

const thread = document.getElementById("thread");
const status = document.getElementById("connection");
const input = document.getElementById("prompt");
const send = document.getElementById("send");

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
  author.textContent = post.handle || "Instagram post";
  copy.append(author);
  if (post.caption) {
    const caption = document.createElement("p");
    caption.textContent = post.caption;
    copy.append(caption);
  }
  card.append(copy);
  return card;
}

async function showStatus() {
  const response = await request("status");
  status.textContent = response ? (response.usedToday ? "Daily check used" : "Extension connected") : "Extension disconnected";
}

document.getElementById("chat").addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (!query || send.disabled) return;

  input.value = "";
  send.disabled = true;
  message("user", query);
  const reply = message("assistant", "Checking…");
  try {
    const response = await request("ask", query);
    if (!response) {
      reply.firstChild.textContent = "Install or enable the Stillroom extension in Chrome, then try again.";
      return;
    }
    reply.firstChild.textContent = response.message;
    reply.append(...(response.posts || []).map(renderPost));
  } finally {
    send.disabled = false;
    thread.scrollTop = thread.scrollHeight;
    void showStatus();
  }
});

void showStatus();
