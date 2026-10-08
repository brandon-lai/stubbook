// Downloads candidate real ticket photos from Wikimedia Commons (1600px renders) with
// licence metadata, for testing the scanner against real paper. Not shipped in the app.
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
const UA = "stubbook-fixtures/0.1 (https://github.com/brandon-lai/stubbook)";
const titles = process.argv.slice(2);
const out = "fixtures/real/raw";
mkdirSync(out, { recursive: true });
const meta = {};
for (let i = 0; i < titles.length; i += 20) {
  const batch = titles.slice(i, i + 20).map((t) => (t.startsWith("File:") ? t : `File:${t}`));
  const u = `https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=url|size|extmetadata|mime&iiurlwidth=1600&format=json&titles=${encodeURIComponent(batch.join("|"))}`;
  const j = await (await fetch(u, { headers: { "User-Agent": UA } })).json();
  for (const p of Object.values(j.query.pages)) {
    const ii = p.imageinfo?.[0];
    if (!ii || !/jpeg|png/.test(ii.mime)) continue;
    const em = ii.extmetadata || {};
    const slug = p.title.replace(/^File:/, "").replace(/\.[a-z]+$/i, "").replace(/[^A-Za-z0-9]+/g, "-").slice(0, 60);
    const file = `${out}/${slug}.jpg`;
    if (!existsSync(file)) {
      const r = await fetch(ii.thumburl || ii.url, { headers: { "User-Agent": UA } });
      if (!r.ok) { console.log("skip", p.title, r.status); continue; }
      writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      await new Promise((r) => setTimeout(r, 400));
    }
    meta[slug] = { title: p.title, page: ii.descriptionurl, license: em.LicenseShortName?.value, artist: (em.Artist?.value || "").replace(/<[^>]+>/g, "").trim(), width: ii.width, height: ii.height };
    console.log(slug, meta[slug].license);
  }
}
const prev = existsSync(`${out}/../meta.json`) ? JSON.parse((await import("node:fs")).readFileSync(`${out}/../meta.json`, "utf8")) : {};
writeFileSync(`${out}/../meta.json`, JSON.stringify({ ...prev, ...meta }, null, 2));
