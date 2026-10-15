"use client";

import { useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { useAsyncSearch } from "@/components/sales/use-async-search";
import { cn } from "@/lib/utils";
import { FOCUS, inputClass } from "./ui";

/**
 * Elegir varias cosas de un catálogo grande buscando por nombre (piezas, campañas y anuncios de Meta). Lo elegido
 * queda como chips con su nombre. Con `rawId`, si lo que se escribe tiene la forma de un id, se ofrece usarlo tal
 * cual (para un anuncio que todavía no se sincronizó).
 */
export interface SearchHit {
  id: string;
  label: string;
  hint?: string | null;
}

export function SearchAddField({
  id,
  label,
  values,
  onChange,
  search,
  seedLabels,
  placeholder,
  rawId,
  emptyText = "No encontré nada con eso.",
  invalid,
  max = 100,
}: {
  id: string;
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  search: (query: string) => Promise<SearchHit[]>;
  /** Los nombres que ya se conocen (de las reglas guardadas). */
  seedLabels: Readonly<Record<string, string | undefined>>;
  placeholder: string;
  rawId?: RegExp;
  emptyText?: string;
  invalid?: boolean;
  max?: number;
}) {
  const s = useAsyncSearch(search);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const nameOf = (value: string) => picked[value] ?? seedLabels[value] ?? value;
  const trimmed = s.query.trim();
  const canUseRaw = !!rawId && rawId.test(trimmed) && !values.includes(trimmed) && !s.options.some((o) => o.id === trimmed);
  const full = values.length >= max;

  function add(hit: SearchHit) {
    if (values.includes(hit.id) || full) return;
    setPicked((current) => ({ ...current, [hit.id]: hit.label }));
    onChange([...values, hit.id]);
    s.reset();
  }

  return (
    <div className="space-y-1.5">
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange(values.filter((v) => v !== value))}
              aria-label={`Quitar ${label.toLowerCase()}: ${nameOf(value)}`}
              className={cn("inline-flex h-7 max-w-[16rem] items-center gap-1 rounded-full border border-border bg-muted px-2 text-xs hover:bg-accent", FOCUS)}
            >
              <span className="truncate">{nameOf(value)}</span>
              <X className="h-3 w-3 shrink-0" aria-hidden />
            </button>
          ))}
        </div>
      )}
      <span className="relative block">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          id={id}
          value={s.query}
          onChange={(e) => s.setQuery(e.target.value)}
          placeholder={full ? "Ya no entran más" : placeholder}
          disabled={full}
          autoComplete="off"
          aria-invalid={invalid ? true : undefined}
          className={`${inputClass} pl-8 ${invalid ? "border-red-500/70" : ""}`}
        />
        {s.searching && <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />}
      </span>
      {(s.options.length > 0 || canUseRaw) && (
        <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border" aria-label={`Resultados: ${label}`}>
          {s.options.map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => add({ id: o.id, label: o.label, hint: o.hint })} className={cn("flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-accent", FOCUS)}>
                <span className="break-words">{o.label}</span>
                {o.hint && <span className="text-xs text-muted-foreground">{o.hint}</span>}
              </button>
            </li>
          ))}
          {canUseRaw && (
            <li>
              <button type="button" onClick={() => add({ id: trimmed, label: trimmed })} className={cn("flex w-full px-3 py-2 text-left text-sm hover:bg-accent", FOCUS)}>
                Usar el id «{trimmed}»
              </button>
            </li>
          )}
        </ul>
      )}
      {trimmed.length >= 2 && !s.searching && s.options.length === 0 && !canUseRaw && <p className="text-xs text-muted-foreground">{emptyText}</p>}
    </div>
  );
}
