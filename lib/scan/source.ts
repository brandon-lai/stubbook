/* Turning whatever the user hands us (photo, screenshot, PDF, camera frame) into a canvas. */

const MAX_SOURCE = 2600;

export async function loadImage(src: string | Blob): Promise<HTMLCanvasElement> {
  const blob = typeof src === "string" ? await (await fetch(src)).blob() : src;
  // from-image applies the EXIF rotation phones write instead of rotating pixels.
  const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const k = Math.min(1, MAX_SOURCE / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

/** First page of a PDF (a boarding pass emailed as PDF), rendered at about 2000px wide. */
export async function loadPdfFirstPage(data: ArrayBuffer): Promise<HTMLCanvasElement> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(4, 2000 / base.width) });
  const c = document.createElement("canvas");
  c.width = Math.round(viewport.width);
  c.height = Math.round(viewport.height);
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  await page.render({ canvas: c, canvasContext: g, viewport }).promise;
  await doc.cleanup();
  return c;
}

export async function loadFile(file: File): Promise<{ canvas: HTMLCanvasElement; mode: "image" | "pdf" }> {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return { canvas: await loadPdfFirstPage(await file.arrayBuffer()), mode: "pdf" };
  return { canvas: await loadImage(file), mode: "image" };
}

export function frameFromVideo(video: HTMLVideoElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext("2d")!.drawImage(video, 0, 0);
  return c;
}
