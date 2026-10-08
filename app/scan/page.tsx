import { Suspense } from "react";
import ScanFlow from "@/components/ScanFlow";

export const metadata = { title: "Scan a ticket" };

export default function Page() {
  return <Suspense><ScanFlow /></Suspense>;
}
