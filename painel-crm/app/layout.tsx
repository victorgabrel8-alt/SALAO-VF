import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { SALAO } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  title: SALAO.nomeApp,
  description: "CRM dos salões, para a agência (uso no computador)",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" style={{ "--cor-principal": SALAO.corPrincipal } as CSSProperties}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
