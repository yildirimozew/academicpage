import { balance, watch } from "./budget.js?v=2";

const $ = (id) => document.getElementById(id);
const status = $("status");
let closePlayer;
let running = false;

export function streamTarget(value, platform) {
  const text = value.trim();
  if (!text || !["twitch", "kick"].includes(platform)) return null;
  let channel = text.replace(/^@/, "");
  if (/^(?:https?:\/\/)?(?:www\.)?(?:twitch\.tv|kick\.com)\//i.test(text)) {
    try {
      const url = new URL(/^https?:\/\//i.test(text) ? text : "https://" + text);
      if (url.username || url.password || url.port) return null;
      const hosts = { "twitch.tv": "twitch", "www.twitch.tv": "twitch", "kick.com": "kick", "www.kick.com": "kick" };
      platform = hosts[url.hostname];
      if (!platform) return null;
      const match = url.pathname.match(/^\/([a-z0-9_-]+)\/?$/i);
      if (!match) return null;
      channel = match[1];
    } catch {
      return null;
    }
  }
  const valid = platform === "twitch" ? /^[a-z0-9_]{1,25}$/i : /^[a-z0-9_-]{1,25}$/i;
  return valid.test(channel) ? { channel: channel.toLowerCase(), platform } : null;
}

export function embedUrl({ channel, platform }, parent) {
  if (platform === "kick") {
    return "https://player.kick.com/" + encodeURIComponent(channel) + "?autoplay=false";
  }
  return "https://player.twitch.tv/?" + new URLSearchParams({ channel, parent, autoplay: "false" });
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
  const target = streamTarget($("streamer").value, $("platform").value);
  if (!target) {
    status.textContent = "Enter a username for the selected platform, or a Twitch or Kick channel link.";
    return;
  }

  $("platform").value = target.platform;
  status.textContent = "";
  running = true;
  $("watch").disabled = true;
  try {
    closePlayer = watch("twitch", {
      start() {
        const frame = document.createElement("iframe");
        frame.src = embedUrl(target, location.hostname);
        frame.title = target.channel + " on " + (target.platform === "kick" ? "Kick" : "Twitch");
        frame.allowFullscreen = true;
        frame.allow = "fullscreen; encrypted-media; picture-in-picture";
        $("frame").replaceChildren(frame);
        $("channel").textContent = target.channel + " · " + (target.platform === "kick" ? "Kick" : "Twitch");
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
