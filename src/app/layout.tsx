import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "NHGOne | Narai Hospitality Group",
  description: "Unified admin dashboard and PMS managed layer.",
  icons: {
    icon: "https://guideline.lubd.com/wp-content/uploads/2025/11/NHG128-1.png",
  },
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
