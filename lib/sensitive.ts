/**
 * Finds the text on a ticket that must be blurred: booking references, ticket
 * numbers and frequent flyer numbers (the PRD's list). Barcodes are handled
 * separately, from pixels.
 *
 * Errs toward blurring. A false positive costs the user one tap to unblur on a
 * private collage; a false negative can put a booking reference on a public link,
 * and a booking reference plus a surname opens a reservation on most airline sites.
 */
import { groupLines } from "./parse";
import type { BlurBox, BlurReason, Box, OcrWord } from "./types";

const LABEL_REF = /\b(booking|book\.?|ref(erence)?|pnr|confirmation|conf\.?|record|locator|reservation|resa|buchung|codice|code|localizador|prenotazione|dossier)\b/i;
const LABEL_TICKET = /\b(e-?ticket|etkt|tkt|ticket|billet|biglietto|billete|fahrkarte|no\.?|n\.?\s?º|nr\.?|number|serial|#)\b/i;
const LABEL_FF = /\b(ff|frequent|flyer|miles?|mileage|member(ship)?|loyalty|skymiles|aadvantage|avios|executive club|flying blue)\b/i;

const DATEY = /^\d{1,2}[A-Z]{3}\d{2,4}$|^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$|^(19|20)\d{6}$/;
const TIMEY = /^\d{1,2}[:.h]\d{2}$/;
const SEATY = /^\d{1,3}[A-K]$/;
const FLIGHTY = /^([A-Z]{2}|[A-Z]\d|\d[A-Z])\d{1,4}$/;
const MONEY = /^[$€£¥]?\d+[.,]\d{2}$/;

export function findSensitive(words: OcrWord[]): BlurBox[] {
  const out: BlurBox[] = [];
  const lines = groupLines(words);
  lines.forEach((line, li) => {
    const prev = lines[li - 1]?.text ?? "";
    const labelHere = (re: RegExp) => re.test(line.text);
    const labelNear = (re: RegExp) => re.test(line.text) || re.test(prev);
    const ws = line.words;
    for (let i = 0; i < ws.length; i++) {
      const raw = ws[i].text.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
      const tok = raw.toUpperCase();
      if (tok.length < 4) continue;

      // Runs of digit groups ("0473 9921 55", "8800 4412 9931") read as one number.
      if (/^\d+$/.test(tok)) {
        let j = i, digits = "";
        const digitsOnly = (t: string) => /^\d+[.,]?$/.test(t.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.,]+$/g, ""));
        while (j < ws.length && digitsOnly(ws[j].text) && !TIMEY.test(ws[j].text) && !MONEY.test(ws[j].text)) {
          digits += ws[j].text.replace(/\D/g, "");
          j++;
          if (digits.length >= 20) break;
        }
        const isDate = DATEY.test(digits) && digits.length === 8;
        const reason: BlurReason | null =
          labelNear(LABEL_FF) && digits.length >= 6 ? "frequent-flyer"
          : digits.length >= 8 && !isDate ? "ticket-number"
          : digits.length >= 6 && labelNear(LABEL_TICKET) && !isDate ? "ticket-number"
          : null;
        if (reason) { out.push(boxOf(ws.slice(i, j), reason)); i = j - 1; }
        continue;
      }

      // Booking references: 5-8 letters and digits, mixed, that are not a date,
      // time, seat or flight number. All-letter codes count only next to a label.
      if (/^[A-Z0-9]{5,8}$/.test(tok) && !DATEY.test(tok) && !SEATY.test(tok) && !TIMEY.test(tok)) {
        const mixed = /\d/.test(tok) && /[A-Z]/.test(tok);
        const flighty = FLIGHTY.test(tok) && /^[A-Z]{2}/.test(tok) && tok.length <= 6 && /\d{3,4}$/.test(tok) && !labelNear(LABEL_REF);
        if (mixed && !flighty) { out.push(boxOf([ws[i]], labelNear(LABEL_FF) ? "frequent-flyer" : "booking-ref")); continue; }
        if (/^[A-Z]{6}$/.test(tok) && labelNear(LABEL_REF) && raw === raw.toUpperCase()) { out.push(boxOf([ws[i]], "booking-ref")); continue; }
      }
      // "FF NW 88412093": airline prefix then digits.
      if (labelHere(LABEL_FF) && /^\d{6,}$/.test(ws[i + 1]?.text ?? "")) { out.push(boxOf([ws[i], ws[i + 1]], "frequent-flyer")); i++; }
    }
  });
  return out;
}

/**
 * Words matching a secret already known for this ticket (the booking reference
 * decoded from its barcode, or any token flagged elsewhere on it), allowing one
 * misread character. Catches the second printing of a reference on the stub, and
 * a copy OCR missed on the first pass.
 */
export function findKnown(words: OcrWord[], secrets: string[]): BlurBox[] {
  const want = [...new Set(secrets.map((x) => x.toUpperCase().replace(/[^A-Z0-9]/g, "")).filter((x) => x.length >= 5))];
  const out: BlurBox[] = [];
  for (const w of words) {
    const t = w.text.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (t.length >= 5 && want.some((x) => near(t, x) || (t.length > x.length && t.includes(x)))) out.push(boxOf([w], "booking-ref"));
  }
  return out;
}

function near(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  // Levenshtein distance <= 1.
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

let n = 0;
function boxOf(ws: OcrWord[], reason: BlurReason): BlurBox {
  const x0 = Math.min(...ws.map((w) => w.box.x)), y0 = Math.min(...ws.map((w) => w.box.y));
  const x1 = Math.max(...ws.map((w) => w.box.x + w.box.w)), y1 = Math.max(...ws.map((w) => w.box.y + w.box.h));
  return { id: `s${++n}`, reason, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Grows a box so the blur covers ascenders, descenders and a little air either side. */
export function pad(b: Box, k = 0.35, W = Infinity, H = Infinity): Box {
  const px = b.h * k, py = b.h * k;
  const x = Math.max(0, b.x - px), y = Math.max(0, b.y - py);
  return { x, y, w: Math.min(W, b.x + b.w + px) - x, h: Math.min(H, b.y + b.h + py) - y };
}
