# Stillroom for Chrome

1. Extract the ZIP to a folder you can keep.
2. Open `chrome://extensions` in desktop Chrome and enable **Developer mode**.
3. Click **Load unpacked** and select the extracted `extension` folder. If you already installed an earlier version, replace its files and click **Reload** on its Chrome extensions card.
4. Open [Stillroom](https://yildirimozen.com/stillroom/) in the same Chrome profile you use for Instagram. Try “Show me hiking posts” or “Show me posts from @username.”

The first request each day opens an inactive Instagram tab, checks a small batch of posts, and closes the tab. It saves up to four matching posts in this browser. Follow-up requests search those saved posts. Enter “Clear saved posts” to delete them.

Instagram requires express permission for automated collection under its [Terms of Use](https://help.instagram.com/termsOfUse).

## Enable DeepSeek

In `chrome://extensions`, open **Stillroom → Details → Extension options**. Enter a DeepSeek API key and click **Save and enable**. Chrome keeps the key in the extension’s local storage. The extension sends the prompt, captions, account handles, and image descriptions directly to DeepSeek for selection and summarization. Image files remain in Chrome. If DeepSeek is disabled or unavailable, Stillroom uses local keyword matching.
