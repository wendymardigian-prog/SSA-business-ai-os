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
export const AutoTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number; maxHeight?: number }>(
  function AutoTextarea({ minRows = 3, maxHeight = 480, className, value, onChange, style, ...rest }, forwardedRef) {
    const ref = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(forwardedRef, () => ref.current as HTMLTextAreaElement);

    const fit = useCallback(() => {
      const el = ref.current;
      if (!el) return;
      // Primero se achica a "auto": si no, `scrollHeight` nunca baja al borrar texto.
      el.style.height = "auto";
      const next = Math.min(el.scrollHeight, maxHeight);
      el.style.height = `${next}px`;
      el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
    }, [maxHeight]);

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
