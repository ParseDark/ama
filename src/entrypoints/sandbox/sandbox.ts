import { executeSandbox } from "@/lib/sandbox-runtime";

window.addEventListener("message", (event) => {
  if (event.source !== parent) return;
  const request = event.data;
  if (
    !request ||
    typeof request.id !== "string" ||
    typeof request.code !== "string"
  )
    return;
  executeSandbox(request, (response) => parent.postMessage(response, "*"));
});
// Sandboxed pages have an opaque origin, so postMessage requires '*'.
parent.postMessage({ type: "ama:sandbox-ready" }, "*");
