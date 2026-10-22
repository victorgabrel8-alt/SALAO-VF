import type { Metadata } from "next";
import { Cormorant_Garamond, Jost } from "next/font/google";
import type { CSSProperties } from "react";
import { SALAO } from "@/lib/config";
import "./globals.css";

// Títulos em Cormorant Garamond; o resto em Jost (as mesmas do app da dona)
const cormorant = Cormorant_Garamond({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--fonte-cormorant" });
const jost = Jost({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--fonte-jost" });

export const metadata: Metadata = {
  title: SALAO.nomeApp,
  description: "CRM dos salões, para a agência (uso no computador)",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${cormorant.variable} ${jost.variable}`}
      style={{ "--cor-principal": SALAO.corPrincipal } as CSSProperties}
    >
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
