import { useState, useEffect } from "react";
import { browser } from "wxt/browser";
import { getActiveTab } from "@/lib/active-tab";
export function useActiveTab() {
  const [tab, setTab] = useState<Awaited<
    ReturnType<typeof getActiveTab>
  > | null>(null);
  useEffect(() => {
    const update = () => {
      void getActiveTab().then(setTab);
    };
    update();
    browser.tabs.onActivated.addListener(update);
    browser.tabs.onUpdated.addListener(update);
    return () => {
      browser.tabs.onActivated.removeListener(update);
      browser.tabs.onUpdated.removeListener(update);
    };
  }, []);
  return tab;
}
