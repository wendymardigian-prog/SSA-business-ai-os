"use client";

import { useEffect, useMemo } from "react";
import type { DesignDoc } from "@/lib/designer/doc/schema";
import { CURATED_FONTS, googleCssUrl, uploadedFontFaces, type FontUse, type UploadedFont } from "@/lib/designer/fonts";

/** Las tipografías que usa el documento (todas las páginas), con los pesos de cada una. */
function fontsOfDoc(doc: DesignDoc): FontUse[] {
  const map = new Map<string, Set<number>>();
  for (const page of doc.pages) {
    for (const el of page.elements) {
      if (el.type !== "text") continue;
      const set = map.get(el.font.family) ?? new Set<number>();
      set.add(el.font.weight);
      map.set(el.font.family, set);
    }
  }
  return [...map].map(([family, weights]) => ({ family, weights: [...weights] }));
}

/** Pone (o saca) un `<link>` o un `<style>` en el `<head>` según el contenido; no deja basura al desmontar. */
function useHeadLink(id: string, href: string | null) {
  useEffect(() => {
    if (!href) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.designerFonts = id;
    document.head.appendChild(link);
    return () => link.remove();
  }, [id, href]);
}

function useHeadStyle(id: string, css: string) {
  useEffect(() => {
    if (!css) return;
    const style = document.createElement("style");
    style.dataset.designerFonts = id;
    style.textContent = css;
    document.head.appendChild(style);
    return () => style.remove();
  }, [id, css]);
}

/**
 * Carga las tipografías del diseño en el editor: las de Google en un solo pedido y las subidas del negocio con
 * `@font-face` (su link firmado). Sin esto el lienzo mostraría otra letra que la del render.
 */
export function useDocFonts(doc: DesignDoc, uploaded: readonly UploadedFont[], assetUrls: Readonly<Record<string, string>>) {
  const used = useMemo(() => fontsOfDoc(doc), [doc]);
  const uploadedFamilies = useMemo(() => new Set(uploaded.map((f) => f.family)), [uploaded]);
  const url = useMemo(() => googleCssUrl(used.filter((f) => !uploadedFamilies.has(f.family))), [used, uploadedFamilies]);
  const faces = useMemo(() => uploadedFontFaces(uploaded.filter((f) => used.some((u) => u.family === f.family)), (path) => assetUrls[path] ?? ""), [uploaded, used, assetUrls]);
  useHeadLink("doc", url);
  useHeadStyle("uploaded", faces);
}

/** Las tipografías para que cada opción del desplegable se vea en su fuente: se piden solo cuando se abre el selector. */
export function useFontPreviews(enabled: boolean, google: readonly string[]) {
  const url = useMemo(() => {
    if (!enabled) return null;
    const families = [...CURATED_FONTS.map((f) => f.family), ...google];
    return googleCssUrl(families.map((family) => ({ family, weights: [400] })));
  }, [enabled, google]);
  useHeadLink("previews", url);
}
