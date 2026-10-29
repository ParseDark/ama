import { browser } from "wxt/browser";
import { PanelTracker } from "@/lib/panel-connection";
import { runLearning } from "@/lib/memory/learning";
import { startConfigSync } from "@/lib/config-sync";
export default defineBackground(() => {
  startConfigSync();
  const tracker = new PanelTracker();
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  browser.runtime.onConnect.addListener((port) => {
    const m = /^sidepanel:(\d+)$/.exec(port.name);
    if (!m) return;
    const remove = tracker.add(Number(m[1]), port);
    port.onMessage.addListener(() => {});
    port.onDisconnect.addListener(() => {
      remove();
      void browser.alarms.create("memory-learn-soon", { delayInMinutes: 1 });
    });
  });
  browser.commands.onCommand.addListener((command, tab) => {
    const id = tab?.windowId;
    if (id === undefined) return;
    if (command === "toggle-panel")
      void Promise.resolve(tracker.toggle(id)).catch(console.error);
    if (command === "clear-chat") tracker.clear(id);
  });
  void browser.alarms.get("memory-learn-daily").then((a) => {
    if (!a)
      void browser.alarms.create("memory-learn-daily", {
        periodInMinutes: 24 * 60,
      });
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (["memory-learn-soon", "memory-learn-daily"].includes(alarm.name))
      void runLearning();
  });
});
