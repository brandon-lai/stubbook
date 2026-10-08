/**
 * Irreversible blur for sensitive regions, applied to pixels (not CSS), so the
 * blurred image is its own file and the only one a shared collage ever sees.
 *
 * Each region is averaged into coarse cells, smoothed, and dusted with paper
 * grain so it still looks like part of the ticket. A light Gaussian over text
 * can be partly undone; averaging whole characters into one cell cannot.
 */
import type { Box } from "../types";

export function renderBlurred(src: HTMLCanvasElement, boxes: (Box & { reason?: string })[], seed = 1): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const g = out.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(src, 0, 0);
  for (const raw of boxes) {
    const b = padBox(raw, out.width, out.height);
    if (b.w < 2 || b.h < 2) continue;
    // Cell size: about one character for text, about a tenth of a barcode.
    const cell = Math.max(8, raw.reason === "barcode" ? Math.min(b.w, b.h) / 9 : raw.h * 0.75);
    blurRegion(g, b, cell, seed++);
  }
  return out;
}

function padBox(b: Box & { reason?: string }, W: number, H: number): Box {
  const p = b.reason === "barcode" ? Math.min(b.w, b.h) * 0.08 : b.h * 0.4;
  const x = Math.max(0, Math.floor(b.x - p)), y = Math.max(0, Math.floor(b.y - p));
  return { x, y, w: Math.min(W, Math.ceil(b.x + b.w + p)) - x, h: Math.min(H, Math.ceil(b.y + b.h + p)) - y };
}

function blurRegion(g: CanvasRenderingContext2D, b: Box, cell: number, seed: number) {
  const img = g.getImageData(b.x, b.y, b.w, b.h);
  const d = img.data, W = b.w, H = b.h;
  const cw = Math.max(1, Math.ceil(W / cell)), chh = Math.max(1, Math.ceil(H / cell));
  // 1. Cell averages (colour only; alpha keeps the cut-out's shape).
  const sums = new Float64Array(cw * chh * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, c = (Math.min(chh - 1, Math.floor(y / cell)) * cw + Math.min(cw - 1, Math.floor(x / cell))) * 4;
    const a = d[i + 3] / 255;
    sums[c] += d[i] * a; sums[c + 1] += d[i + 1] * a; sums[c + 2] += d[i + 2] * a; sums[c + 3] += a;
  }
  // 2. Bilinear between cell centres, so the cells read as a smear, not mosaic.
  const at = (cx: number, cy: number, ch: number) => {
    cx = Math.max(0, Math.min(cw - 1, cx)); cy = Math.max(0, Math.min(chh - 1, cy));
    const c = (cy * cw + cx) * 4, a = sums[c + 3];
    return a > 0 ? sums[c + ch] / a : 255;
  };
  let s = seed * 2654435761;
  const rand = () => ((s = (s ^ (s << 13)) >>> 0, s = (s ^ (s >>> 17)) >>> 0, s = (s ^ (s << 5)) >>> 0) / 4294967296);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const fx = x / cell - 0.5, fy = y / cell - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const i = (y * W + x) * 4;
    const grain = (rand() - 0.5) * 10;
    for (let ch = 0; ch < 3; ch++) {
      const v = at(x0, y0, ch) * (1 - tx) * (1 - ty) + at(x0 + 1, y0, ch) * tx * (1 - ty) + at(x0, y0 + 1, ch) * (1 - tx) * ty + at(x0 + 1, y0 + 1, ch) * tx * ty;
      d[i + ch] = Math.max(0, Math.min(255, v + grain));
    }
  }
  g.putImageData(img, b.x, b.y);
}
