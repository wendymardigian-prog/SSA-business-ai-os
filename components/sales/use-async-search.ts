"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Un buscador generico para los selectores de Ventas (piezas, anuncios): busca a los 250 ms de dejar de escribir y
 * desde 2 letras; un resultado que llega tarde de una consulta vieja se descarta. Mismo patron que
 * `use-contact-search.ts`.
 */
export function useAsyncSearch<T>(search: (query: string) => Promise<T[]>) {
  const [query, setQueryState] = useState("");
  const [options, setOptions] = useState<T[]>([]);
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
        let found: T[] = [];
        try {
          found = await search(value);
        } catch {
          found = [];
        }
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
