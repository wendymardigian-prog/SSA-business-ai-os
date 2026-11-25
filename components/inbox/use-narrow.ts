"use client";

import { useEffect, useState } from "react";

/**
 * Si un elemento mide menos de `px` de ancho. Para lo que CSS no puede cambiar
 * según el ancho (por ejemplo el placeholder de un textarea). Devuelve un ref
 * de callback (sirve aunque el elemento aparezca después) y arranca en `false`,
 * que es lo que dibuja el servidor; se corrige al medir.
 */
export function useNarrow(px: number): [(el: HTMLElement | null) => void, boolean] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const check = () => setNarrow(el.getBoundingClientRect().width < px);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, px]);
  return [setEl, narrow];
}
