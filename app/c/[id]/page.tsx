import { Suspense } from "react";
import CollageView from "@/components/CollageView";

export const metadata = { title: "Collage" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><CollageView id={id} /></Suspense>;
}
