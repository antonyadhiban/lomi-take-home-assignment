import type { Metadata } from "next";
import { Hedvig_Letters_Sans, Hedvig_Letters_Serif } from "next/font/google";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app/app-shell";
import { Providers } from "@/components/app/providers";
import "./globals.css";

const sans = Hedvig_Letters_Sans({ subsets: ["latin"], weight: "400", variable: "--font-hedvig-sans" });
const serif = Hedvig_Letters_Serif({ subsets: ["latin"], weight: "400", variable: "--font-hedvig-serif" });

export const metadata: Metadata = {
  title: "Review · Document extraction",
  description: "Review LLM-extracted values against their source passage.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`} suppressHydrationWarning>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
