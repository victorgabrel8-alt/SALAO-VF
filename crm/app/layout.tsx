import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import type { CSSProperties } from "react";
import Script from "next/script";
import { Abertura, PULAR_SE_JA_VIU } from "@/components/Abertura";
import { SALAO } from "@/lib/config";
import "./globals.css";

// Uma fonte só em todo o app: Manrope (identidade Oi Studio)
const manrope = Manrope({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--fonte-manrope" });

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
  themeColor: "#FAF6F3",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={manrope.variable}
      style={{ "--cor-principal": SALAO.corPrincipal } as CSSProperties}
      // O script da abertura marca data-abertura="vista" no <html> antes do React assumir
      suppressHydrationWarning
    >
      <body className="flex min-h-dvh flex-col antialiased">
        {/* Roda antes de a tela ser pintada: numa recarga da mesma aba, não repete a abertura */}
        <Script id="abertura-sessao" strategy="beforeInteractive">
          {PULAR_SE_JA_VIU}
        </Script>
        <Abertura />
        {children}
      </body>
    </html>
  );
}
