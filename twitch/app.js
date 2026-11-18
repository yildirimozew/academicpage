import { balance, watch } from "./budget.js";

const $ = (id) => document.getElementById(id);
const status = $("status");
let closePlayer;
let running = false;

export function channelName(value) {
  const text = value.trim();
  if (!text) return "";
  if (/^(?:https?:\/\/)?(?:www\.)?twitch\.tv\//i.test(text)) {
    try {
      const url = new URL(/^https?:\/\//i.test(text) ? text : "https://" + text);
      if (!["twitch.tv", "www.twitch.tv"].includes(url.hostname) || url.username || url.password) return "";
      const match = url.pathname.match(/^\/([a-z0-9_]{1,25})\/?$/i);
      return match ? match[1].toLowerCase() : "";
    } catch {
      return "";
    }
  }
  const name = text.replace(/^@/, "");
  return /^[a-z0-9_]{1,25}$/i.test(name) ? name.toLowerCase() : "";
}

function updateBudget() {
  const remaining = Math.ceil(balance("twitch") / 1000);
  $("remaining").textContent = Math.floor(remaining / 60) + ":" + String(remaining % 60).padStart(2, "0");
  $("watch").disabled = running || remaining === 0;
}

function stop() {
  closePlayer?.();
}

$("streamer-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (running) return;
  const channel = channelName($("streamer").value);
  if (!channel) {
    status.textContent = "Enter a Twitch username or a channel link such as twitch.tv/username.";
    return;
  }

  status.textContent = "";
  running = true;
  $("watch").disabled = true;
  try {
    closePlayer = watch("twitch", {
      start() {
        const parameters = new URLSearchParams({
          channel,
          parent: location.hostname,
          autoplay: "false",
        });
        const frame = document.createElement("iframe");
        frame.src = "https://player.twitch.tv/?" + parameters;
        frame.title = channel + " on Twitch";
        frame.allowFullscreen = true;
        frame.allow = "fullscreen; encrypted-media; picture-in-picture";
        $("frame").replaceChildren(frame);
        $("channel").textContent = channel;
        $("player").hidden = false;
        $("close").focus();
      },
      update: updateBudget,
      end(error) {
        running = false;
        closePlayer = undefined;
        $("frame").replaceChildren();
        $("player").hidden = true;
        try {
          updateBudget();
          status.textContent = error?.message || (balance("twitch") ? "" : "You’ve used today’s 15 minutes. Come back tomorrow.");
        } catch {
          status.textContent = "Browser storage is unavailable. Enable site storage to use the daily limit.";
          $("watch").disabled = true;
        }
      },
    });
  } catch (error) {
    running = false;
    closePlayer = undefined;
    status.textContent = error.message;
    $("watch").disabled = false;
  }
});

$("close").addEventListener("click", stop);
window.addEventListener("pagehide", stop);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stop();
  else refresh();
});
window.addEventListener("storage", refresh);

function refresh() {
  try { updateBudget(); }
  catch {
    $("watch").disabled = true;
    status.textContent = "Browser storage is unavailable. Enable site storage to use the daily limit.";
  }
}
refresh();
setInterval(refresh, 1000);
