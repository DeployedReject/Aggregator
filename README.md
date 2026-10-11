# Aggregator

> All your media sites in one unified place.

Aggregator is a modular media aggregation extension for **Firefox** and **Chromium-based browsers** paired with an isolated web application frontend. It decouples media providers from UI logic using an extensible plugin engine, an in-browser request proxy gateway, and a decentralized plugin registry model.

---

## Key Features

- **Extensible Plugin Engine:** Plugins are self-contained JavaScript modules defining how to search, enumerate episodes/media items, and resolve stream URLs.
- **Local Plugin Loading:** Users can load custom `.js` or `.json` plugins directly from their local machine without relying on any external server or registry.
- **Custom / Self-Hosted Server Support:** Users can configure any backend server registry URL (or run their own instance of [Aggregator-Backend](https://github.com/DeployedReject/Aggregator-Backend)).
- **Sample Plugins Repository:** The default [Aggregator-Plugins](https://github.com/DeployedReject/Aggregator-Plugins) repository acts as a public sample repository demonstrating safe, public-domain media sources (such as the Internet Archive plugin).
- **In-Browser Proxy Gateway:** Bypasses CORS, Referer, and hotlink protections in media requests securely from within the extension runtime.
- **Integrated Adblock Engine:** Dynamic tracker and popup blocker based on EasyList syntax.
- **Isolated Sandbox Execution:** Evaluates third-party plugin scripts inside isolated sandbox iframes to protect user browsing security.

---

## Loading Plugins Locally

You can load your own custom plugins without hosting a server:

1. Click the Aggregator extension icon to open the popup.
2. Select **Add Plugin** $\rightarrow$ **Load Local Plugin (.js / .json)** (or click **+ Load Local Plugin File** in **Manage Installed Plugins**).
3. Pick any valid plugin file from your computer.
4. Aggregator will parse the manifest, register the plugin in local storage, and immediately make it available in the web player.

### Plugin Template (`my-plugin.js`)

```javascript
export default {
  id: "my-custom-plugin",
  name: "My Custom Source",
  baseUrl: "https://example.com",
  version: "1.0.0",
  author: "Community",

  async getHome() {
    return this.search("");
  },

  async search(query) {
    // Return array of: { id, title, description, coverUrl, url }
    return [];
  },

  async getEpisodes(mediaId) {
    // Return array of: { id, number, title, url }
    return [];
  },

  async getStreams(episodeId) {
    // Return array of streams:
    // Direct: { mode: "direct", url: "https://...", type: "video/mp4" }
    // Sniff: { mode: "background_sniff", targetUrl: "https://...", mediaPatterns: [...] }
    return [];
  },
};
```

---

## Connecting to a Self-Hosted Registry

To connect Aggregator to your own or a community plugin server:

1. Open the Aggregator popup.
2. Click **Settings & Server Config**.
3. In **Registry / Backend Server URL**, enter your server's URL (e.g. `http://localhost:8080` or `https://registry.yourdomain.com`).
4. Click **Save Settings**.

---

## Installation & Development

### 1. Build the Web Application
```bash
cd super-website/super-website
npm install
npm run build
```

### 2. Load into Firefox
1. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select `manifest.json` in the root of the `Aggregator` directory.

### 3. Load into Chrome / Edge / Brave
1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `Aggregator` directory.

---

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE).
