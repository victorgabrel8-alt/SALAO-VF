import type { Metadata, Viewport } from "next";
import type { CSSProperties } from "react";
import { SALAO } from "@/lib/config";
import "./globals.css";

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
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" style={{ "--cor-principal": SALAO.corPrincipal } as CSSProperties}>
      <body className="flex min-h-dvh flex-col antialiased">{children}</body>
    </html>
  );
}
