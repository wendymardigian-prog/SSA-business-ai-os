"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Una orden que llega por la URL (`?nuevo=modulo`) y la ejecuta el componente que la sabe hacer: asi un boton de la
 * barra superior, que dibuja el servidor, puede abrir un formulario que vive adentro del contenido (Servicios A2,
 * F130.0). Despues de ejecutarla saca el parametro de la URL, para que recargar no la repita.
 */
export function useUrlIntent(param: string, onIntent: (value: string) => void) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const value = params?.get(param) ?? null;
  const handler = useRef(onIntent);
  useEffect(() => {
    handler.current = onIntent;
  });
  useEffect(() => {
    if (!value) return;
    handler.current(value);
    const next = new URLSearchParams(params?.toString() ?? "");
    next.delete(param);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // Solo cuando cambia el valor: los params y el router son estables para esta orden.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
}
