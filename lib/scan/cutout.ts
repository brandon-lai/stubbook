/**
 * Perspective correction and the cut-out.
 *
 * warp() flattens the ticket to a rectangle with a margin of surface around it.
 * cutPaper() then separates paper from surface inside that margin with GrabCut,
 * so torn edges, rounded corners and perforated stubs keep their real outline
 * instead of becoming a hard rectangle. Two guard rails keep GrabCut honest when
 * paper and surface look alike (white on white): the ticket's inner body is
 * always kept, and nothing well outside the detected outline is.
 */
import { withMats, type CV } from "./cv";
import { dist, type Quad } from "./geometry";

export const MARGIN = 0.05;
const MAX_LONG = 1600;

export interface Warped {
  canvas: HTMLCanvasElement;
  /** Size of the ticket itself inside the margin. */
  inner: { x: number; y: number; w: number; h: number };
}

export function warp(cv: CV, src: CV, q: Quad, margin = MARGIN): Warped {
  return withMats((keep) => {
    let w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
    let h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
    const k = Math.min(1, MAX_LONG / Math.max(w, h));
    w = Math.round(w * k); h = Math.round(h * k);
    const mx = Math.round(w * margin), my = Math.round(h * margin);
    const mm = Math.max(mx, my);
    const W = w + 2 * mm, H = h + 2 * mm;
    const from = keep(cv.matFromArray(4, 1, cv.CV_32FC2, q.flat()));
    const to = keep(cv.matFromArray(4, 1, cv.CV_32FC2, [mm, mm, mm + w, mm, mm + w, mm + h, mm, mm + h]));
    const M = keep(cv.getPerspectiveTransform(from, to));
    const out = keep(new cv.Mat());
    cv.warpPerspective(src, out, M, new cv.Size(W, H), cv.INTER_CUBIC, cv.BORDER_REPLICATE);
    const canvas = document.createElement("canvas");
    cv.imshow(canvas, out);
    return { canvas, inner: { x: mm, y: mm, w, h } };
  });
}

/** Paper path: GrabCut alpha, then crop to the ticket. */
export function cutPaper(cv: CV, warped: Warped): HTMLCanvasElement {
  return withMats((keep) => {
    const full = keep(cv.imread(warped.canvas));
    const FW = full.cols, FH = full.rows;
    const { x, y, w, h } = warped.inner;
    const k = Math.min(1, 460 / Math.max(FW, FH));
    const sw = Math.round(FW * k), sh = Math.round(FH * k);
    const small = keep(new cv.Mat());
    cv.resize(full, small, new cv.Size(sw, sh), 0, 0, cv.INTER_AREA);
    const rgb = keep(new cv.Mat());
    cv.cvtColor(small, rgb, cv.COLOR_RGBA2RGB);

    // Seed: margin = surface, outline band = undecided, body = paper.
    const mask = keep(new cv.Mat(sh, sw, cv.CV_8UC1, new cv.Scalar(cv.GC_BGD)));
    const rect = (inset: number, val: number) => {
      const ix = (x + w * inset) * k, iy = (y + h * inset) * k;
      cv.rectangle(mask, new cv.Point(Math.round(ix), Math.round(iy)), new cv.Point(Math.round((x + w) * k - w * inset * k), Math.round((y + h) * k - h * inset * k)), new cv.Scalar(val), -1);
    };
    rect(-0.015, cv.GC_PR_BGD);
    rect(0.0, cv.GC_PR_FGD);
    rect(0.1, cv.GC_FGD);
    const bgd = keep(new cv.Mat()), fgd = keep(new cv.Mat());
    try {
      cv.grabCut(rgb, mask, new cv.Rect(0, 0, 1, 1), bgd, fgd, 3, cv.GC_INIT_WITH_MASK);
    } catch {
      /* fall through with the seed mask: a plain rectangle cut-out */
    }
    const fg = keep(new cv.Mat());
    const md = mask.data as Uint8Array;
    const fgArr = new Uint8Array(md.length);
    for (let i = 0; i < md.length; i++) fgArr[i] = md[i] === cv.GC_FGD || md[i] === cv.GC_PR_FGD ? 255 : 0;
    fg.create(sh, sw, cv.CV_8UC1);
    (fg.data as Uint8Array).set(fgArr);

    // Back to full size with smooth edges.
    const big = keep(new cv.Mat());
    cv.resize(fg, big, new cv.Size(FW, FH), 0, 0, cv.INTER_LINEAR);
    cv.GaussianBlur(big, big, new cv.Size(0, 0), Math.max(1.5, 1 / k * 0.8));
    cv.threshold(big, big, 127, 255, cv.THRESH_BINARY);

    // Guard rails. Keep the body (a rounded rectangle inset 2.5%, so real rounded
    // corners survive); drop anything more than 1.5% outside the outline.
    const guardIn = keep(new cv.Mat(FH, FW, cv.CV_8UC1, new cv.Scalar(0)));
    roundRect(cv, guardIn, x + w * 0.025, y + h * 0.025, w * 0.95, h * 0.95, Math.min(w, h) * 0.08);
    cv.bitwise_or(big, guardIn, big);
    const guardOut = keep(new cv.Mat(FH, FW, cv.CV_8UC1, new cv.Scalar(0)));
    cv.rectangle(guardOut, new cv.Point(Math.round(x - w * 0.015), Math.round(y - h * 0.015)), new cv.Point(Math.round(x + w * 1.015), Math.round(y + h * 1.015)), new cv.Scalar(255), -1);
    cv.bitwise_and(big, guardOut, big);
    largestComponentFilled(cv, keep, big);

    // Feathered alpha: a one-pixel soft edge reads as paper, a hard edge as a sticker.
    cv.GaussianBlur(big, big, new cv.Size(0, 0), 0.9);
    return applyAlphaAndCrop(cv, keep, full, big);
  });
}

/**
 * Digital path (screenshots, PDFs, flat crops): no background to remove. The
 * pass keeps its own look, with softly rounded corners so it sits on the board
 * like a card. Its edges are already the pass's edges.
 */
export function cutDigital(cv: CV, warped: Warped, radius = 0.03): HTMLCanvasElement {
  return withMats((keep) => {
    const full = keep(cv.imread(warped.canvas));
    const { x, y, w, h } = warped.inner;
    const a = keep(new cv.Mat(full.rows, full.cols, cv.CV_8UC1, new cv.Scalar(0)));
    roundRect(cv, a, x, y, w, h, Math.min(w, h) * radius);
    cv.GaussianBlur(a, a, new cv.Size(0, 0), 0.7);
    return applyAlphaAndCrop(cv, keep, full, a);
  });
}

function roundRect(cv: CV, m: CV, x: number, y: number, w: number, h: number, r: number) {
  const s = new cv.Scalar(255);
  r = Math.max(1, Math.min(r, w / 2, h / 2));
  cv.rectangle(m, new cv.Point(Math.round(x + r), Math.round(y)), new cv.Point(Math.round(x + w - r), Math.round(y + h)), s, -1);
  cv.rectangle(m, new cv.Point(Math.round(x), Math.round(y + r)), new cv.Point(Math.round(x + w), Math.round(y + h - r)), s, -1);
  for (const [cx, cy] of [[x + r, y + r], [x + w - r, y + r], [x + w - r, y + h - r], [x + r, y + h - r]]) cv.circle(m, new cv.Point(Math.round(cx), Math.round(cy)), Math.round(r), s, -1);
}

function largestComponentFilled(cv: CV, keep: <M extends { delete(): void }>(m: M) => M, bin: CV) {
  const contours = keep(new cv.MatVector());
  const hier = keep(new cv.Mat());
  cv.findContours(bin, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);
  let bi = -1, ba = 0;
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    const a = cv.contourArea(c);
    c.delete();
    if (a > ba) { ba = a; bi = i; }
  }
  bin.setTo(new cv.Scalar(0));
  if (bi >= 0) cv.drawContours(bin, contours, bi, new cv.Scalar(255), -1);
}

function applyAlphaAndCrop(cv: CV, keep: <M extends { delete(): void }>(m: M) => M, rgba: CV, alpha: CV): HTMLCanvasElement {
  const ch = keep(new cv.MatVector());
  cv.split(rgba, ch);
  const merged = keep(new cv.Mat());
  const v = keep(new cv.MatVector());
  for (let i = 0; i < 3; i++) { const c = ch.get(i); keep(c); v.push_back(c); }
  v.push_back(alpha);
  cv.merge(v, merged);
  const r = cv.boundingRect(alpha);
  const pad = 2;
  const x = Math.max(0, r.x - pad), y = Math.max(0, r.y - pad);
  const roi = merged.roi(new cv.Rect(x, y, Math.min(merged.cols - x, r.width + 2 * pad), Math.min(merged.rows - y, r.height + 2 * pad)));
  keep(roi);
  const canvas = document.createElement("canvas");
  cv.imshow(canvas, roi);
  // Fully transparent pixels still carry the photo's colours, and PNG/WebP keep
  // them. Strip the alpha channel and the surface (and any ticket the mask
  // trimmed, like the top of a barcode) would reappear. Wipe them to white.
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  const im = g.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < im.data.length; i += 4) if (im.data[i + 3] === 0) { im.data[i] = 255; im.data[i + 1] = 255; im.data[i + 2] = 255; }
  g.putImageData(im, 0, 0);
  return canvas;
}
