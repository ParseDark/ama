// Imported as raw source: Vite must not inject preload helpers into this Worker.
const send = self.postMessage.bind(self);
const text = (value) => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};
for (const level of ["log", "info", "warn", "error", "debug"]) {
  console[level] = (...args) =>
    send({ type: "log", text: args.map(text).join(" ") });
}
self.onmessage = async (event) => {
  let url;
  try {
    url = URL.createObjectURL(
      new Blob([event.data.code], { type: "text/javascript" }),
    );
    const module = await import(url);
    if (typeof module.default !== "function")
      throw new Error("Code must export default async function(input).");
    const value = await module.default(event.data.input);
    const json = JSON.stringify(value);
    if (json === undefined)
      throw new Error("Return value must be JSON-serializable.");
    send({ type: "result", result: JSON.parse(json) });
  } catch (error) {
    send({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
};
