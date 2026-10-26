import ReactDOM from "react-dom/client";
import App from "./App";
import { connectPanel } from "@/lib/panel-connection";
import { panelShortcut } from "@/lib/shortcuts";
import { initializeCodeRunner, disposeCodeRunner } from "@/lib/code-runner";
import "@/styles/globals.css";
initializeCodeRunner();
window.addEventListener("pagehide", disposeCodeRunner, { once: true });
void connectPanel();
window.addEventListener("keydown", (e) => {
  const command = panelShortcut(e);
  if (command) {
    e.preventDefault();
    if (command === "close") window.close();
    else window.dispatchEvent(new Event("ama:clear-chat"));
  }
});
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
