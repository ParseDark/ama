import { beforeEach } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
beforeEach(() => {
  fakeBrowser.reset();
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-ama-next-id");
});
