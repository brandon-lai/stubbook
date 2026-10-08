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
  const { data } = await w.recognize(c, {}, { blocks: true });
  const words: OcrWord[] = [];
  let line = 0;
  for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) {
    line++;
    for (const wd of l.words) {
      if (!wd.text.trim() || wd.confidence < 20) continue;
      words.push({
        text: wd.text,
        conf: wd.confidence,
        line,
        box: { x: wd.bbox.x0 / k, y: wd.bbox.y0 / k, w: (wd.bbox.x1 - wd.bbox.x0) / k, h: (wd.bbox.y1 - wd.bbox.y0) / k },
      });
    }
  }
  return { words, confidence: data.confidence };
}
