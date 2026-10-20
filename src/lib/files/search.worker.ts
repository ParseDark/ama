import { decodeFile } from "./workspace";

self.onmessage = async ({
  data,
}: MessageEvent<{
  files: { path: string; handle: FileSystemFileHandle }[];
  query: string;
  caseSensitive: boolean;
  limit: number;
}>) => {
  let scannedBytes = 0,
    scannedFiles = 0,
    skippedFiles = 0,
    truncated = false;
  const matches: {
    path: string;
    line: number;
    column: number;
    preview: string;
  }[] = [];
  const needle = data.caseSensitive ? data.query : data.query.toLowerCase();
  for (const { path, handle } of data.files) {
    try {
      const file = await handle.getFile();
      if (scannedBytes + file.size > 8 * 1024 * 1024) {
        truncated = true;
        break;
      }
      // Bound both bytes read and CPU work, including unsupported files.
      scannedBytes += file.size;
      const text = await decodeFile(file);
      scannedFiles++;
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i],
          haystack = data.caseSensitive ? line : line.toLowerCase();
        const column = haystack.indexOf(needle);
        if (column !== -1) {
          matches.push({
            path,
            line: i + 1,
            column: column + 1,
            preview: line.slice(Math.max(0, column - 100), column + 300),
          });
          if (matches.length >= data.limit) {
            truncated = true;
            break;
          }
        }
      }
      if (truncated) break;
    } catch {
      skippedFiles++;
    }
  }
  self.postMessage({
    matches,
    scannedFiles,
    scannedBytes,
    skippedFiles,
    truncated,
  });
};
