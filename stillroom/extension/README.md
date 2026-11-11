# Yildirim's Instagram for Chrome

1. Extract the ZIP to a folder you can keep.
2. Open `chrome://extensions` in desktop Chrome and enable **Developer mode**.
3. Click **Load unpacked** and select the extracted `extension` folder. If you already installed an earlier version, replace its files and click **Reload** on its Chrome extensions card.
4. Open [Yildirim's Instagram](https://yildirimozen.com/stillroom/) in the same Chrome profile you use for Instagram. Click **Summarize Instagram** to check feed posts and Stories together. Enable DeepSeek for image review and summaries.

Each request opens an inactive Instagram tab, checks a small batch of posts, and closes the tab. With DeepSeek enabled, it decides whether to scroll up to three times and waits for newly loaded posts after each scroll. The latest successful check saves up to four matching posts in this browser. Enter “Clear saved posts” to delete them.

Instagram requires express permission for automated collection under its [Terms of Use](https://help.instagram.com/termsOfUse).

## View stories

Try “Show me stories from @username” to open that account's current story, or “Show me Instagram stories” to open the home feed's Stories tray and step through a few items. Instagram may record a view when the extension opens a story. Photo stories can appear inline, and video stories can show a still preview when Instagram provides one.

## Enable DeepSeek

In `chrome://extensions`, open **Yildirim's Instagram → Details → Extension options**. Enter a DeepSeek API key and click **Save and enable**. Chrome keeps the key in the extension’s local storage. The extension sends the prompt, candidate images, captions, and handles directly to DeepSeek. It reviews feed previews first, then reviews any additional carousel images before displaying a selected post. When DeepSeek cannot review the images, the check displays no unreviewed items.

Yildirim's Instagram opens selected posts to read carousel images and look for a playable Reel source. DeepSeek reviews available still images and video previews. Playable video comes from Instagram’s CDN, and the original link is available when playback is unavailable.
