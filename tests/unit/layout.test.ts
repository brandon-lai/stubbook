import { describe, expect, it } from "vitest";
import { arrange, autoPlace, BOARD_W, bounds, type Placement } from "../../lib/layout";

const ASPECTS = [0.41, 0.53, 0.37, 1.44, 0.5, 0.6, 2.17, 0.4];

function fill(n: number) {
  const aspects = new Map<string, number>();
  const ps: Placement[] = [];
  for (let i = 0; i < n; i++) {
    const id = `t${i}`;
    aspects.set(id, ASPECTS[i % ASPECTS.length]);
    ps.push(autoPlace(ps, aspects, { ticketId: id, aspect: aspects.get(id)! }));
  }
  return { ps, aspects };
}

const overlapShare = (a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>) => {
  const ov = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  return ov / Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
};

describe("autoPlace", () => {
  it("keeps 40 tickets on the board, tilted, without burying any", () => {
    const { ps, aspects } = fill(40);
    for (const p of ps) {
      const b = bounds(p, aspects.get(p.ticketId)!);
      expect(b.x0).toBeGreaterThanOrEqual(0);
      expect(b.x1).toBeLessThanOrEqual(BOARD_W);
      expect(Math.abs(p.rotation)).toBeGreaterThan(0);
      expect(Math.abs(p.rotation)).toBeLessThanOrEqual(7);
    }
    for (let i = 0; i < ps.length; i++) for (let j = 0; j < i; j++) {
      expect(overlapShare(bounds(ps[i], aspects.get(ps[i].ticketId)!), bounds(ps[j], aspects.get(ps[j].ticketId)!))).toBeLessThanOrEqual(0.121);
    }
  });
  it("stacks each new ticket on top", () => {
    const { ps } = fill(5);
    expect(ps.map((p) => p.z)).toEqual([1, 2, 3, 4, 5]);
  });
  it("is deterministic", () => {
    expect(fill(12).ps).toEqual(fill(12).ps);
  });
});

describe("arrange", () => {
  const items = ASPECTS.map((aspect, i) => ({ ticketId: `t${i}`, aspect, date: `2026-0${(i % 9) + 1}-10` }));
  it("grid: level, inside the board, no overlaps", () => {
    const ps = arrange("grid", items);
    const a = new Map(items.map((i) => [i.ticketId, i.aspect]));
    for (const p of ps) {
      expect(p.rotation).toBe(0);
      const b = bounds(p, a.get(p.ticketId)!);
      expect(b.x0).toBeGreaterThanOrEqual(0);
      expect(b.x1).toBeLessThanOrEqual(BOARD_W);
    }
    for (let i = 0; i < ps.length; i++) for (let j = 0; j < i; j++) expect(overlapShare(bounds(ps[i], a.get(ps[i].ticketId)!), bounds(ps[j], a.get(ps[j].ticketId)!))).toBe(0);
  });
  it("by date: reading order follows the dates", () => {
    const ps = arrange("date", [...items].reverse());
    const order = [...ps].sort((p, q) => p.y - q.y || p.x - q.x).map((p) => items.find((i) => i.ticketId === p.ticketId)!.date);
    expect(order).toEqual([...order].sort());
  });
  it("scatter: every ticket placed", () => {
    expect(arrange("scatter", items)).toHaveLength(items.length);
  });
});
