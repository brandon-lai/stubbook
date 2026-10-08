import type { Fields } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "14 Mar 2026". Formatted by hand so server and client render the same text. */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return "";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export function routeLine(f: Pick<Fields, "origin" | "destination">): string {
  if (f.origin && f.destination) return `${f.origin} → ${f.destination}`;
  return f.origin || f.destination || "";
}

export const carrierLabel = (type: Fields["type"]) => (type === "event" ? "Venue" : type === "other" ? "Carrier or venue" : "Carrier");
export const titleLabel = (type: Fields["type"]) => (type === "event" ? "Event" : type === "flight" ? "Flight" : type === "train" ? "Train" : "Title");

export function ticketSummary(f: Fields): string {
  return routeLine(f) || f.title || f.carrier || "Ticket";
}
