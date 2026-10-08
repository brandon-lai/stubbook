"use client";

import { useEffect, useState } from "react";
import { cut, locate, read, renderBlurred, timings, warmUp, type SourceMode } from "@/lib/scan/pipeline";
import { decodeBarcodes } from "@/lib/scan/barcode";
import { readText } from "@/lib/scan/ocr";
import { loadPdfFirstPage, loadImage } from "@/lib/scan/source";
import { loadCv } from "@/lib/scan/cv";
import { detectQuad, type Detection } from "@/lib/scan/detect";

declare global {
  interface Window {
    __lab?: { run: (url: string, mode: SourceMode) => Promise<unknown>; detect: (url: string) => Promise<Detection[]>; ocr: (url: string) => Promise<unknown>; ready: boolean };
  }
}

export default function Lab() {
  const [last, setLast] = useState<{ cutout: string; blurred: string; report: string } | null>(null);
  useEffect(() => {
    warmUp();
    window.__lab = {
      ready: true,
      async ocr(url) {
        const r = await readText(await loadImage(url));
        const lines: Record<number, string> = {};
        for (const w of r.words) lines[w.line] = ((lines[w.line] ?? "") + " " + w.text + "(" + Math.round(w.conf) + ")").trim();
        return Object.values(lines);
      },
      async detect(url) {
        const cv = await loadCv();
        const src = cv.imread(await loadImage(url));
        const all: Detection[] = [];
        detectQuad(cv, src, all);
        src.delete();
        return all.sort((a, b) => b.score - a.score);
      },
      async run(url, mode) {
        for (const k of Object.keys(timings)) delete timings[k];
        const t0 = performance.now();
        const src = mode === "pdf" ? await loadPdfFirstPage(await (await fetch(url)).arrayBuffer()) : await loadImage(url);
        const loc = await locate(src, mode);
        const cutout = await cut(src, loc.corners, loc.kind);
        const r = await read(cutout);
        const blurred = renderBlurred(cutout, r.boxes);
        const total = Math.round(performance.now() - t0);
        // Privacy check on the output itself: nothing decodable, and what OCR can still read.
        const g = blurred.getContext("2d")!;
        const raw = g.getImageData(0, 0, blurred.width, blurred.height);
        const view = (bg: number | null) => { const d = new Uint8ClampedArray(raw.data); for (let i = 0; i < d.length; i += 4) { const a = bg === null ? 1 : d[i + 3] / 255; for (let c = 0; c < 3; c++) d[i + c] = d[i + c] * a + (bg ?? 0) * (1 - a); d[i + 3] = 255; } return new ImageData(d, raw.width, raw.height); };
        const after = (await Promise.all([raw, view(255), view(0), view(null)].map((im) => decodeBarcodes(im)))).flat();
        const afterText = await readText(blurred);
        const out = {
          located: loc, size: [src.width, src.height], cutoutSize: [cutout.width, cutout.height],
          barcodes: r.barcodes, boxes: r.boxes, parse: r.parse, ocrConfidence: r.ocrConfidence,
          text: r.words.map((w) => w.text).join(" "), lines: r.words.reduce<Record<number, string>>((m, w) => ({ ...m, [w.line]: ((m[w.line] ?? "") + " " + w.text).trim() }), {}),
          blurredDecodes: after.map((b) => b.text), blurredText: afterText.words.map((w) => w.text).join(" "),
          timings: { ...timings, total },
          cutout: cutout.toDataURL("image/png"), blurred: blurred.toDataURL("image/png"),
        };
        setLast({ cutout: out.cutout, blurred: out.blurred, report: JSON.stringify({ ...out, cutout: undefined, blurred: undefined }, null, 1) });
        return out;
      },
    };
  }, []);
  return (
    <main style={{ padding: 20, background: "#777", minHeight: "100vh" }}>
      <h1>Scan lab</h1>
      {last && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <img src={last.cutout} alt="cut-out" style={{ maxWidth: "100%" }} />
          <img src={last.blurred} alt="blurred" style={{ maxWidth: "100%" }} />
          <pre style={{ gridColumn: "1 / -1", fontSize: 11, whiteSpace: "pre-wrap" }}>{last.report}</pre>
        </div>
      )}
    </main>
  );
}
