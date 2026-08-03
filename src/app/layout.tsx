import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "NHGOne | Narai Hospitality Group",
  description: "Unified admin dashboard and PMS managed layer.",
  // No explicit `icons` field - favicon.ico/icon.png/apple-icon.png in this
  // same app/ directory are Next.js's own file-based icon convention and get
  // picked up automatically. Declaring both this field (previously pointing
  // at an external, third-party-hosted URL) and the file convention produced
  // duplicate/competing <link rel="icon"> tags, which is why the browser tab
  // wasn't reliably showing the real logo.
};

import Navigation from "@/components/Navigation";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <body className="h-full antialiased font-sans">
        <Navigation>
          {children}
        </Navigation>
      </body>
    </html>
  );
}
