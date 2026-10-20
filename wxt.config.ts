import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  // Avoid localhost resolving to another app's IPv4 listener while WXT binds
  // IPv6. Keep the listener and injected HMR origin on one explicit address.
  dev: {
    server: {
      host: "127.0.0.1",
      origin: "http://127.0.0.1:3197",
      port: 3197,
      strictPort: true,
    },
  },
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: "AMA — Ask Me Anything about this page",
    description:
      "Read the current page as Markdown and chat about it with any LLM provider.",
    permissions: [
      "sidePanel",
      "storage",
      "unlimitedStorage",
      "activeTab",
      "scripting",
      "tabs",
      "alarms",
    ],
    host_permissions: ["<all_urls>"],
    action: { default_title: "Open AMA" },
    commands: {
      "toggle-panel": {
        suggested_key: { default: "Ctrl+K", mac: "MacCtrl+K" },
        description: "Toggle the AMA side panel",
      },
      "clear-chat": {
        suggested_key: { default: "Ctrl+Shift+L", mac: "Alt+Shift+L" },
        description: "Clear the current AMA chat",
      },
    },
  },
});
