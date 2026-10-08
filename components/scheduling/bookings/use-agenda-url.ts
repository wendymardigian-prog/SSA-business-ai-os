"use client";

import { useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { toggleListParam } from "@/lib/url-params";

/**
 * Como cambia la URL un filtro de Agenda (F33, Agenda v2), calcado de
 * `components/inbox/use-inbox-url.ts`: todo el estado vive en la URL, asi una
 * vista filtrada se puede compartir, y la pagina siempre esta sincronizada con
 * lo que de verdad se esta mirando.
 */
export function useAgendaUrl() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();

  /** Cambiar cualquier filtro vuelve a la pagina 1 (el parametro es `pagina`, no `page`). */
  function apply(next: URLSearchParams, keepPage = false) {
    if (!keepPage) next.delete("pagina");
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  /** `keepPage`: para los botones de paginación, que SI tocan `pagina` a propósito. */
  function setParam(key: string, value: string | null, options?: { keepPage?: boolean }) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    apply(next, options?.keepPage);
  }

  function toggle(key: string, value: string) {
    apply(toggleListParam(new URLSearchParams(searchParams.toString()), key, value));
  }

  /** El período toca tres parámetros a la vez: un atajo borra el rango a medida, y viceversa. */
  function setPeriod(next: { preset: string | null; from: string | null; to: string | null }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.from && next.to) {
      params.set("desde", next.from);
      params.set("hasta", next.to);
      params.delete("rango");
    } else {
      params.delete("desde");
      params.delete("hasta");
      if (next.preset) params.set("rango", next.preset);
      else params.delete("rango");
    }
    apply(params);
  }

  /**
   * Limpia los filtros pero conserva la navegacion: la vista elegida
   * (`vista`), el detalle abierto (`agenda`) y la posicion del calendario
   * (`cal`, `dia`). Limpiar filtros no deberia cerrar lo que se estaba viendo
   * ni mandar de vuelta a la semana de hoy.
   */
  function clearAll() {
    const next = new URLSearchParams();
    for (const key of ["vista", "agenda", "cal", "dia"]) {
      const v = searchParams.get(key);
      if (v) next.set(key, v);
    }
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  return { pending, setParam, toggle, setPeriod, clearAll };
}
