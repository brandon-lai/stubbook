import { describe, expect, it } from "vitest";
import { julianToIso, parseBcbp } from "../../lib/bcbp";
import { findDate, findRoute, findSeat, parseTicket } from "../../lib/parse";
import { findKnown, findSensitive } from "../../lib/sensitive";
import type { OcrWord } from "../../lib/types";

/** Builds OCR words from lines of text, one word per space, laid out left to right. */
function words(...lines: string[]): OcrWord[] {
  const out: OcrWord[] = [];
  lines.forEach((l, li) => {
    let x = 0;
    for (const t of l.split(" ")) {
      out.push({ text: t, conf: 95, line: li + 1, box: { x, y: li * 40, w: t.length * 12, h: 24 } });
      x += t.length * 12 + 10;
    }
  });
  return out;
}

const PASS = "M1" + "LINDQVIST/THEO".padEnd(20) + "E" + "QX7K2P ".padEnd(7) + "SFONRT" + "NW ".padEnd(3) + "0018 " + "073" + "Y" + "032K" + "0145 " + "1" + "00";

describe("BCBP", () => {
  it("decodes the mandatory fields", () => {
    const p = parseBcbp(PASS)!;
    expect(p.name).toBe("LINDQVIST/THEO");
    expect(p.legs[0]).toMatchObject({ pnr: "QX7K2P", from: "SFO", to: "NRT", carrier: "NW", flight: "18", julianDay: 73, cabin: "Y", seat: "32K" });
  });
  it("rejects text that is not a boarding pass", () => {
    expect(parseBcbp("https://example.com/ticket/123")).toBeNull();
    expect(parseBcbp("M1" + "x".repeat(10))).toBeNull();
  });
  it("puts the julian day in the most recent year that is not far in the future", () => {
    expect(julianToIso(73, new Date("2026-10-07T00:00:00Z"))).toBe("2026-03-14");
    // Day 300 (late October) seen in early October: that is this month, so this year.
    expect(julianToIso(300, new Date("2026-10-07T00:00:00Z"))).toBe("2026-10-27");
    // Day 360 seen in early October is more than 60 days ahead: last year's trip.
    expect(julianToIso(360, new Date("2026-10-07T00:00:00Z"))).toBe("2025-12-26");
  });
});

describe("dates", () => {
  const now = new Date("2026-10-07T00:00:00Z");
  it.each([
    ["14MAR26", "2026-03-14"],
    ["21/06/2026", "2026-06-21"],
    ["08.11.25", "2025-11-08"],
    ["SAT AUG 15 2026 8:00 PM", "2026-08-15"],
    ["2 May 2026", "2026-05-02"],
    ["Friday 30 January 2026", "2026-01-30"],
    ["JEUDI 1 SEPTEMBRE 2011", "2011-09-01"],
    ["2026-09-03", "2026-09-03"],
    ["06/21/2026", "2026-06-21"],
  ])("%s -> %s", (s, want) => expect(findDate(s, now)).toBe(want));
  it("ignores impossible dates and far-future misreads", () => {
    expect(findDate("31/02/2026", now)).toBe("");
    expect(findDate("01/01/2099", now)).toBe("");
  });
});

describe("route and seat", () => {
  it("reads labelled routes, with noise lines between label and value", () => {
    expect(findRoute(["Partenza / From", "\"1", "Milano Centrale", "Arrivo / To", "Firenze S.M.N."])).toEqual(["Milano Centrale", "Firenze S.M.N."]);
    expect(findRoute(["FROM", "SAN FRANCISCO SFO", "TO", "TOKYO NARITA NRT"])).toEqual(["San Francisco SFO", "Tokyo Narita NRT"]);
    expect(findRoute(["De: Lamzar Mosquee", "A: Agadir"])).toEqual(["Lamzar Mosquee", "Agadir"]);
  });
  it("reads arrows", () => expect(findRoute(["SFO → NRT"])).toEqual(["SFO", "NRT"]));
  it("reads seats", () => {
    expect(findSeat("SEAT 32K")).toBe("32K");
    expect(findSeat("Carrozza / Posto\n21/06/2026\n09:15\n7 / 64")).toBe("Coach 7, seat 64");
    expect(findSeat("SEC C ROW J SEAT 12")).toBe("Sec C, Row J, Seat 12");
  });
});

describe("parseTicket", () => {
  it("prefers the barcode, and the printed airline name over an unknown code", () => {
    const r = parseTicket(words("NORTHWIND AIR BOARDING PASS", "FROM", "SAN FRANCISCO SFO"), [{ format: "PDF417", text: PASS, corners: [] }], new Date("2026-10-07"));
    expect(r.fields).toMatchObject({ type: "flight", origin: "SFO", destination: "NRT", date: "2026-03-14", seat: "32K", carrier: "Northwind Air" });
    expect(r.sources.origin).toBe("barcode");
    expect(r.confidence).toBeGreaterThan(0.9); // the carrier came from text, not the barcode
  });
  it("never throws and falls back to other", () => {
    const r = parseTicket([], []);
    expect(r.fields.type).toBe("other");
    expect(r.confidence).toBe(0);
  });
  it("types events and finds the venue", () => {
    const r = parseTicket(words("LIVE NATION PRESENTS", "HALCYON STATIC", "THE FILLMORE · SAN FRANCISCO CA", "SAT AUG 15 2026 8:00 PM", "GEN ADM NO REFUNDS"), [], new Date("2026-10-07"));
    expect(r.fields.type).toBe("event");
    expect(r.fields.date).toBe("2026-08-15");
    expect(r.fields.carrier.toLowerCase()).toContain("fillmore");
  });
});

describe("sensitive data", () => {
  const reasons = (ws: OcrWord[]) => findSensitive(ws).map((b) => b.reason);
  it("finds booking references, ticket numbers and frequent flyer numbers", () => {
    expect(reasons(words("BOOKING REF QX7K2P"))).toEqual(["booking-ref"]);
    expect(reasons(words("ETKT 0372418829310"))).toEqual(["ticket-number"]);
    expect(reasons(words("FF NW 88412093"))).toEqual(["frequent-flyer"]);
    expect(reasons(words("PNR H7TMQA Biglietto n. 8800 4412 9931"))).toEqual(["booking-ref", "ticket-number"]);
    // A label on the line above, as OCR often splits "No." from the number.
    expect(reasons(words("N", "55018834"))).toEqual(["ticket-number"]);
  });
  it("leaves dates, times, seats, flight numbers and prices alone", () => {
    expect(reasons(words("NW 0018 14MAR26 SEAT 32K 10:35 GATE G96 $48.50 21/06/2026"))).toEqual([]);
  });
  it("groups a spaced number into one box", () => {
    const b = findSensitive(words("N.º 0473 9921 55"));
    expect(b).toHaveLength(1);
    expect(b[0].w).toBeGreaterThan(100);
  });
  it("matches a known secret with one misread character", () => {
    expect(findKnown(words("REF QX7K2P", "BOOKING REF QXTK2P"), ["QX7K2P"])).toHaveLength(2);
    expect(findKnown(words("ECONOMY"), ["QX7K2P"])).toHaveLength(0);
  });
});
