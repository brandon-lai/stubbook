/**
 * IATA Bar Coded Boarding Pass (Resolution 792) decoder, mandatory items only.
 * Most airline boarding passes carry this in their PDF417, Aztec or QR code, and
 * it is cleaner than anything OCR reads off the paper.
 *
 *   M1LINDQVIST/THEO     EQX7K2P SFONRTNW 0018 073Y032K0145 100
 *   ^^ format + legs     ^ e-ticket   ^from^to^carrier ^julian date, cabin, seat, sequence
 */
export interface BcbpLeg {
  pnr: string;
  from: string;
  to: string;
  carrier: string;
  flight: string;
  julianDay: number;
  cabin: string;
  seat: string;
}
export interface Bcbp {
  name: string;
  legs: BcbpLeg[];
}

export function parseBcbp(raw: string): Bcbp | null {
  const s = raw.replace(/\r?\n/g, "");
  if (s.length < 60 || s[0] !== "M" || !/[1-4]/.test(s[1])) return null;
  const legCount = Number(s[1]);
  const name = s.slice(2, 22).trim();
  const legs: BcbpLeg[] = [];
  let p = 23; // after the e-ticket indicator
  for (let i = 0; i < legCount; i++) {
    if (s.length < p + 37) break;
    const leg = s.slice(p, p + 37);
    const julian = Number(leg.slice(21, 24));
    const from = leg.slice(7, 10);
    const to = leg.slice(10, 13);
    if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || !(julian >= 1 && julian <= 366)) return legs.length ? { name, legs } : null;
    legs.push({
      pnr: leg.slice(0, 7).trim(),
      from,
      to,
      carrier: leg.slice(13, 16).trim(),
      flight: leg.slice(16, 21).trim().replace(/^0+(?=\d)/, ""),
      julianDay: julian,
      cabin: leg.slice(24, 25),
      seat: leg.slice(25, 29).trim().replace(/^0+(?=\d)/, ""),
    });
    // Variable-size conditional section follows each leg; its length is the 2 hex digits at 35..37.
    const condLen = parseInt(leg.slice(35, 37), 16);
    p += 37 + (Number.isFinite(condLen) ? condLen : 0);
  }
  return legs.length ? { name, legs } : null;
}

/**
 * The barcode stores only the day of the year. People mostly add a pass after
 * travelling, so pick the most recent such date that is not more than 60 days in
 * the future (a pass saved ahead of a trip).
 */
export function julianToIso(day: number, now = new Date()): string {
  const ahead = new Date(now.getTime() + 60 * 864e5);
  for (let y = ahead.getUTCFullYear(); y > ahead.getUTCFullYear() - 10; y--) {
    const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    if (day === 366 && !isLeap) continue;
    const d = new Date(Date.UTC(y, 0, day));
    if (d <= ahead) return d.toISOString().slice(0, 10);
  }
  return "";
}
