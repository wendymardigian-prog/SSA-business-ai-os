"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DesignDoc } from "@/lib/designer/doc/schema";
import type { UploadedFont } from "@/lib/designer/fonts";
import { previewHtml } from "@/lib/designer/screens/generate-one";
import { thumbSize } from "@/lib/designer/screens/thumbs";

/**
 * La vista previa de la pieza con los datos reales (F50): la página 1 dibujada con el MISMO `renderPageHTML` que el link
 * público y el PDF, ajustada al ancho que haya (en el celular, el de la pantalla). Va en un `iframe srcdoc` con `sandbox`
 * vacío (sin `allow-scripts`): aunque un valor trajera HTML, no se ejecuta y no toca la página. No recibe el mouse.
 */
export function PiecePreview({
  doc,
  values,
  assetUrls,
  uploadedFonts,
  label,
  maxHeight = 520,
}: {
  doc: DesignDoc;
  values: Record<string, string>;
  assetUrls: Readonly<Record<string, string>>;
  uploadedFonts: readonly UploadedFont[];
  label: string;
  maxHeight?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(120, Math.floor(el.clientWidth)));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const html = useMemo(() => previewHtml(doc, values, assetUrls, uploadedFonts), [doc, values, assetUrls, uploadedFonts]);
  const size = thumbSize(doc, 0, { width, height: maxHeight });

  return (
    <div ref={box} className="flex w-full justify-center">
      <div role="img" aria-label={label} className="relative shrink-0 overflow-hidden rounded bg-white shadow-md ring-1 ring-border" style={{ width: size.width, height: size.height }}>
        <iframe
          title={label}
          sandbox=""
          srcDoc={html}
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 border-0 bg-transparent"
          style={{ width: size.designWidth, height: size.designHeight, transform: `scale(${size.scale})`, transformOrigin: "0 0" }}
        />
      </div>
    </div>
  );
}
