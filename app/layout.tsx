import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Savings Circle · Authorize Once",
  description:
    "RTD-P9 — a savings circle where you authorize once via a scoped, capped, expiring Privy grant and a durable scheduled backend makes the weekly contribution while you are offline.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}