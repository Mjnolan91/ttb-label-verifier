import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { APP_TITLE, APP_DESCRIPTION } from "./constants";

export const metadata: Metadata = {
  title: APP_TITLE,
  description: APP_DESCRIPTION,
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
