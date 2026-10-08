/**
 * Field extraction from what the scanner could read: decoded barcodes first
 * (exact), then OCR text (heuristic). Nothing here throws on bad input; a ticket
 * that yields nothing still saves, with type "other" and empty fields.
 */
import { julianToIso, parseBcbp } from "./bcbp";
import { emptyFields, type DecodedBarcode, type Fields, type FieldSource, type OcrWord, type ParseResult, type TicketType } from "./types";

const AIRLINES: Record<string, string> = {
  AA: "American Airlines", AC: "Air Canada", AF: "Air France", AS: "Alaska Airlines", AY: "Finnair", AZ: "ITA Airways",
  B6: "JetBlue", BA: "British Airways", CX: "Cathay Pacific", DL: "Delta", EI: "Aer Lingus", EK: "Emirates", ET: "Ethiopian",
  EY: "Etihad", FR: "Ryanair", IB: "Iberia", JL: "Japan Airlines", KE: "Korean Air", KL: "KLM", LH: "Lufthansa", LX: "Swiss",
  NH: "ANA", NZ: "Air New Zealand", OS: "Austrian", QF: "Qantas", QR: "Qatar Airways", SK: "SAS", SQ: "Singapore Airlines",
  TK: "Turkish Airlines", TP: "TAP Air Portugal", U2: "easyJet", UA: "United", VS: "Virgin Atlantic", WN: "Southwest", WS: "WestJet",
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  // Common non-English month names seen on European tickets.
  ene: 1, janv: 1, janvier: 1, gen: 1, gennaio: 1, enero: 1, januar: 1, fev: 2, fevr: 2, fevrier: 2, febbraio: 2, febrero: 2, februar: 2,
  mars: 3, marzo: 3, marz: 3, abr: 4, avr: 4, avril: 4, aprile: 4, abril: 4, mai: 5, mag: 5, maggio: 5, mayo: 5, juin: 6, giu: 6, giugno: 6,
  junio: 6, juni: 6, juil: 7, juillet: 7, lug: 7, luglio: 7, julio: 7, juli: 7, aout: 8, ago: 8, agosto: 8, set: 9, settembre: 9,
  septiembre: 9, septembre: 9, ott: 10, ottobre: 10, octubre: 10, octobre: 10, okt: 10, oktober: 10, novembre: 11, noviembre: 11,
  dic: 12, dicembre: 12, diciembre: 12, decembre: 12, dez: 12, dezember: 12,
};

const TYPE_WORDS: [TicketType, RegExp][] = [
  ["flight", /\b(boarding|board pass|flight|gate|airlines?|airways|air\b|aeroporto|terminal|depart(ure)?s?|e-?ticket|etkt|zone \d)\b/i],
  ["train", /\b(train|rail|railway|coach|carriage|platform|binario|biglietto|billet|fahrkarte|bahn|ferrovia|sncf|renfe|amtrak|trenitalia|eurostar|carrozza|wagen|voiture|posto|shinkansen)\b/i],
  ["subway", /\b(metro|subway|underground|tube|single journey|billete sencillo|sencillo|transit|mtr|u-?bahn|zona [a-z0-9]|zone [a-c]\b|tram|validat|trajet)\b/i],
  ["event", /\b(admit|admission|concert|presents|live nation|tour|museum|museo|theatre|theater|stadium|arena|section|sec\b|row\b|doors|show|festival|gallery|exhibition|ticketmaster|eintritt|entrada|ingresso|gen(eral)? adm)\b/i],
];

export function parseTicket(words: OcrWord[], barcodes: DecodedBarcode[], now = new Date()): ParseResult {
  const fields = emptyFields();
  const sources: ParseResult["sources"] = {};
  const set = (k: keyof Fields, v: string, src: FieldSource) => {
    if (!v || (fields[k] && sources[k] === "barcode")) return;
    (fields as unknown as Record<string, string>)[k] = v;
    sources[k] = src;
  };

  // 1. Boarding pass barcode: exact route, date, flight and seat.
  for (const b of barcodes) {
    const p = parseBcbp(b.text);
    if (!p) continue;
    const leg = p.legs[0];
    fields.type = "flight";
    sources.type = "barcode";
    set("origin", leg.from, "barcode");
    set("destination", p.legs.at(-1)!.to, "barcode");
    set("date", julianToIso(leg.julianDay, now), "barcode");
    set("carrier", AIRLINES[leg.carrier] ?? leg.carrier, "barcode");
    set("title", `${leg.carrier} ${leg.flight}`, "barcode");
    set("seat", leg.seat, "barcode");
    break;
  }

  const lines = groupLines(words);
  const text = lines.map((l) => l.text).join("\n");

  // 2. Type from keywords, weighted by how many distinct hits each type gets.
  if (!sources.type) {
    let best: TicketType = "other", bestHits = 0;
    for (const [t, re] of TYPE_WORDS) {
      const hits = new Set((text.match(new RegExp(re.source, "gi")) || []).map((h) => h.toLowerCase())).size;
      if (hits > bestHits) { best = t; bestHits = hits; }
    }
    if (/\bbus\b|autobus|busfahr|ônibus/i.test(text) && best !== "flight") best = "other";
    fields.type = best;
    if (bestHits) sources.type = "text";
  }

  // 3. Date: the first plausible date on the ticket.
  if (!fields.date) set("date", findDate(text, now), "text");

  // 4. Route.
  if (!fields.origin || !fields.destination) {
    const r = findRoute(lines.map((l) => l.text));
    if (r) { set("origin", r[0], "text"); set("destination", r[1], "text"); }
  }

  // 5. Seat.
  if (!fields.seat) set("seat", findSeat(text), "text");

  // 6. Carrier or venue, and a title: the line printed largest is usually the
  //    brand (travel) or the act (events).
  const byHeight = [...lines].filter((l) => /[A-Za-z]{3}/.test(l.text) && l.text.length <= 40).sort((a, b) => b.height - a.height);
  const venue = lines.find((l) => /\b(arena|theatre|theater|stadium|hall|club|fillmore|museum|museo|gallery|pavilion|center|centre|park|bowl|field|opera)\b/i.test(l.text));
  const brand = lines.find((l) => /\b(air|airlines?|airways|rail|railways?|ferrovia|metro|bahn|transit|bus|lines|express|celere)\b/i.test(l.text) && l.text.length <= 40);
  if (fields.type === "event") {
    if (venue) set("carrier", tidy(venue.text), "text");
    const act = byHeight.find((l) => l !== venue && !/\b(admit|presents|ticket|no refunds?|general)\b/i.test(l.text));
    if (act) set("title", tidy(act.text), "text");
  } else {
    if (brand) set("carrier", tidy(brand.text), "text");
    else if (byHeight[0]) set("carrier", tidy(byHeight[0].text), "text");
    const fl = text.match(/\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?0*(\d{2,4})\b(?=.*$)/m);
    if (fields.type === "flight" && fl && !fields.title) set("title", `${fl[1]} ${fl[2]}`, "text");
  }

  return { fields, sources, confidence: confidenceOf(fields, sources) };
}

function tidy(s: string) {
  const t = s.replace(/[|_~=*]+/g, " ").replace(/\s+/g, " ").trim();
  // Shouty OCR lines read better title-cased.
  return t === t.toUpperCase() ? t.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Sfo|Nrt|Lhr|Jfk|Ga|Ny|Ca)\b/g, (m) => m.toUpperCase()) : t;
}

function confidenceOf(f: Fields, src: ParseResult["sources"]) {
  const want: (keyof Fields)[] = f.type === "event" ? ["title", "carrier", "date"] : f.type === "subway" ? ["carrier", "date"] : ["origin", "destination", "date", "carrier"];
  let score = 0;
  for (const k of want) if (f[k]) score += src[k] === "barcode" ? 1 : 0.7;
  return Math.round((score / want.length) * 100) / 100;
}

export interface Line { text: string; words: OcrWord[]; height: number }
export function groupLines(words: OcrWord[]): Line[] {
  const by = new Map<number, OcrWord[]>();
  for (const w of words) {
    if (!w.text.trim()) continue;
    const arr = by.get(w.line) ?? [];
    arr.push(w);
    by.set(w.line, arr);
  }
  return [...by.values()].map((ws) => {
    ws.sort((a, b) => a.box.x - b.box.x);
    const hs = ws.map((w) => w.box.h).sort((a, b) => a - b);
    return { text: ws.map((w) => w.text).join(" "), words: ws, height: hs[Math.floor(hs.length / 2)] };
  });
}

const iso = (y: number, m: number, d: number) => {
  if (y < 100) y += y > 70 ? 1900 : 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1950 || y > 2100) return "";
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCDate() !== d) return "";
  return dt.toISOString().slice(0, 10);
};

export function findDate(text: string, now = new Date()): string {
  const t = text.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const mon = (s: string) => MONTHS[s.toLowerCase().replace(/\.$/, "")];
  const cands: { at: number; v: string }[] = [];
  const push = (at: number, v: string) => v && cands.push({ at, v });
  let m: RegExpExecArray | null;
  // 2026-06-21
  for (const re = /\b(20\d{2}|19\d{2})[-./](\d{1,2})[-./](\d{1,2})\b/g; (m = re.exec(t)); ) push(m.index, iso(+m[1], +m[2], +m[3]));
  // 21/06/2026, 08.11.25. Day first unless that is impossible (US-style 06/21/2026).
  for (const re = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/g; (m = re.exec(t)); ) {
    const a = +m[1], b = +m[2], y = +m[3];
    push(m.index, a > 12 || b <= 12 ? iso(y, b, a) : iso(y, a, b));
  }
  // 14MAR26, 14 MAR 2026, 2 May 2026, Friday 30 January 2026
  for (const re = /\b(\d{1,2})\s?([A-Za-z]{3,9})\.?\s?(\d{4}|\d{2})\b/g; (m = re.exec(t)); ) if (mon(m[2])) push(m.index, iso(+m[3], mon(m[2]), +m[1]));
  // AUG 15 2026, Aug 15, 2026
  for (const re = /\b([A-Za-z]{3,9})\.?\s(\d{1,2}),?\s(\d{4})\b/g; (m = re.exec(t)); ) if (mon(m[1])) push(m.index, iso(+m[3], mon(m[1]), +m[2]));
  // A date in the far future is a misread; tickets are rarely more than a year ahead.
  const limit = new Date(now.getTime() + 400 * 864e5).toISOString().slice(0, 10);
  cands.sort((a, b) => a.at - b.at);
  return cands.find((c) => c.v <= limit)?.v ?? "";
}

export function findRoute(lines: string[]): [string, string] | null {
  const clean = (s: string) => tidy(s.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.)]+$/g, ""));
  const all = lines.join("\n");
  // "SFO → NRT", "Lisboa - Porto", "A > B"
  const arrow = all.match(/(?:^|\n)\s*([A-Za-z][A-Za-z .'()-]{1,30}?)\s*(?:→|->|=>|>|—|–|\bto\b)\s*([A-Za-z][A-Za-z .'()-]{1,30})\s*(?:\n|$)/i);
  if (arrow && !/\b(seat|gate|date|time)\b/i.test(arrow[0])) return [clean(arrow[1]), clean(arrow[2])];
  // Labelled lines: FROM / TO, De / A, Partenza / Arrivo, Von / Nach. The value is
  // on the same line after the label, or on the next line. Bilingual labels
  // ("Partenza / From") count as either language.
  const FROM = /^(?:from|de|desde|da|depart(?:ure)?|departing|partenza|origin|origen|von|ab)$/i;
  const TO = /^(?:to|a|hacia|arrivo|arrival|arriving|destination|destino|nach|an|para)$/i;
  let from = "", to = "";
  lines.forEach((l, i) => {
    const m = l.trim().match(/^([A-Za-z]+)(?:\s*\/\s*([A-Za-z]+))?\s*[:.]?\s*(.*)$/);
    if (!m) return;
    const labels = [m[1], m[2]].filter(Boolean) as string[];
    const value = (m[3] || "").trim() || (lines[i + 1] ?? "").trim();
    if (!from && labels.some((x) => FROM.test(x))) from = value;
    else if (!to && labels.some((x) => TO.test(x))) to = value;
  });
  if (from && to) return [clean(from), clean(to)];
  // Two airport codes in a row: "SFO NRT" or "LHR ... LIS" on one line.
  const codes = all.match(/\b([A-Z]{3})\b[^A-Z\n]{0,12}\b([A-Z]{3})\b/);
  if (codes && codes[1] !== codes[2] && !/^(THE|AND|FOR|SEC|ROW|GEN|ADM|NON|PER|VIA)$/.test(codes[1])) return [codes[1], codes[2]];
  return null;
}

export function findSeat(text: string): string {
  const sec = text.match(/\bsec(?:tion)?\.?\s*([A-Z0-9]{1,4})\b.*?\brow\s*([A-Z0-9]{1,3})\b.*?\bseat\s*([A-Z0-9]{1,4})\b/is);
  if (sec) return `Sec ${sec[1]}, Row ${sec[2]}, Seat ${sec[3]}`;
  const coach = text.match(/\b(?:coach|carrozza|wagen|voiture|car)\b[^\n\d]{0,24}(\d{1,2})\s*[/,]?\s*(?:seat|posto|platz|place)?\s*[:.]?\s*(\d{1,3}[A-Z]?)\b/i);
  if (coach) return `Coach ${coach[1]}, seat ${coach[2]}`;
  const seat = text.match(/\bseat\b[^\n\dA-Z]{0,6}(\d{1,3}[A-K])\b/i) || text.match(/\bseat\b\s*\n?\s*(\d{1,3}[A-K])\b/i);
  if (seat) return seat[1].toUpperCase();
  return "";
}
