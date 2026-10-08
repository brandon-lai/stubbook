/**
 * Barcodes, two ways.
 *
 * decodeBarcodes(): zxing reads what it can. A boarding pass barcode decoded here
 * gives route, date and seat exactly.
 *
 * findBarcodeRegions(): finds anything barcode-shaped from the pixels alone,
 * decodable or not. This is the privacy pass. A barcode too blurry or dim for
 * zxing to read can still be read by someone with a better copy, so blurring only
 * what decoded would leave exactly the risky ones behind.
 */
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { withMats, type CV } from "./cv";
import type { Box, DecodedBarcode } from "../types";

let prepared = false;
function prepare() {
  if (prepared) return;
  prepared = true;
  prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? "/vendor/zxing_reader.wasm" : prefix + path) },
  });
}

export async function decodeBarcodes(img: ImageData): Promise<DecodedBarcode[]> {
  prepare();
  const res = await readBarcodes(img, {
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    maxNumberOfSymbols: 6,
    formats: ["PDF417", "Aztec", "QRCode", "DataMatrix", "Code128", "Code39", "ITF", "EAN-13", "MicroQRCode"],
  });
  return res
    .filter((r) => r.isValid)
    .map((r) => ({
      format: r.format,
      text: r.text,
      corners: [r.position.topLeft, r.position.topRight, r.position.bottomRight, r.position.bottomLeft].map((p) => [p.x, p.y] as [number, number]),
    }));
}

/** Barcode-like regions in an RGBA cv.Mat (a flattened ticket). */
export function findBarcodeRegions(cv: CV, src: CV): Box[] {
  return withMats((keep) => {
    const k = Math.min(1, 1000 / Math.max(src.cols, src.rows));
    const small = keep(new cv.Mat());
    cv.resize(src, small, new cv.Size(Math.round(src.cols * k), Math.round(src.rows * k)), 0, 0, cv.INTER_AREA);
    const W = small.cols, H = small.rows;
    const gray = keep(new cv.Mat());
    cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
    const out: Box[] = [];

    // 1D and stacked (PDF417): strong gradient across the bars, weak along them.
    for (const vertical of [false, true]) {
      const gx = keep(new cv.Mat()), gy = keep(new cv.Mat());
      cv.Sobel(gray, gx, cv.CV_32F, 1, 0, -1);
      cv.Sobel(gray, gy, cv.CV_32F, 0, 1, -1);
      cv.convertScaleAbs(gx, gx);
      cv.convertScaleAbs(gy, gy);
      const diff = keep(new cv.Mat());
      if (vertical) cv.subtract(gy, gx, diff); else cv.subtract(gx, gy, diff);
      cv.blur(diff, diff, new cv.Size(9, 9));
      const bin = keep(new cv.Mat());
      cv.threshold(diff, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      const kc = keep(cv.getStructuringElement(cv.MORPH_RECT, vertical ? new cv.Size(7, 21) : new cv.Size(21, 7)));
      cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, kc);
      const ke = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));
      cv.erode(bin, bin, ke, new cv.Point(-1, -1), 4);
      cv.dilate(bin, bin, ke, new cv.Point(-1, -1), 4);
      for (const r of blobs(cv, keep, bin)) {
        const along = vertical ? r.h : r.w, across = vertical ? r.w : r.h;
        // A barcode is a solid block: long enough, not a thin text line.
        if (r.w * r.h < W * H * 0.006 || along < W * 0.08 * (vertical ? H / W : 1) || across < 14) continue;
        if (!stripy(gray, r, vertical)) continue;
        out.push(r);
      }
    }

    // 2D (QR, Aztec, DataMatrix): dense, square, high-contrast blocks.
    {
      const edges = keep(new cv.Mat());
      cv.Canny(gray, edges, 60, 160);
      const dens = keep(new cv.Mat());
      const kSize = Math.max(9, Math.round(Math.min(W, H) * 0.035)) | 1;
      cv.boxFilter(edges, dens, -1, new cv.Size(kSize, kSize));
      const bin = keep(new cv.Mat());
      cv.threshold(dens, bin, 255 * 0.28, 255, cv.THRESH_BINARY);
      const kc = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kSize, kSize)));
      cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, kc);
      for (const r of blobs(cv, keep, bin)) {
        const aspect = r.w / r.h;
        if (aspect < 0.6 || aspect > 1.65 || r.w * r.h < W * H * 0.008 || Math.min(r.w, r.h) < 40) continue;
        if (!blocky(gray, r)) continue;
        out.push(r);
      }
    }

    return merge(out).map((r) => ({ x: r.x / k, y: r.y / k, w: r.w / k, h: r.h / k }));
  });
}

function blobs(cv: CV, keep: <M extends { delete(): void }>(m: M) => M, bin: CV): Box[] {
  const contours = keep(new cv.MatVector());
  const hier = keep(new cv.Mat());
  cv.findContours(bin, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  const out: Box[] = [];
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    const r = cv.boundingRect(c);
    const fill = cv.contourArea(c) / (r.width * r.height || 1);
    c.delete();
    if (fill > 0.55) out.push({ x: r.x, y: r.y, w: r.width, h: r.height });
  }
  return out;
}

/** Bars alternate dark/light many times along the scan line, at high contrast. */
function stripy(gray: CV, r: Box, vertical: boolean) {
  const d = gray.data as Uint8Array, W = gray.cols;
  let runs = 0, samples = 0;
  for (let t = 0.3; t <= 0.7; t += 0.2) {
    const vals: number[] = [];
    if (vertical) { const x = Math.round(r.x + r.w * t); for (let y = r.y; y < r.y + r.h; y++) vals.push(d[y * W + x]); }
    else { const y = Math.round(r.y + r.h * t); for (let x = r.x; x < r.x + r.w; x++) vals.push(d[y * W + x]); }
    const lo = Math.min(...vals), hi = Math.max(...vals), mid = (lo + hi) / 2;
    if (hi - lo < 50) continue;
    let flips = 0;
    for (let i = 1; i < vals.length; i++) if ((vals[i] > mid) !== (vals[i - 1] > mid)) flips++;
    runs += flips / vals.length; samples++;
  }
  return samples > 0 && runs / samples > 0.12;
}

/** QR-like: high contrast, roughly half dark, transitions in both directions. */
function blocky(gray: CV, r: Box) {
  const d = gray.data as Uint8Array, W = gray.cols;
  let dark = 0, n = 0, flipsX = 0, flipsY = 0, lo = 255, hi = 0;
  for (let y = r.y; y < r.y + r.h; y += 2) for (let x = r.x; x < r.x + r.w; x += 2) {
    const v = d[y * W + x]; lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  if (hi - lo < 80) return false;
  const mid = (lo + hi) / 2;
  for (let y = r.y; y < r.y + r.h; y += 2) for (let x = r.x + 2; x < r.x + r.w; x += 2) {
    const a = d[y * W + x] > mid, b = d[y * W + x - 2] > mid, c = y > r.y + 1 ? d[(y - 2) * W + x] > mid : a;
    if (!a) dark++;
    if (a !== b) flipsX++;
    if (a !== c) flipsY++;
    n++;
  }
  const df = dark / n;
  return df > 0.25 && df < 0.75 && flipsX / n > 0.12 && flipsY / n > 0.12;
}

function merge(boxes: Box[]): Box[] {
  const out: Box[] = [];
  for (const b of boxes.sort((a, c) => c.w * c.h - a.w * a.h)) {
    const hit = out.find((o) => {
      const ix = Math.max(0, Math.min(o.x + o.w, b.x + b.w) - Math.max(o.x, b.x));
      const iy = Math.max(0, Math.min(o.y + o.h, b.y + b.h) - Math.max(o.y, b.y));
      return ix * iy > 0.3 * Math.min(o.w * o.h, b.w * b.h);
    });
    if (hit) {
      const x0 = Math.min(hit.x, b.x), y0 = Math.min(hit.y, b.y);
      hit.w = Math.max(hit.x + hit.w, b.x + b.w) - x0; hit.h = Math.max(hit.y + hit.h, b.y + b.h) - y0; hit.x = x0; hit.y = y0;
    } else out.push({ ...b });
  }
  return out;
}
