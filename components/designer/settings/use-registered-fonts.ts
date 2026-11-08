"use client";

import { useEffect } from "react";

export interface PreviewFontFace {
  family: string;
  weight: number;
  style: "normal" | "italic";
  /** Link firmado de corta duración (lo arma el servidor). */
  url: string;
}

const GOOGLE_PREFIX = "https://fonts.googleapis.com/";

/**
 * Deja disponibles en la pantalla las fuentes que hay que dibujar: las de Google con UNA hoja de estilos y las
 * subidas con la API `FontFace` (sin inyectar HTML ni CSS armado con links).
 */
export function useRegisteredFonts(googleHref: string | null, uploaded: readonly PreviewFontFace[]): void {
  useEffect(() => {
    if (!googleHref || !googleHref.startsWith(GOOGLE_PREFIX)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = googleHref;
    document.head.appendChild(link);
    return () => link.remove();
  }, [googleHref]);

  const signature = JSON.stringify(uploaded);
  useEffect(() => {
    if (typeof FontFace === "undefined") return;
    const faces: FontFace[] = [];
    let cancelled = false;
    for (const font of JSON.parse(signature) as PreviewFontFace[]) {
      try {
        const face = new FontFace(font.family, `url(${JSON.stringify(font.url)})`, { weight: String(font.weight), style: font.style });
        faces.push(face);
        face
          .load()
          .then(() => {
            if (!cancelled) document.fonts.add(face);
          })
          .catch(() => {
            // Una fuente que no carga se ve con la de reemplazo del navegador: no pasa nada más.
          });
      } catch {
        // Nombre de familia raro: se ignora.
      }
    }
    return () => {
      cancelled = true;
      for (const face of faces) document.fonts.delete(face);
    };
  }, [signature]);
}
