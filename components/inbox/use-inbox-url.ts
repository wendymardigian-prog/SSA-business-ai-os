"use client";

import { useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { toggleListParam } from "@/lib/url-params";

/**
 * Como cambia la URL un filtro de la Bandeja (F16, partido en el Bloque I).
 *
 * Todo el estado vive en la URL, no en los componentes: un cambio de filtro es
 * una navegacion, el servidor rehace la consulta y la lista llega ya filtrada.
 * Es lo que permite compartir una vista filtrada por link, y lo unico que hace
 * que el filtro no mienta cuando hay mas conversaciones que las que entran en
 * una pagina.
 *
 * Lo comparten el popover, el buscador, la linea de resumen y las pastillas de
 * estado, asi las cuatro piezas cambian la URL exactamente igual.
 */
export function useInboxUrl() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();

  /**
   * Cambiar cualquier filtro vuelve a la pagina 1: quedarse en la 3 despues de
   * filtrar deja la pantalla vacia sin explicacion.
   */
  function apply(next: URLSearchParams) {
    next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    apply(next);
  }

  function toggle(key: string, value: string) {
    apply(toggleListParam(new URLSearchParams(searchParams.toString()), key, value));
  }

  function clearAll() {
    // Se conserva la conversacion abierta: limpiar los filtros no deberia
    // cerrar el hilo que se estaba leyendo.
    const next = new URLSearchParams();
    const current = searchParams.get("c");
    if (current) next.set("c", current);
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  return { pending, setParam, toggle, clearAll };
}
