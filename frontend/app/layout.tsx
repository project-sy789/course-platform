import "./globals.css";
import type { Metadata } from "next";
import { IBM_Plex_Serif, IBM_Plex_Mono, Sarabun } from "next/font/google";
import MockBackend from "@/components/MockBackend";
import { PublicColophon, PublicMasthead } from "@/components/PublicChrome";

const display = IBM_Plex_Serif({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

const sans = Sarabun({
  subsets: ["latin", "thai"],
  weight: ["300", "400", "500", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "สถาบัน · Course Platform",
  description: "คอร์สเรียนภาษาไทย ระบบรักษาวิดีโอแบบครบวงจร",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-paper text-ink font-sans">
        <MockBackend />
        <PublicMasthead />
        {children}
        <PublicColophon />
      </body>
    </html>
  );
}
