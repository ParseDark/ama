import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, settingsStore, type Settings } from "@/lib/settings";
export function useSettings() {
  const [settings, setState] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    void settingsStore.getValue().then((s) => {
      if (live) {
        setState(s);
        setLoaded(true);
      }
    });
    const off = settingsStore.watch((s) => {
      if (live) setState(s);
    });
    return () => {
      live = false;
      off();
    };
  }, []);
  const setSettings = (s: Settings) => {
    setState(s);
    void settingsStore.setValue(s);
  };
  return { settings, setSettings, loaded };
}
