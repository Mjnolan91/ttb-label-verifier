import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import { APP_TITLE, APP_DESCRIPTION } from "./constants";

// Self-hosted at build time (no runtime network); display:swap avoids invisible-text on load.
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

export const metadata: Metadata = {
  title: APP_TITLE,
  description: APP_DESCRIPTION,
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-surface-muted text-ink antialiased">{children}</body>
    </html>
  );
}
