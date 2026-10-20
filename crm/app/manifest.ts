import type { MetadataRoute } from "next";
import { SALAO } from "@/lib/config";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SALAO.nomeApp,
    short_name: SALAO.nomeApp,
    description: "Clientes, agenda e conversas do salão",
    lang: "pt-BR",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: SALAO.corPrincipal,
    icons: [
      { src: "/icone-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icone-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icone-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
