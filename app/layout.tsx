import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from '@vercel/analytics/next';
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "scream.cam — how loud can you scream?",
  description: "5 seconds. One scream. Score 0–100. Top the daily leaderboard.",
  openGraph: {
    title: "scream.cam",
    description: "Scream into your mic. Get a score. Beat the leaderboard.",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "scream.cam" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}>
      <body className="min-h-full flex flex-col bg-zinc-950">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
