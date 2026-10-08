"use client";

import Board, { type BoardTicket } from "./Board";
import type { Placement } from "@/lib/layout";

/** The sample collage on the landing page: real pipeline output from the test tickets. Tap to flip works. */
export default function DemoBoard({ tickets, placements }: { tickets: BoardTicket[]; placements: Placement[] }) {
  return <Board tickets={tickets} placements={placements} minHeight={560} />;
}
