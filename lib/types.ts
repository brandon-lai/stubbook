export const TICKET_TYPES = ["flight", "train", "subway", "event", "other"] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

/** The parsed fields the PRD asks for, plus a title (event name or flight number). */
export interface Fields {
  type: TicketType;
  title: string;
  origin: string;
  destination: string;
  /** ISO date (YYYY-MM-DD), or "" when unknown. */
  date: string;
  /** Carrier for travel, venue for events. */
  carrier: string;
  seat: string;
}

export const emptyFields = (): Fields => ({ type: "other", title: "", origin: "", destination: "", date: "", carrier: "", seat: "" });

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type BlurReason = "barcode" | "booking-ref" | "ticket-number" | "frequent-flyer" | "manual";
export interface BlurBox extends Box {
  id: string;
  reason: BlurReason;
}

export interface OcrWord {
  text: string;
  conf: number;
  box: Box;
  line: number;
}

export interface DecodedBarcode {
  format: string;
  text: string;
  /** Quad in image pixels: TL, TR, BR, BL. */
  corners: [number, number][];
}

export type FieldSource = "barcode" | "text" | "ai" | "user";
export interface ParseResult {
  fields: Fields;
  /** Where each non-empty field came from. */
  sources: Partial<Record<keyof Fields, FieldSource>>;
  /** 0..1: share of the expected fields for this type that were found, weighted by source. */
  confidence: number;
}
