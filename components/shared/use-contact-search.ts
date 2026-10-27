"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface FoundContact {
  id: string;
  name: string;
  email: string | null;
}

/**
 * El buscador de contactos (por ejemplo, el de las reglas de asignación), con la
 * búsqueda que se le pasa: cada módulo busca con su permiso. Busca a los 250 ms de dejar de
 * escribir y desde 2 letras; un resultado que llega tarde de una consulta vieja
 * se descarta.
 */
export function useContactSearchWith(search: (query: string) => Promise<FoundContact[]>) {
  const [query, setQueryState] = useState("");
  const [options, setOptions] = useState<FoundContact[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<number | null>(null);
  const latest = useRef(0);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const setQuery = useCallback(
    (value: string) => {
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
        const found = await search(value);
        if (latest.current !== id) return;
        setOptions(found);
        setSearching(false);
      }, 250);
    },
    [search],
  );

  const reset = useCallback(() => {
    latest.current++;
    if (timer.current !== null) window.clearTimeout(timer.current);
    setQueryState("");
    setOptions([]);
    setSearching(false);
  }, []);

  return { query, setQuery, options, searching, reset };
}
