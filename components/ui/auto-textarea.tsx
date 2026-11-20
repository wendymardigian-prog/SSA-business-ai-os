"use client";

import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Una caja de texto que crece mientras se escribe: su alto sigue al del texto, desde `minRows` filas hasta
 * `maxHeight` (pasado ese alto, hace scroll adentro). Sin esto, un texto largo obliga a desplazarse dentro de una
 * cajita de tres renglones.
 *
 * Es un `<textarea>` común: acepta las mismas props (`value`, `onChange`, `id`…). El usuario no la puede estirar a
 * mano (`resize-none`) porque el alto lo decide el contenido.
 */
/**
 * El alto en px de `rows` renglones de esta caja, con su padding y su borde, leído del estilo real (así el tope no
 * depende de un número fijo que cambia si cambia la letra o el padding). `null` si no se puede leer el interlineado.
 */
export function textareaRowsHeight(el: HTMLTextAreaElement, rows: number): number | null {
  const style = window.getComputedStyle(el);
  let lineHeight = parseFloat(style.lineHeight);
  // "normal" no es un número: se aproxima con el tamaño de la letra.
  if (!Number.isFinite(lineHeight)) lineHeight = parseFloat(style.fontSize) * 1.25;
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return null;
  const px = (v: string) => parseFloat(v) || 0;
  const extra = px(style.paddingTop) + px(style.paddingBottom) + px(style.borderTopWidth) + px(style.borderBottomWidth);
  return Math.ceil(lineHeight * rows + extra);
}

/**
 * Ajusta el alto de la caja a su texto, hasta `maxRows` renglones; pasado eso hace scroll adentro. Con `box-sizing:
 * border-box` (Tailwind) el alto incluye padding y borde, por eso se suman al `scrollHeight`.
 */
export function fitTextareaToRows(el: HTMLTextAreaElement, maxRows: number, fallbackMaxHeight = 150): void {
  const max = textareaRowsHeight(el, maxRows) ?? fallbackMaxHeight;
  // Primero se achica a "auto": si no, `scrollHeight` nunca baja al borrar texto.
  el.style.height = "auto";
  const style = window.getComputedStyle(el);
  const borders = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
  const content = el.scrollHeight + borders;
  el.style.height = `${Math.min(content, max)}px`;
  el.style.overflowY = content > max ? "auto" : "hidden";
}

export const AutoTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number; maxHeight?: number; maxRows?: number }>(
  function AutoTextarea({ minRows = 3, maxHeight = 480, maxRows, className, value, onChange, style, ...rest }, forwardedRef) {
    const ref = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(forwardedRef, () => ref.current as HTMLTextAreaElement);

    const fit = useCallback(() => {
      const el = ref.current;
      if (!el) return;
      // Con `maxRows`, el tope son renglones (leídos del estilo real); si no, los px de `maxHeight` como siempre.
      if (maxRows) {
        fitTextareaToRows(el, maxRows, maxHeight);
        return;
      }
      // Primero se achica a "auto": si no, `scrollHeight` nunca baja al borrar texto.
      el.style.height = "auto";
      const next = Math.min(el.scrollHeight, maxHeight);
      el.style.height = `${next}px`;
      el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
    }, [maxHeight, maxRows]);

    // Cada cambio del texto (tecleado, pegado, o valor que llega de afuera) vuelve a medir.
    useLayoutEffect(() => {
      fit();
    }, [fit, value]);

    // Al cambiar el ancho de la caja (un panel que se abre, otra ventana), el texto se reparte distinto.
    useLayoutEffect(() => {
      const el = ref.current;
      if (!el || typeof ResizeObserver === "undefined") return;
      let width = el.clientWidth;
      const observer = new ResizeObserver(() => {
        if (el.clientWidth !== width) {
          width = el.clientWidth;
          fit();
        }
      });
      observer.observe(el);
      return () => observer.disconnect();
    }, [fit]);

    return <textarea ref={ref} rows={minRows} value={value} onChange={onChange} style={style} className={cn("resize-none", className)} {...rest} />;
  },
);
