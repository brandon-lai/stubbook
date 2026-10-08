/* On-device OCR (tesseract.js, English LSTM model, self-hosted under /vendor).
 * One worker is created on first use and reused for every scan after that. */
import type { OcrWord } from "../types";

type TWorker = import("tesseract.js").Worker;
let worker: Promise<TWorker> | null = null;

export function warmOcr() {
  if (!worker) {
    worker = (async () => {
      const { createWorker, PSM } = await import("tesseract.js");
      const w = await createWorker("eng", 1, {
        workerPath: "/vendor/tesseract/worker.min.js",
        corePath: "/vendor/tesseract/core",
        langPath: "/vendor/tessdata",
        gzip: true,
      });
      // Sparse text: tickets are scattered labels and values, not paragraphs.
      await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: "1" });
      return w;
    })();
    worker.catch(() => { worker = null; });
  }
  return worker;
}

/** Reads words with boxes. The canvas may have transparent margins; they are flattened onto white. */
export async function readText(canvas: HTMLCanvasElement): Promise<{ words: OcrWord[]; confidence: number }> {
  const w = await warmOcr();
  // Long side around 1400px: large enough for small print, small enough to be quick.
  const k = Math.min(1.6, 1400 / Math.max(canvas.width, canvas.height));
  const c = document.createElement("canvas");
  c.width = Math.round(canvas.width * k);
  c.height = Math.round(canvas.height * k);
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(canvas, 0, 0, c.width, c.height);
  normalise(g, c.width, c.height);
  const words: OcrWord[] = [];
  let line = 0;
  const collect = (data: import("tesseract.js").Page, minConf: number, skipOverlaps: boolean) => {
    for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) {
      line++;
      for (const wd of l.words) {
        if (!wd.text.trim() || wd.confidence < minConf) continue;
        const box = { x: wd.bbox.x0 / k, y: wd.bbox.y0 / k, w: (wd.bbox.x1 - wd.bbox.x0) / k, h: (wd.bbox.y1 - wd.bbox.y0) / k };
        if (skipOverlaps && words.some((o) => overlaps(o.box, box))) continue;
        words.push({ text: wd.text, conf: wd.confidence, line, box });
      }
    }
  };
  const first = (await w.recognize(c, {}, { blocks: true })).data;
  collect(first, 20, false);
  return { words, confidence: first.confidence };
}

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ix * iy > 0.3 * Math.min(a.w * a.h, b.w * b.h);
}

/**
 * Grayscale and stretch contrast between the 2nd and 98th percentile. A ticket
 * shot in a dim room comes out as dark grey on darker grey, which tesseract's
 * own thresholding reads as nothing at all.
 */
function normalise(g: CanvasRenderingContext2D, W: number, H: number) {
  const im = g.getImageData(0, 0, W, H);
  const d = im.data;
  const hist = new Uint32Array(256);
  const lum = new Uint8Array(W * H);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const v = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    lum[j] = v;
    hist[lum[j]]++;
  }
  const n = W * H;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.02) { hi = v; break; } }
  const span = Math.max(24, hi - lo);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const v = Math.max(0, Math.min(255, ((lum[j] - lo) * 255) / span));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  g.putImageData(im, 0, 0);
}
