/** Canvas to Blob, preferring WebP (alpha + small). Safari cannot encode WebP and quietly returns PNG, which also keeps alpha. */
export function toBlob(c: HTMLCanvasElement, type = "image/webp", quality = 0.88): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode image"))), type, quality));
}

export function scaled(src: HTMLCanvasElement | HTMLImageElement | ImageBitmap, maxLong: number): HTMLCanvasElement {
  const w = "naturalWidth" in src ? src.naturalWidth : src.width, h = "naturalHeight" in src ? src.naturalHeight : src.height;
  const k = Math.min(1, maxLong / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** Rotates a canvas a quarter turn clockwise (turns = 1) or more. */
export function rotateCanvas(src: HTMLCanvasElement, turns: number): HTMLCanvasElement {
  const t = ((turns % 4) + 4) % 4;
  if (!t) return src;
  const c = document.createElement("canvas");
  c.width = t % 2 ? src.height : src.width;
  c.height = t % 2 ? src.width : src.height;
  const g = c.getContext("2d")!;
  g.translate(c.width / 2, c.height / 2);
  g.rotate((t * Math.PI) / 2);
  g.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

/** A photo for the back of a ticket: downscaled and re-encoded, which drops EXIF (GPS included). */
export async function backPhoto(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const c = scaled(bmp, 1200);
  bmp.close();
  return toBlob(c, "image/jpeg", 0.84);
}
