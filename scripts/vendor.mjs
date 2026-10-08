// Copies the scanner's browser runtimes out of node_modules into public/vendor,
// so the app serves them itself instead of pulling code from third-party CDNs at
// scan time. Runs on postinstall (locally and in the Vercel build). The English
// OCR model (public/vendor/tessdata) is not on npm in a stable path, so it is
// committed instead; see README "Sources".
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const out = path.resolve("public/vendor");
// Walk up from the package's entry point: some packages block `pkg/package.json` in "exports".
const pkgDir = (name) => {
  let dir = path.dirname(require.resolve(name, { paths: [process.cwd(), path.dirname(require.resolve("tesseract.js"))] }));
  while (!existsSync(path.join(dir, "package.json")) || JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).name !== name) dir = path.dirname(dir);
  return dir;
};
mkdirSync(out, { recursive: true });

const copies = [
  [path.join(pkgDir("@techstark/opencv-js"), "dist/opencv.js"), "opencv.js"],
  [path.join(pkgDir("pdfjs-dist"), "build/pdf.worker.min.mjs"), "pdf.worker.min.mjs"],
  [path.join(pkgDir("zxing-wasm"), "dist/reader/zxing_reader.wasm"), "zxing_reader.wasm"],
  [path.join(pkgDir("tesseract.js"), "dist/worker.min.js"), "tesseract/worker.min.js"],
];
const core = pkgDir("tesseract.js-core");
for (const f of readdirSync(core).filter((f) => /lstm\.wasm\.js$/.test(f))) copies.push([path.join(core, f), `tesseract/core/${f}`]);

for (const [from, to] of copies) {
  mkdirSync(path.dirname(path.join(out, to)), { recursive: true });
  cpSync(from, path.join(out, to));
}
console.log(`vendor: ${copies.length} files -> public/vendor`);
