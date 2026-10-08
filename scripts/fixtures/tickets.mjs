// Renders the synthetic ticket designs to flat PNGs with ground truth.
//
//   node scripts/fixtures/tickets.mjs        -> fixtures/synthetic/flat/*.png + truth.json
//
// Every ticket is fictional (made-up carriers, people and numbers) but laid out
// like the real thing, and every barcode is real and decodable: the boarding
// passes carry a valid IATA BCBP string in PDF417/Aztec, so the parser and the
// blur can be tested against a known answer. truth.json records, per ticket,
// the fields a perfect parse returns and the sensitive strings that must not
// survive the blur.
import bwipjs from "bwip-js";
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "fixtures/synthetic/flat";
mkdirSync(OUT, { recursive: true });

const png = async (bcid, text, opts = {}) =>
  "data:image/png;base64," + (await bwipjs.toBuffer({ bcid, text, scale: 3, includetext: false, ...opts })).toString("base64");

/** IATA Resolution 792 BCBP, mandatory items only, one leg: exactly 60 characters. */
function bcbp({ name, pnr, from, to, carrier, flight, julian, cabin, seat, seq }) {
  const pad = (s, n) => String(s).padEnd(n).slice(0, n);
  const s = "M1" + pad(name, 20) + "E" + pad(pnr, 7) + from + to + pad(carrier, 3) + pad(flight, 5) + String(julian).padStart(3, "0") + cabin + pad(seat, 4) + pad(seq, 5) + "1" + "00";
  if (s.length !== 60) throw new Error(`BCBP length ${s.length}`);
  return s;
}
const julianOf = (iso) => { const d = new Date(iso + "T00:00:00Z"); return Math.round((d - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5); };

const base = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:transparent}
  .t{position:relative;overflow:hidden;font-family:Helvetica,Arial,sans-serif;color:#1d1d1f}
  .mono{font-family:"Courier New",Courier,monospace}
`;

const tickets = [];

// 1. Thermal ATB boarding pass with a tear-off stub. PDF417 BCBP.
{
  const f = { type: "flight", origin: "SFO", destination: "NRT", date: "2026-03-14", carrier: "Northwind Air", seat: "32K", flight: "NW 0018" };
  const code = bcbp({ name: "LINDQVIST/THEO", pnr: "QX7K2P", from: "SFO", to: "NRT", carrier: "NW", flight: "0018", julian: julianOf(f.date), cabin: "Y", seat: "032K", seq: "0145" });
  tickets.push({
    id: "boarding-thermal", kind: "paper", w: 1600, h: 650, fields: f, barcode: { format: "PDF417", text: code },
    sensitive: ["QX7K2P", "0372418829310", "NW 88412093"],
    html: `<div class="t" style="width:1600px;height:650px;background:#f6f3ea;border-radius:18px">
      <div style="position:absolute;left:0;top:0;width:1600px;height:96px;background:#1f3b6e"></div>
      <div style="position:absolute;left:44px;top:24px;font-size:44px;font-weight:700;color:#fff;letter-spacing:2px">NORTHWIND AIR</div>
      <div style="position:absolute;left:520px;top:34px;font-size:26px;color:#cfe0ff;letter-spacing:6px">BOARDING PASS</div>
      <div style="position:absolute;left:1190px;top:0;width:3px;height:650px;background:repeating-linear-gradient(#999 0 10px,transparent 10px 20px)"></div>
      <div class="mono" style="position:absolute;left:44px;top:126px;font-size:24px;line-height:1.5">
        <div>NAME OF PASSENGER</div><div style="font-size:34px;font-weight:700">LINDQVIST/THEO</div>
      </div>
      <div class="mono" style="position:absolute;left:44px;top:240px;font-size:22px;line-height:1.35">
        <div>FROM</div><div style="font-size:46px;font-weight:700">SAN FRANCISCO SFO</div>
        <div style="margin-top:10px">TO</div><div style="font-size:46px;font-weight:700">TOKYO NARITA NRT</div>
      </div>
      <div class="mono" style="position:absolute;left:640px;top:126px;font-size:22px;line-height:1.45;display:grid;grid-template-columns:200px 200px 160px;gap:6px 18px">
        <div>FLIGHT<br><b style="font-size:34px">NW 0018</b></div><div>DATE<br><b style="font-size:34px">14MAR26</b></div><div>SEAT<br><b style="font-size:34px">32K</b></div>
        <div>BOARDING<br><b style="font-size:34px">10:35</b></div><div>GATE<br><b style="font-size:34px">G96</b></div><div>ZONE<br><b style="font-size:34px">4</b></div>
      </div>
      <div class="mono" style="position:absolute;left:640px;top:400px;font-size:21px;line-height:1.5">
        <div>BOOKING REF <b style="font-size:28px">QX7K2P</b></div>
        <div>ETKT 0372418829310</div>
        <div>FF NW 88412093</div>
      </div>
      <img src="${await png("pdf417", code, { columns: 6, scale: 2, height: 3 })}" style="position:absolute;left:44px;top:470px;height:150px;width:520px;image-rendering:pixelated">
      <div class="mono" style="position:absolute;left:1220px;top:126px;font-size:20px;line-height:1.5">
        <div>LINDQVIST/THEO</div>
        <div style="margin-top:14px">SFO &#8594; NRT</div><div style="font-size:30px;font-weight:700">NW 0018</div>
        <div style="margin-top:14px">14MAR26 &nbsp; SEAT 32K</div>
        <div style="margin-top:14px">REF QX7K2P</div>
        <div style="margin-top:40px;font-size:40px;font-weight:700;color:#1f3b6e">ECONOMY</div>
      </div>
    </div>`,
  });
}

// 2. Phone wallet pass screenshot (digital). Aztec BCBP, iPhone status bar around it.
{
  const f = { type: "flight", origin: "LHR", destination: "LIS", date: "2026-05-02", carrier: "Albatross Airways", seat: "7C", flight: "AB 1352" };
  const code = bcbp({ name: "OKAFOR/MARGARET", pnr: "L9RTWE", from: "LHR", to: "LIS", carrier: "AB", flight: "1352", julian: julianOf(f.date), cabin: "Y", seat: "007C", seq: "0022" });
  tickets.push({
    id: "boarding-wallet", kind: "digital", w: 1179, h: 2556, fields: f, barcode: { format: "Aztec", text: code },
    sensitive: ["L9RTWE", "1256634009184"],
    html: `<div class="t" style="width:1179px;height:2556px;background:#000;font-family:-apple-system,Helvetica,sans-serif">
      <div style="position:absolute;left:70px;top:40px;color:#fff;font-size:48px;font-weight:600">9:41</div>
      <div style="position:absolute;left:60px;top:250px;width:1059px;height:1900px;border-radius:40px;background:#c8102e;color:#fff">
        <div style="position:absolute;left:56px;top:50px;font-size:54px;font-weight:700">Albatross</div>
        <div style="position:absolute;right:56px;top:40px;font-size:30px;text-align:right">GATE<br><b style="font-size:54px">B32</b></div>
        <div style="position:absolute;left:56px;top:200px;font-size:30px">LONDON</div><div style="position:absolute;left:56px;top:236px;font-size:150px;font-weight:300">LHR</div>
        <div style="position:absolute;right:56px;top:200px;font-size:30px;text-align:right">LISBON</div><div style="position:absolute;right:56px;top:236px;font-size:150px;font-weight:300">LIS</div>
        <div style="position:absolute;left:56px;top:470px;font-size:28px;display:grid;grid-template-columns:330px 330px 300px;gap:30px">
          <div>PASSENGER<br><b style="font-size:44px">M OKAFOR</b></div><div>FLIGHT<br><b style="font-size:44px">AB 1352</b></div><div>SEAT<br><b style="font-size:44px">7C</b></div>
          <div>DATE<br><b style="font-size:44px">2 May 2026</b></div><div>BOARDS<br><b style="font-size:44px">06:40</b></div><div>BOOKING<br><b style="font-size:44px">L9RTWE</b></div>
        </div>
        <div style="position:absolute;left:56px;top:830px;font-size:28px;opacity:.85">E-TICKET 1256634009184</div>
        <div style="position:absolute;left:254px;top:1000px;width:550px;height:550px;background:#fff;border-radius:20px;padding:40px">
          <img src="${await png("azteccode", code, { scale: 6 })}" style="width:470px;height:470px;image-rendering:pixelated">
        </div>
        <div style="position:absolute;left:0;right:0;top:1620px;text-align:center;font-size:30px">Show this at security and the gate</div>
      </div>
      <div style="position:absolute;left:0;right:0;top:2250px;text-align:center;color:#8e8e93;font-size:36px">Wallet</div>
    </div>`,
  });
}

// 3. Rail ticket, credit-card stock with orange band. Aztec code with a booking reference.
{
  const f = { type: "train", origin: "Milano Centrale", destination: "Firenze S.M.N.", date: "2026-06-21", carrier: "Ferrovia Celere", seat: "Coach 7, seat 64" };
  tickets.push({
    id: "rail-card", kind: "paper", w: 1500, h: 760, fields: f, barcode: { format: "Aztec", text: "FC|PNR:H7TMQA|TKT:8800 4412 9931|MI-CENTRALE|FI-SMN|20260621|0915|C07P64" },
    sensitive: ["H7TMQA", "8800 4412 9931"],
    html: `<div class="t" style="width:1500px;height:760px;background:#fffdf8;border-radius:30px;font-family:Arial,sans-serif">
      <div style="position:absolute;left:0;top:0;width:1500px;height:120px;background:#ef7d00"></div>
      <div style="position:absolute;left:50px;top:30px;font-size:52px;font-weight:700;color:#fff;font-style:italic">Ferrovia Celere</div>
      <div style="position:absolute;right:50px;top:40px;font-size:34px;color:#fff">BIGLIETTO / TICKET</div>
      <div style="position:absolute;left:50px;top:160px;font-size:26px;color:#666">Partenza / From</div>
      <div style="position:absolute;left:50px;top:196px;font-size:56px;font-weight:700">Milano Centrale</div>
      <div style="position:absolute;left:50px;top:290px;font-size:26px;color:#666">Arrivo / To</div>
      <div style="position:absolute;left:50px;top:326px;font-size:56px;font-weight:700">Firenze S.M.N.</div>
      <div style="position:absolute;left:50px;top:440px;font-size:30px;display:grid;grid-template-columns:260px 230px 260px;gap:14px">
        <div style="color:#666;font-size:24px">Data</div><div style="color:#666;font-size:24px">Ora</div><div style="color:#666;font-size:24px">Carrozza / Posto</div>
        <div><b>21/06/2026</b></div><div><b>09:15</b></div><div><b>7 / 64</b></div>
      </div>
      <div style="position:absolute;left:50px;top:600px;font-size:26px;line-height:1.5">PNR <b>H7TMQA</b> &nbsp;&nbsp; Biglietto n. 8800 4412 9931</div>
      <div style="position:absolute;left:50px;top:660px;font-size:22px;color:#777">2a classe · Adulto · Tariffa Base · Non rimborsabile</div>
      <img src="${await png("azteccode", "FC|PNR:H7TMQA|TKT:8800 4412 9931|MI-CENTRALE|FI-SMN|20260621|0915|C07P64", { scale: 5 })}" style="position:absolute;right:60px;top:200px;width:360px;height:360px;image-rendering:pixelated">
    </div>`,
  });
}

// 4. Metro single ticket with magnetic stripe; small card.
{
  const f = { type: "subway", origin: "", destination: "", date: "2025-11-08", carrier: "Metro de Vallena", seat: "" };
  tickets.push({
    id: "metro-single", kind: "paper", w: 1020, h: 540, fields: f, barcode: null,
    sensitive: ["0473 9921 55"],
    html: `<div class="t" style="width:1020px;height:540px;background:linear-gradient(135deg,#00a19a,#0b6e8a);border-radius:26px;color:#fff;font-family:Arial,sans-serif">
      <div style="position:absolute;left:0;bottom:70px;width:1020px;height:90px;background:#3a2a1c"></div>
      <div style="position:absolute;left:44px;top:40px;font-size:70px;font-weight:900;letter-spacing:-2px">M</div>
      <div style="position:absolute;left:130px;top:52px;font-size:46px;font-weight:700">Metro de Vallena</div>
      <div style="position:absolute;left:46px;top:150px;font-size:40px">Billete sencillo · 1 viaje</div>
      <div style="position:absolute;left:46px;top:220px;font-size:30px;opacity:.9">Zona A · 1,50 €</div>
      <div class="mono" style="position:absolute;right:44px;top:160px;font-size:28px;text-align:right;line-height:1.5">08.11.25<br>14:07 L3<br>N.º 0473 9921 55</div>
    </div>`,
  });
}

// 5. Concert stub: thermal Ticketmaster-style with stub section, Code128 + ticket number.
{
  const f = { type: "event", origin: "", destination: "", date: "2026-08-15", carrier: "The Fillmore, San Francisco", seat: "Sec GA, Row -, Seat -", title: "Halcyon Static" };
  tickets.push({
    id: "concert-stub", kind: "paper", w: 1500, h: 560, fields: f, barcode: { format: "Code128", text: "7731 0094 2288 15" },
    sensitive: ["7731 0094 2288 15", "TM4QZ8"],
    html: `<div class="t mono" style="width:1500px;height:560px;background:#fbfaf7;border-radius:10px">
      <div style="position:absolute;left:0;top:0;width:1500px;height:560px;background:repeating-linear-gradient(90deg,rgba(40,90,170,.08) 0 60px,transparent 60px 120px)"></div>
      <div style="position:absolute;left:1140px;top:0;width:4px;height:560px;background:repeating-linear-gradient(#888 0 8px,transparent 8px 16px)"></div>
      <div style="position:absolute;left:40px;top:34px;font-size:26px">EVENT CODE &nbsp; TM4QZ8 &nbsp; &nbsp; ADMIT ONE</div>
      <div style="position:absolute;left:40px;top:90px;font-size:30px">LIVE NATION PRESENTS</div>
      <div style="position:absolute;left:40px;top:136px;font-size:66px;font-weight:700">HALCYON STATIC</div>
      <div style="position:absolute;left:40px;top:220px;font-size:34px">WITH SPECIAL GUEST THE MERIDIANS</div>
      <div style="position:absolute;left:40px;top:276px;font-size:34px">THE FILLMORE · SAN FRANCISCO CA</div>
      <div style="position:absolute;left:40px;top:332px;font-size:40px;font-weight:700">SAT AUG 15 2026 8:00 PM</div>
      <div style="position:absolute;left:40px;top:392px;font-size:26px">GEN ADM · NO REFUNDS · $48.50</div>
      <img src="${await png("code128", "7731 0094 2288 15", { height: 12, scale: 3 })}" style="position:absolute;left:40px;top:440px;height:80px;width:600px">
      <div style="position:absolute;left:670px;top:470px;font-size:24px">7731 0094 2288 15</div>
      <div style="position:absolute;left:1170px;top:40px;font-size:26px;line-height:1.6">GA<br>HALCYON<br>STATIC<br>AUG 15 2026<br>FILLMORE<br>$48.50</div>
    </div>`,
  });
}

// 6. Museum entry with QR, printed card.
{
  const f = { type: "event", origin: "", destination: "", date: "2026-01-30", carrier: "Museo de Arte Moderno", seat: "", title: "General admission" };
  tickets.push({
    id: "museum-qr", kind: "paper", w: 900, h: 1300, fields: f, barcode: { format: "QRCode", text: "MAM-ADM-20260130-55018834" },
    sensitive: ["55018834"],
    html: `<div class="t" style="width:900px;height:1300px;background:#fff;border-radius:6px;font-family:Georgia,serif">
      <div style="position:absolute;left:0;top:0;width:900px;height:420px;background:#151515"></div>
      <div style="position:absolute;left:60px;top:80px;color:#fff;font-size:96px;line-height:1">Museo<br>de Arte<br>Moderno</div>
      <div style="position:absolute;left:60px;top:470px;font-size:38px">General admission</div>
      <div style="position:absolute;left:60px;top:530px;font-size:34px;color:#555">Friday 30 January 2026</div>
      <div style="position:absolute;left:60px;top:590px;font-size:30px;color:#555">Entry 11:00–11:30</div>
      <img src="${await png("qrcode", "MAM-ADM-20260130-55018834", { scale: 8 })}" style="position:absolute;left:270px;top:700px;width:360px;height:360px;image-rendering:pixelated">
      <div style="position:absolute;left:0;right:0;top:1090px;text-align:center;font-family:Courier New,monospace;font-size:28px">No. 55018834</div>
    </div>`,
  });
}

// 7. Print-at-home boarding pass (A4), used for the PDF upload path.
{
  const f = { type: "flight", origin: "YYZ", destination: "CDG", date: "2026-09-03", carrier: "Northwind Air", seat: "41A", flight: "NW 0870" };
  const code = bcbp({ name: "FAIRWEATHER/ROSALIND", pnr: "ZK3V8N", from: "YYZ", to: "CDG", carrier: "NW", flight: "0870", julian: julianOf(f.date), cabin: "Y", seat: "041A", seq: "0211" });
  tickets.push({
    id: "boarding-a4", kind: "digital", w: 1240, h: 1754, fields: f, barcode: { format: "PDF417", text: code },
    sensitive: ["ZK3V8N", "0372455120987"],
    html: `<div class="t" style="width:1240px;height:1754px;background:#fff;font-family:Arial,sans-serif">
      <div style="position:absolute;left:80px;top:80px;font-size:46px;font-weight:700;color:#1f3b6e">NORTHWIND AIR</div>
      <div style="position:absolute;right:80px;top:92px;font-size:30px">Boarding pass</div>
      <div style="position:absolute;left:80px;top:170px;width:1080px;height:3px;background:#1f3b6e"></div>
      <div style="position:absolute;left:80px;top:210px;font-size:26px;display:grid;grid-template-columns:540px 540px;gap:26px">
        <div>Passenger<br><b style="font-size:38px">FAIRWEATHER/ROSALIND</b></div><div>Booking reference<br><b style="font-size:38px">ZK3V8N</b></div>
        <div>From<br><b style="font-size:38px">Toronto (YYZ)</b></div><div>To<br><b style="font-size:38px">Paris (CDG)</b></div>
        <div>Flight<br><b style="font-size:38px">NW 0870</b></div><div>Date<br><b style="font-size:38px">03 Sep 2026</b></div>
        <div>Seat<br><b style="font-size:38px">41A</b></div><div>Boarding<br><b style="font-size:38px">18:05 · Gate E73</b></div>
      </div>
      <div style="position:absolute;left:80px;top:760px;font-size:26px">E-ticket 0372455120987</div>
      <img src="${await png("pdf417", code, { columns: 6, scale: 2, height: 3 })}" style="position:absolute;left:80px;top:830px;width:620px;height:180px;image-rendering:pixelated">
      <div style="position:absolute;left:80px;top:1080px;width:1080px;font-size:22px;line-height:1.6;color:#444">Print this page and keep it with you. Gate closes 20 minutes before departure. Liquids over 100 ml must be in checked baggage.</div>
      <div style="position:absolute;left:80px;top:1250px;width:1080px;height:1px;border-top:2px dashed #aaa"></div>
      <div style="position:absolute;left:80px;top:1300px;font-size:24px;color:#666">Fold here · Keep this half</div>
    </div>`,
  });
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const truth = {};
for (const t of tickets) {
  await page.setViewportSize({ width: t.w, height: t.h });
  await page.setContent(`<style>${base}</style>${t.html}`);
  await page.waitForLoadState("load");
  await page.locator(".t").first().screenshot({ path: `${OUT}/${t.id}.png`, omitBackground: true });
  truth[t.id] = { kind: t.kind, w: t.w, h: t.h, fields: t.fields, barcode: t.barcode, sensitive: t.sensitive };
  console.log(t.id, `${t.w}x${t.h}`);
}
writeFileSync("fixtures/synthetic/truth.json", JSON.stringify(truth, null, 2));
// The A4 pass also ships as a PDF, for the PDF upload path.
const a4 = tickets.find((t) => t.id === "boarding-a4");
await page.setContent(`<style>${base}@page{size:A4;margin:0}</style>${a4.html}`);
// A4 is 793.7 CSS px wide at 96 dpi; scale the 1240px layout down to fit the sheet.
await page.pdf({ path: `${OUT}/boarding-a4.pdf`, format: "A4", printBackground: true, scale: 793.7 / 1240 });
await browser.close();
