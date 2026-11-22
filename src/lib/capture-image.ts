export const MAX_CAPTURE_BYTES = 768 * 1024;
export type CaptureImage = {
  bytes: Uint8Array;
  width: number;
  height: number;
  coverage?: { start: number; end: number; total: number; partial: boolean };
};

export async function decodeCapture(url: string) {
  if (!/^data:image\/(jpeg|png);base64,/.test(url))
    throw new Error("Chrome did not return a screenshot image.");
  return createImageBitmap(await (await fetch(url)).blob());
}

export async function encodeCapture(
  canvas: OffscreenCanvas,
  signal?: AbortSignal,
): Promise<CaptureImage> {
  let current = canvas;
  for (let pass = 0; pass < 4; pass++) {
    for (const quality of [0.86, 0.73, 0.6]) {
      signal?.throwIfAborted();
      const blob = await current.convertToBlob({ type: "image/jpeg", quality });
      if (blob.size <= MAX_CAPTURE_BYTES && blob.type === "image/jpeg") {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        signal?.throwIfAborted();
        return { bytes, width: current.width, height: current.height };
      }
    }
    const smaller = new OffscreenCanvas(
      Math.max(1, Math.floor(current.width * 0.8)),
      Math.max(1, Math.floor(current.height * 0.8)),
    );
    smaller
      .getContext("2d")!
      .drawImage(current, 0, 0, smaller.width, smaller.height);
    current = smaller;
  }
  throw new Error("The screenshot exceeds the image size limit.");
}

export async function normalizeViewport(url: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const image = await decodeCapture(url);
  try {
    signal?.throwIfAborted();
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(image.width * scale)),
      Math.max(1, Math.round(image.height * scale)),
    );
    canvas
      .getContext("2d")!
      .drawImage(image, 0, 0, canvas.width, canvas.height);
    return await encodeCapture(canvas, signal);
  } finally {
    image.close();
  }
}
