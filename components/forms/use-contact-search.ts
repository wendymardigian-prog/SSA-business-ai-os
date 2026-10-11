"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { searchContactsForForm, type ContactOption } from "@/lib/actions/forms/contact";

/**
 * El buscador de contactos de Formularios (vincular una respuesta, armar un link
 * firmado). Busca a los 250 ms de dejar de escribir y desde 2 letras. La búsqueda
 * arranca desde el manejador del input (no desde un efecto), y un resultado que llega
 * tarde, de una consulta vieja, se descarta.
 */
export function useContactSearch() {
  const [query, setQueryState] = useState("");
  const [options, setOptions] = useState<ContactOption[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<number | null>(null);
  const latest = useRef(0);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const setQuery = useCallback((value: string) => {
    setQueryState(value);
    if (timer.current !== null) window.clearTimeout(timer.current);
    const id = ++latest.current;
    if (value.trim().length < 2) {
      setOptions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = window.setTimeout(async () => {
      const found = await searchContactsForForm(value);
      if (latest.current !== id) return;
      setOptions(found);
      setSearching(false);
    }, 250);
  }, []);

  const reset = useCallback(() => {
    latest.current++;
    if (timer.current !== null) window.clearTimeout(timer.current);
    setQueryState("");
    setOptions([]);
    setSearching(false);
  }, []);

  return { query, setQuery, options, searching, reset };
}
