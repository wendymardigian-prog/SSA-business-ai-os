"use client";

import { useMemo } from "react";
import type { DesignDoc } from "@/lib/designer/doc/schema";
import type { UploadedFont } from "@/lib/designer/fonts";
import type { CustomVar } from "@/lib/designer/variables/catalog";
import { thumbHtml, thumbSize, type QaBadge, type ThumbBox } from "@/lib/designer/screens/thumbs";

/**
 * La miniatura en vivo de una página (F48): el MISMO `renderPageHTML` que usa el lienzo y el link público,
 * reducido con una escala dentro de un contenedor. No hay miniaturas renderizadas ni guardadas.
 *
 * Va en un `iframe srcdoc` con `sandbox` vacío (sin `allow-scripts`): aunque el HTML trajera algo, no se ejecuta
 * y no toca la página. No recibe el mouse (la tarjeta entera es el link) ni el foco.
 */
export function LiveThumb({
  doc,
  pageIndex = 0,
  box,
  assetUrls,
  customVars,
  uploadedFonts,
  label,
  qa = null,
  className = "",
}: {
  doc: DesignDoc;
  pageIndex?: number;
  /** El espacio disponible en px de pantalla. */
  box: ThumbBox;
  assetUrls?: Readonly<Record<string, string>>;
  customVars?: readonly CustomVar[];
  uploadedFonts?: readonly UploadedFont[];
  /** Para el lector de pantalla: qué pieza es. */
  label: string;
  /** El punto ámbar de la revisión automática (F36): se dibuja en la esquina si la página tiene algo para mirar. */
  qa?: QaBadge | null;
  className?: string;
}) {
  const html = useMemo(() => thumbHtml({ doc, pageIndex, assetUrls, customVars, uploadedFonts }), [doc, pageIndex, assetUrls, customVars, uploadedFonts]);
  const size = thumbSize(doc, pageIndex, box);
  const thumb = (
    <div
      role="img"
      aria-label={label}
      className={`relative shrink-0 overflow-hidden rounded bg-white shadow-md ${className}`}
      style={{ width: size.width, height: size.height }}
    >
      <iframe
        title={label}
        sandbox=""
        srcDoc={html}
        loading="lazy"
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 border-0 bg-transparent"
        style={{ width: size.designWidth, height: size.designHeight, transform: `scale(${size.scale})`, transformOrigin: "0 0" }}
      />
    </div>
  );
  if (!qa) return thumb;
  return (
    <div className="relative shrink-0">
      {thumb}
      <span role="img" aria-label={qa.label} title={qa.label} className="absolute -right-1 -top-1 z-10 h-2.5 w-2.5 rounded-full border border-card bg-warn" />
    </div>
  );
}
