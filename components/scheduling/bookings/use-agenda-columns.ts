"use client";

/**
 * Las columnas de la lista de Agenda: cuales se ven y cuanto mide cada una.
 *
 * Viven en la pantalla (no en la lista) porque el boton de columnas esta en la
 * barra de arriba, al lado del de filtros, y la tabla las lee desde ahi.
 * Todo se guarda en el navegador de cada persona (siempre en try/catch): sin
 * poder guardar, la eleccion vale mientras la pantalla esta abierta.
 */

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useColumnPrefs } from "@/components/attribution/columns-menu";
import { attributionColumnDefs, type AttributionCellSource } from "@/lib/attribution/columns";
import { parseColumnWidths, resetColumnWidth, serializeColumnWidths, setColumnWidth, type ColumnWidths } from "@/lib/scheduling/list-columns";

const COLUMNS_STORAGE_KEY = "agenda-list-columns";
const WIDTHS_STORAGE_KEY = "agenda-list-widths";
const WIDTHS_EVENT = "agenda:column-widths-changed";

/** Lo que se ve al abrir la lista: es mas angosta que la de respuestas, el resto se prende desde «Columnas». */
const DEFAULT_COLUMNS: ReadonlySet<string> = new Set(["attr:utm_source", "attr:utm_campaign", "meta:campaign", "meta:adset", "meta:ad", "meta:status"]);

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(WIDTHS_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(WIDTHS_EVENT, onChange);
  };
}

function readWidths(): string | null {
  try {
    return window.localStorage.getItem(WIDTHS_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function useAgendaColumns() {
  const defs = useMemo(() => attributionColumnDefs(DEFAULT_COLUMNS), []);
  const prefs = useColumnPrefs<AttributionCellSource>(COLUMNS_STORAGE_KEY, defs);

  const raw = useSyncExternalStore(subscribe, readWidths, () => null);
  // Si el navegador no deja guardar, el ancho elegido vale igual mientras la pantalla esta abierta.
  const [session, setSession] = useState<ColumnWidths | null>(null);
  const widths = useMemo(() => session ?? parseColumnWidths(raw), [session, raw]);

  const save = useCallback((next: ColumnWidths) => {
    setSession(next);
    try {
      window.localStorage.setItem(WIDTHS_STORAGE_KEY, serializeColumnWidths(next));
    } catch {
      // Sin almacenamiento: el ancho no se recuerda la proxima vez.
    }
    window.dispatchEvent(new Event(WIDTHS_EVENT));
  }, []);

  return {
    defs,
    visible: prefs.visible,
    toggle: prefs.toggle,
    showAll: prefs.showAll,
    reset: prefs.reset,
    widths,
    setWidth: (key: string, px: number) => save(setColumnWidth(widths, key, px)),
    resetWidth: (key: string) => save(resetColumnWidth(widths, key)),
    resetAllWidths: () => save({}),
    hasCustomWidths: Object.keys(widths).length > 0,
  };
}
