"use strict";

const input = document.getElementById("api-key");
const status = document.getElementById("status");
const save = document.getElementById("save");
const remove = document.getElementById("remove");

document.getElementById("settings").addEventListener("submit", async (event) => {
  event.preventDefault();
  const deepseekKey = input.value.trim();
  if (!/^sk-[A-Za-z0-9_-]+$/.test(deepseekKey)) {
    status.textContent = "Enter a DeepSeek API key.";
    return;
  }

  save.disabled = true;
  remove.disabled = true;
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    await chrome.storage.local.set({ deepseekKey });
    input.value = "";
    await refresh("DeepSeek enabled. The key will be checked on your next digest request.");
  } catch {
    await refresh("Couldn’t save the key.");
  }
});

remove.addEventListener("click", async () => {
  save.disabled = true;
  remove.disabled = true;
  try {
    await chrome.storage.local.remove("deepseekKey");
    await refresh("DeepSeek disabled. Stillroom will use local matching.");
  } catch {
    await refresh("Couldn’t remove the key.");
  }
});

async function refresh(message) {
  try {
    const { deepseekKey } = await chrome.storage.local.get("deepseekKey");
    status.textContent = message || (deepseekKey ? "DeepSeek enabled." : "Local matching is active.");
    input.placeholder = deepseekKey ? "Enter a new key to replace the saved key" : "";
    remove.disabled = !deepseekKey;
  } catch {
    status.textContent = "Couldn’t read extension settings.";
  } finally {
    save.disabled = false;
  }
}

void refresh();
