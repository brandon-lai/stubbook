import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Stubbook", template: "%s · Stubbook" },
  description: "Scan the tickets from your trips and keep them on a collage you can arrange and share.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Stubbook", statusBarStyle: "default" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#e9e2d4" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
