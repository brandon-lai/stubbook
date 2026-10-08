"use client";

import Board, { type BoardTicket } from "./Board";
import type { Placement } from "@/lib/layout";

export default function SharedBoard({ tickets, placements }: { tickets: BoardTicket[]; placements: Placement[] }) {
  return <Board tickets={tickets} placements={placements} empty={<p>This collage is empty.</p>} />;
}
