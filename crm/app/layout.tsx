import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Jost } from "next/font/google";
import type { CSSProperties } from "react";
import { SALAO } from "@/lib/config";
import "./globals.css";

// Títulos e números grandes em Cormorant Garamond; o resto em Jost
const cormorant = Cormorant_Garamond({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--fonte-cormorant" });
const jost = Jost({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--fonte-jost" });

export const metadata: Metadata = {
  title: SALAO.nomeApp,
  description: "Clientes, agenda e conversas do salão",
  appleWebApp: {
    capable: true,
    title: SALAO.nomeApp,
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1C1B1F",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${cormorant.variable} ${jost.variable}`}
      style={{ "--cor-principal": SALAO.corPrincipal } as CSSProperties}
    >
      <body className="flex min-h-dvh flex-col antialiased">{children}</body>
    </html>
  );
}
