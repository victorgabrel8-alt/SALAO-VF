import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import type { CSSProperties } from "react";
import { SALAO } from "@/lib/config";
import "./globals.css";

// Uma fonte só, a da identidade Oi Studio (a mesma do app da dona)
const manrope = Manrope({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--fonte-manrope" });

export const metadata: Metadata = {
  title: SALAO.nomeApp,
  description: "CRM dos salões, para a agência (uso no computador)",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={manrope.variable}
      style={{ "--cor-principal": SALAO.corPrincipal } as CSSProperties}
    >
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
