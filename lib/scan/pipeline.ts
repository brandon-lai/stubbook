/**
 * The capture pipeline, in three stages so the UI can show progress:
 *
 *   locate()  where is the ticket (corners) and is it paper or a digital pass
 *   cut()     flatten it and cut it out
 *   read()    barcodes, text, what to blur, and the parsed fields
 *
 * Every stage is timed; the 15-second capture goal is measured from these.
 */
import { decodeBarcodes, findBarcodeRegions } from "./barcode";
import { renderBlurred } from "./blur";
import { cutDigital, cutPaper, warp } from "./cutout";
import { loadCv, withMats, type CV } from "./cv";
import { detectQuad } from "./detect";
import type { Quad } from "./geometry";
import { readText, warmOcr } from "./ocr";
import { parseTicket } from "../parse";
import { findKnown, findSensitive } from "../sensitive";
import { parseBcbp } from "../bcbp";
import type { BlurBox, DecodedBarcode, OcrWord, ParseResult } from "../types";

export type SourceMode = "camera" | "image" | "pdf";
export type Kind = "paper" | "digital";

export interface Located {
  corners: Quad;
  detected: boolean;
  kind: Kind;
  method: string;
  score: number;
}

export interface ReadResult {
  barcodes: DecodedBarcode[];
  words: OcrWord[];
  boxes: BlurBox[];
  parse: ParseResult;
  ocrConfidence: number;
}

export const timings: Record<string, number> = {};
const timed = async <T>(name: string, fn: () => Promise<T> | T): Promise<T> => {
  const t0 = performance.now();
  try { return await fn(); } finally { timings[name] = Math.round(performance.now() - t0); }
};

/** Start the heavy downloads (OpenCV, OCR model) before the user needs them. */
export function warmUp() {
  void loadCv().catch(() => {});
  void warmOcr()?.catch(() => {});
}

const fullQuad = (w: number, h: number): Quad => [[0, 0], [w, 0], [w, h], [0, h]];

export async function locate(source: HTMLCanvasElement, mode: SourceMode): Promise<Located> {
  const cv = await timed("load", loadCv);
  return timed("locate", () => withMats((keep) => {
    const W = source.width, H = source.height;
    if (mode === "pdf") return { corners: contentBox(source), detected: true, kind: "digital" as Kind, method: "content", score: 1 };
    const src = keep(cv.imread(source));
    const det = detectQuad(cv, src);
    const screenshot = mode === "image" && H / W > 1.85;
    if (mode === "camera") return det ? { ...det, detected: true, kind: "paper" as Kind } : { corners: insetQuad(W, H, 0.12), detected: false, kind: "paper" as Kind, method: "none", score: 0 };
    if (screenshot) return det ? { ...det, detected: true, kind: "digital" as Kind } : { corners: fullQuad(W, H), detected: false, kind: "digital" as Kind, method: "none", score: 0 };
    // A photo from the library: if a ticket is found inside it, treat it like a
    // camera scan. If the image already is the ticket (a tight crop or a scan),
    // keep it whole as a flat card.
    // What lies outside the outline decides it: a table or desk is plain (edge
    // density 0.000-0.014 on the real photos), while a tight crop's "outside" is
    // more ticket print (0.028-0.112). Measured on fixtures/real.
    if (det) {
      const xs = det.corners.map((p) => p[0]), ys = det.corners.map((p) => p[1]);
      const frac = ((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))) / (W * H);
      if (frac < 0.88 && outsideEdgeDensity(cv, src, det.corners) < 0.02) return { ...det, detected: true, kind: "paper" as Kind };
    }
    return { corners: fullQuad(W, H), detected: false, kind: "digital" as Kind, method: "whole", score: 0 };
  }));
}

export async function cut(source: HTMLCanvasElement, corners: Quad, kind: Kind): Promise<HTMLCanvasElement> {
  const cv = await loadCv();
  return timed("cut", () => withMats((keep) => {
    const src = keep(cv.imread(source));
    const w = warp(cv, src, corners, kind === "paper" ? undefined : 0.01);
    return kind === "paper" ? cutPaper(cv, w) : cutDigital(cv, w);
  }));
}

export async function read(cutout: HTMLCanvasElement): Promise<ReadResult> {
  const cv = await loadCv();
  const g = cutout.getContext("2d", { willReadFrequently: true })!;
  const img = g.getImageData(0, 0, cutout.width, cutout.height);
  const [barcodes, regions, ocr] = await Promise.all([
    timed("decode", () => decodeBarcodes(flatten(img)).catch(() => [] as DecodedBarcode[])),
    timed("regions", () => withMats((keep) => findBarcodeRegions(cv, keep(cv.matFromImageData(img))))),
    timed("ocr", () => readText(cutout).catch(() => ({ words: [] as OcrWord[], confidence: 0 }))),
  ]);
  const boxes: BlurBox[] = [];
  let n = 0;
  const add = (b: BlurBox) => { if (!boxes.some((o) => overlap(o, b) > 0.6)) boxes.push({ ...b, id: `b${++n}` }); };
  for (const b of barcodes) add({ id: "", reason: "barcode", ...barcodeBox(img, b) });
  for (const r of regions) add({ id: "", reason: "barcode", ...r });
  const flagged = findSensitive(ocr.words);
  for (const s of flagged) add(s);
  // Secrets known for this ticket: the barcode's booking reference, plus every
  // token flagged above. Each is blurred wherever else it is printed.
  const secrets = [
    ...barcodes.map((b) => parseBcbp(b.text)?.legs[0]?.pnr ?? "").filter(Boolean),
    ...flagged.map((f) => wordsIn(ocr.words, f).join("")),
  ];
  for (const k of findKnown(ocr.words, secrets)) add(k);

  // Second look. OCR is sensitive to small changes in the image, so read the
  // blurred result again: anything sensitive it can still read gets blurred too.
  // This pass found a booking reference under glare that the first pass missed.
  const again = await timed("verify", () => readText(renderBlurred(cutout, boxes)).catch(() => ({ words: [] as OcrWord[], confidence: 0 })));
  for (const s of [...findSensitive(again.words), ...findKnown(again.words, secrets)]) add(s);

  // And the guarantee: decode the blurred result; any barcode that still reads
  // gets its box grown until it does not.
  await timed("verify-codes", async () => {
    for (let round = 0; round < 4; round++) {
      const out = renderBlurred(cutout, boxes);
      const raw = out.getContext("2d")!.getImageData(0, 0, out.width, out.height);
      // Viewed on a light page or a dark one, and with the alpha channel stripped.
      const left = (await Promise.all([flatten(raw), flatten(raw, 0), opaque(raw)].map((im) => decodeBarcodes(im).catch(() => [])))).flat();
      if (!left.length) return;
      for (const b of left) {
        const box = barcodeBox(img, b);
        const hit = boxes.find((o) => o.reason === "barcode" && overlap(o, box) > 0.3);
        const g = 0.25 * (round + 1);
        const grow = (o: { x: number; y: number; w: number; h: number }) => ({ x: o.x - o.w * g, y: o.y - o.h * g * 2, w: o.w * (1 + 2 * g), h: o.h * (1 + 4 * g) });
        if (hit) Object.assign(hit, grow(hit)); else boxes.push({ id: `b${++n}`, reason: "barcode", ...grow(box) });
      }
    }
  });

  return { barcodes, words: ocr.words, boxes, parse: parseTicket(ocr.words, barcodes), ocrConfidence: ocr.confidence };
}

const LINEAR = /Code|EAN|UPC|ITF|Codabar|DataBar/i;

/**
 * The box to blur for a decoded barcode. For 2D codes zxing's corners are the
 * symbol. For 1D codes they are only the scanline it read, a thin strip, so grow
 * across the bars while each row repeats the scanline's bar pattern.
 */
function barcodeBox(img: ImageData, b: DecodedBarcode) {
  const xs = b.corners.map((p) => p[0]), ys = b.corners.map((p) => p[1]);
  let x0 = Math.max(0, Math.min(...xs)), x1 = Math.min(img.width - 1, Math.max(...xs));
  let y0 = Math.max(0, Math.min(...ys)), y1 = Math.min(img.height - 1, Math.max(...ys));
  if (!LINEAR.test(b.format)) return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const horizontal = x1 - x0 >= y1 - y0;
  const lum = (x: number, y: number) => { const i = (Math.round(y) * img.width + Math.round(x)) * 4; return img.data[i] * 0.3 + img.data[i + 1] * 0.59 + img.data[i + 2] * 0.11; };
  const pattern = (t: number) => {
    const vals: number[] = [];
    const n = 120;
    for (let k = 0; k < n; k++) vals.push(horizontal ? lum(x0 + ((x1 - x0) * k) / n, t) : lum(t, y0 + ((y1 - y0) * k) / n));
    const mid = (Math.min(...vals) + Math.max(...vals)) / 2;
    return vals.map((v) => v < mid);
  };
  const ref = pattern(horizontal ? (y0 + y1) / 2 : (x0 + x1) / 2);
  const same = (t: number) => { const p = pattern(t); return p.filter((v, i) => v === ref[i]).length / p.length > 0.75; };
  const span = horizontal ? x1 - x0 : y1 - y0;
  if (horizontal) {
    while (y0 > 0 && y0 > Math.min(...ys) - span && same(y0 - 1)) y0--;
    while (y1 < img.height - 1 && y1 < Math.max(...ys) + span && same(y1 + 1)) y1++;
  } else {
    while (x0 > 0 && x0 > Math.min(...xs) - span && same(x0 - 1)) x0--;
    while (x1 < img.width - 1 && x1 < Math.max(...xs) + span && same(x1 + 1)) x1++;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function wordsIn(words: OcrWord[], b: { x: number; y: number; w: number; h: number }) {
  return words.filter((w) => overlap(w.box, b) > 0.7).map((w) => w.text);
}

export { renderBlurred };

/** zxing reads RGBA but ignores alpha; transparent margins would read as black. */
function flatten(img: ImageData, bg = 255): ImageData {
  const d = new Uint8ClampedArray(img.data);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    d[i] = d[i] * a + bg * (1 - a); d[i + 1] = d[i + 1] * a + bg * (1 - a); d[i + 2] = d[i + 2] * a + bg * (1 - a); d[i + 3] = 255;
  }
  return new ImageData(d, img.width, img.height);
}

function opaque(img: ImageData): ImageData {
  const d = new Uint8ClampedArray(img.data);
  for (let i = 3; i < d.length; i += 4) d[i] = 255;
  return new ImageData(d, img.width, img.height);
}

function overlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (ix * iy) / Math.min(a.w * a.h, b.w * b.h || 1);
}
const contains = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => overlap(a, b) > 0.8;

/** Share of edge pixels outside the quad (a band around the outline excluded). */
function outsideEdgeDensity(cv: CV, src: CV, q: Quad) {
  return withMats((keep) => {
    const k = 640 / Math.max(src.cols, src.rows);
    const small = keep(new cv.Mat());
    cv.resize(src, small, new cv.Size(Math.round(src.cols * k), Math.round(src.rows * k)), 0, 0, cv.INTER_AREA);
    const g = keep(new cv.Mat());
    cv.cvtColor(small, g, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(g, g, new cv.Size(5, 5), 0);
    const e = keep(new cv.Mat());
    cv.Canny(g, e, 50, 150);
    const mask = keep(new cv.Mat(g.rows, g.cols, cv.CV_8UC1, new cv.Scalar(0)));
    const pts = keep(cv.matFromArray(4, 1, cv.CV_32SC2, q.flatMap(([x, y]) => [Math.round(x * k), Math.round(y * k)])));
    const vec = keep(new cv.MatVector());
    vec.push_back(pts);
    cv.fillPoly(mask, vec, new cv.Scalar(255));
    const k9 = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9)));
    cv.dilate(mask, mask, k9);
    const ed = e.data as Uint8Array, md = mask.data as Uint8Array;
    let n = 0, hits = 0;
    for (let i = 0; i < md.length; i++) if (!md[i]) { n++; if (ed[i]) hits++; }
    return n ? hits / n : 0;
  });
}

function insetQuad(W: number, H: number, f: number): Quad {
  return [[W * f, H * f], [W * (1 - f), H * f], [W * (1 - f), H * (1 - f)], [W * f, H * (1 - f)]];
}

/** Bounding box of everything that is not near-white: the printed area of a PDF page. */
function contentBox(c: HTMLCanvasElement): Quad {
  const g = c.getContext("2d", { willReadFrequently: true })!;
  const { data, width: W, height: H } = g.getImageData(0, 0, c.width, c.height);
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const i = (y * W + x) * 4;
    if (data[i] + data[i + 1] + data[i + 2] < 720) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 <= x0 || y1 <= y0) return fullQuad(W, H);
  const p = Math.round(Math.min(W, H) * 0.03);
  x0 = Math.max(0, x0 - p); y0 = Math.max(0, y0 - p); x1 = Math.min(W, x1 + p); y1 = Math.min(H, y1 + p);
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}
