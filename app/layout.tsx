import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { brandName, brandColorHex } from "@/lib/brand";
import { appUrl } from "@/lib/app-url";

const inter = Inter({ subsets: ["latin"] });

const name = brandName();

export const metadata: Metadata = {
  title: {
    default: name,
    template: `%s | ${name}`,
  },
  description: "Sistema operativo de negocio: CRM, bandeja multicanal, automatizaciones y agente de IA en un solo lugar.",
  metadataBase: new URL(appUrl()),
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const brandColor = brandColorHex();

  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/*
          Las dos preferencias que cambian como se ve la pantalla apenas carga:
          el tema y si el menu lateral esta colapsado. Se aplican como clase en
          el <html> desde aca, antes de que se pinte nada, porque si esperaran a
          que React hidrate se veria un parpadeo (claro que se pone oscuro, menu
          ancho que se achica).
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("theme")==="dark"||(!localStorage.getItem("theme")&&matchMedia("(prefers-color-scheme:dark)").matches))document.documentElement.classList.add("dark")}catch(e){}
try{if(localStorage.getItem("sidebar-collapsed")==="1")document.documentElement.classList.add("sidebar-collapsed")}catch(e){}`,
          }}
        />
        {/*
          Color de marca por cliente (NEXT_PUBLIC_BRAND_COLOR, ver lib/brand.ts).
          Con !important porque pisa tanto :root como .dark/[data-theme]
          independientemente de en que orden el bundler termine metiendo cada
          hoja de estilos: sin eso, el orden de carga decide cual gana.

          Se pisan DOS pares de variables, no uno: `--primary`/`--ring` (los
          que usa el codigo que escribe `var(--primary)` a mano) y
          `--color-primary`/`--color-ring` (los que Tailwind v4 usa de verdad
          para las utilidades `bg-primary`/`ring-primary`: @theme los declara
          UNA vez en :root como `var(--primary)`, pero .dark y [data-theme]
          los redefinen con un oklch literal, asi que de ahi para abajo ya no
          siguen a `--primary`. Ver el comentario de app/globals.css:220.
        */}
        {brandColor && (
          <style
            dangerouslySetInnerHTML={{
              __html: `:root,.dark,[data-theme="dark"],[data-theme="light"]{--primary:${brandColor} !important;--ring:${brandColor} !important;--color-primary:${brandColor} !important;--color-ring:${brandColor} !important;}`,
            }}
          />
        )}
      </head>
      <body className={inter.className}>{children}</body>
    </html>
  );
}
