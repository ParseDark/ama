import { applyAnnotations } from "@/lib/annotation-layer";

// On-demand, extension-local bundle in the target document's isolated world.
export default defineUnlistedScript(() => {
  window.__amaApplyAnnotations = applyAnnotations;
});
