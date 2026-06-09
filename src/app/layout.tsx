import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { APP_TITLE, APP_DESCRIPTION } from "./constants";
import { ThemeToggle } from "./ui/ThemeToggle";

// Runs before hydration (next/script beforeInteractive) so the saved theme is applied with no flash of
// the wrong colors. Default is LIGHT; dark only applies when the agent explicitly chose it. Static,
// trusted literal, no user input.
const NO_FLASH_THEME = `(function(){try{if(localStorage.getItem('theme')==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`;

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
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="min-h-screen bg-surface-muted text-ink antialiased">
        <Script id="theme-no-flash" strategy="beforeInteractive">
          {NO_FLASH_THEME}
        </Script>
        {/* Skip link: visually hidden until focused, so a keyboard/AT user can jump past the header. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-field focus:bg-brand-600 focus:px-4 focus:py-2 focus:font-semibold focus:text-white focus:shadow-card focus:outline-none focus:ring-2 focus:ring-brand-700 focus:ring-offset-2"
        >
          Skip to main content
        </a>
        <div className="fixed right-3 top-3 z-40 sm:right-4 sm:top-4">
          <ThemeToggle />
        </div>
        {children}
      </body>
    </html>
  );
}
