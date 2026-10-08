/* OpenCV.js loader. The 10 MB runtime is fetched only when someone opens the
 * scanner, from /vendor (copied out of node_modules at install time). */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type CV = any;

let loading: Promise<CV> | null = null;

/**
 * The OpenCV build is an Emscripten module that is itself "thenable". Resolving a
 * Promise with a thenable makes the Promise call its then() again, forever, which
 * pegs the main thread. So the module's then() is removed before it is handed out,
 * and every resolve goes through here.
 */
function settle(mod: CV, resolve: (v: CV) => void) {
  if (mod && "then" in mod) delete mod.then;
  (window as unknown as { cv: CV }).cv = mod;
  resolve(mod);
}

export function loadCv(): Promise<CV> {
  if (loading) return loading;
  loading = new Promise<CV>((resolve, reject) => {
    const w = window as unknown as { cv?: CV };
    const whenReady = () => {
      const m = w.cv;
      if (!m) return false;
      if (m.Mat && !("then" in m)) { resolve(m); return true; }
      if (m instanceof Promise) { m.then((x: CV) => settle(x, resolve), reject); return true; }
      if (typeof m.then === "function") { m.then((x: CV) => settle(x, resolve)); return true; }
      if (m.Mat) { settle(m, resolve); return true; }
      return false;
    };
    if (whenReady()) return;
    const s = document.createElement("script");
    s.src = "/vendor/opencv.js";
    s.async = true;
    s.onload = () => {
      const t0 = performance.now();
      const tick = () => {
        if (whenReady()) return;
        if (performance.now() - t0 > 30000) return reject(new Error("OpenCV did not initialise"));
        setTimeout(tick, 30);
      };
      tick();
    };
    s.onerror = () => { loading = null; reject(new Error("Could not load the scanner")); };
    document.head.appendChild(s);
  });
  loading.catch(() => { loading = null; });
  return loading;
}

/** Runs fn with a list it can push Mats onto; everything pushed is freed afterwards. */
export function withMats<T>(fn: (keep: <M extends { delete(): void }>(m: M) => M) => T): T {
  const mats: { delete(): void }[] = [];
  try {
    return fn((m) => { mats.push(m); return m; });
  } finally {
    for (const m of mats) try { m.delete(); } catch { /* already freed */ }
  }
}
