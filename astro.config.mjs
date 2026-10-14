import { defineConfig, fontProviders } from "astro/config";

// https://docs.astro.build/en/reference/configuration-reference/
export default defineConfig({
  output: "static",
  site: "https://undead34.github.io",
  base: "/lyric-render-9-16",
  compressHTML: true,
  prefetch: false,
  // Servidor público: escucha en todas las interfaces (LAN + localhost).
  // Docs: https://docs.astro.build/en/reference/configuration-reference/#server-options
  server: {
    host: true,
    port: 8000,
    // El hostname del túnel Cloudflare cambia en cada arranque
    // (xxx.trycloudflare.com), así que se permite cualquiera.
    // Solo para preview local; no usar en producción.
    allowedHosts: true,
  },
  image: {
    responsiveStyles: true,
  },
  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: "Quicksand",
      cssVariable: "--font-quicksand",
      weights: [400, 600, 700],
      styles: ["normal", "italic"],
      subsets: ["latin", "latin-ext"],
      fallbacks: ["sans-serif"],
      optimizedFallbacks: true,
    },
    {
      provider: fontProviders.fontsource(),
      name: "Fira Sans",
      cssVariable: "--font-fira-sans",
      weights: [400, 500, 700],
      styles: ["normal"],
      subsets: ["latin"],
      fallbacks: ["sans-serif"],
      optimizedFallbacks: true,
    },
  ],
  vite: {
    build: {
      cssMinify: true,
      minify: "esbuild",
      target: "esnext",
    },
  },
});
