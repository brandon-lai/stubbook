// Builds the landing page's sample collage from real pipeline output (the lab's
// blurred cut-outs) and copies the "Try a sample ticket" photos.
//   node scripts/samples.mjs     (after node scripts/lab.mjs)
import sharp from "sharp";
import { copyFileSync, writeFileSync } from "node:fs";
import { autoPlace } from "../lib/layout.ts";

const T = (type, title, origin, destination, date, carrier, seat = "") => ({ type, title, origin, destination, date, carrier, seat });
const items = [
  ["boarding_thermal_wood_clean", "boarding", T("flight", "NW 18", "SFO", "NRT", "2026-03-14", "Northwind Air", "32K"), "Window seat. Slept over the whole Pacific."],
  ["rail_card_wood_clean", "rail", T("train", "", "Milano Centrale", "Firenze S.M.N.", "2026-06-21", "Ferrovia Celere", "Coach 7, seat 64"), ""],
  ["real_Hawkwind_ticket_jpg", "hawkwind", T("event", "Hawkwind", "", "", "1983-02-12", "S.U.S.U. Ents"), "Dad's. Found in a record sleeve."],
  ["boarding_wallet_screenshot_", "wallet", T("flight", "AB 1352", "LHR", "LIS", "2026-05-02", "Albatross Airways", "7C"), ""],
  ["concert_stub_wood_clean", "concert", T("event", "Halcyon Static", "", "", "2026-08-15", "The Fillmore, San Francisco"), "Front left, lost my voice."],
  ["metro_single_whitedesk", "metro", T("subway", "Single journey", "", "", "2025-11-08", "Metro de Vallena"), ""],
  ["real_Bell_Biv_Devoe_concert_tour_1991_Stierch_jpg", "bbd", T("event", "Bell Biv DeVoe", "", "", "1991-07-30", "Deer Creek Music Center", "Sec C, Row S, Seat 19"), ""],
  ["museum_qr_wood_clean", "museum", T("event", "General admission", "", "", "2026-01-30", "Museo de Arte Moderno"), ""],
  ["real_Cairo_bus_ticket_December_2021_jpg", "cairo", T("other", "Bus", "", "", "2021-12-04", "Cairo Transport Authority"), "5 pounds, Tahrir to Zamalek."],
];
const tickets = [];
const placements = [];
const aspects = new Map();
for (const [src, id, fields, note] of items) {
  const out = `public/samples/cut/${id}.webp`;
  const info = await sharp(`fixtures/out/${src}.blurred.png`).resize({ width: 900, height: 900, fit: "inside", withoutEnlargement: true }).webp({ quality: 84, alphaQuality: 90 }).toFile(out);
  const aspect = +(info.height / info.width).toFixed(4);
  aspects.set(id, aspect);
  tickets.push({ id, src: `/samples/cut/${id}.webp`, aspect, fields, note });
  placements.push(autoPlace(placements, aspects, { ticketId: id, aspect }, `demo:${id}`));
}
writeFileSync("public/samples/demo.json", JSON.stringify({ tickets, placements }, null, 1));
for (const [from, to] of [["boarding-thermal__wood-clean", "boarding"], ["concert-stub__wood-tilt-glare", "concert"], ["rail-card__linen-crease", "rail"], ["museum-qr__wood-clean", "museum"]]) copyFileSync(`fixtures/synthetic/photos/${from}.jpg`, `public/samples/photos/${to}.jpg`);
console.log(tickets.length, "sample tickets");
