/**
 * Fetches the scanner runtimes (about 8 MB compressed) into the HTTP cache while
 * the user is looking at their collage, so the camera opens warm. On a first
 * visit over a phone connection these downloads were most of the time between
 * opening the camera and seeing the ticket land. Low priority, once per session,
 * and skipped when the browser asks to save data.
 */
const RUNTIMES = [
  "/vendor/opencv.js",
  "/vendor/zxing_reader.wasm",
  "/vendor/tesseract/worker.min.js",
  "/vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js",
  "/vendor/tessdata/eng.traineddata.gz",
];

export function prefetchRuntimes() {
  try {
    if (sessionStorage.getItem("runtimes-prefetched")) return;
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;
    sessionStorage.setItem("runtimes-prefetched", "1");
  } catch { /* storage blocked: prefetch anyway, it is only a cache warm-up */ }
  const go = () => { for (const u of RUNTIMES) void fetch(u, { priority: "low" } as RequestInit).catch(() => {}); };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (idle) idle(go, { timeout: 4000 }); else setTimeout(go, 1500);
}
