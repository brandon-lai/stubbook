import { notFound } from "next/navigation";
import Lab from "./Lab";

export const dynamic = "force-dynamic";
export const metadata = { title: "Scan lab", robots: { index: false } };

/** Dev-only harness: runs the capture pipeline on an image URL and reports everything. */
export default function Page() {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_LAB !== "1") notFound();
  return <Lab />;
}
