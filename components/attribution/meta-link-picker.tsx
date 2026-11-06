"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { searchMetaCatalog, type CatalogOption } from "@/lib/actions/meta-match";

const LEVEL_LABEL = { ad: "Anuncio", adset: "Conjunto", campaign: "Campaña" } as const;

/** Lo que la acción de vincular recibe según lo que se eligió. */
export function pickedIds(option: CatalogOption): { adId?: string; adsetId?: string; campaignId?: string } {
  return option.level === "ad" ? { adId: option.id } : option.level === "adset" ? { adsetId: option.id } : { campaignId: option.id };
}

/**
 * El buscador de anuncio, conjunto o campaña (por nombre o por id). La busqueda corre despues de 250 ms sin
 * escribir; lo que se muestra se deriva del ultimo resultado (no se hace `setState` dentro del efecto de
 * entrada): con menos de 2 letras no hay nada que buscar y se muestra la ayuda.
 */
export function MetaLinkPicker({ subtitle, onPick }: { subtitle?: string; onPick: (option: CatalogOption) => void }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ query: string; options: CatalogOption[]; failed: boolean } | null>(null);

  const query = text.trim();
  const enough = query.length >= 2;

  useEffect(() => {
    if (!enough) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const found = await searchMetaCatalog(query);
      if (!cancelled) setResult({ query, options: found.ok ? found.options : [], failed: !found.ok });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, enough]);

  const current = enough && result?.query === query ? result : null;
  const searching = enough && !current;

  return (
    <div className="space-y-3 p-4">
      {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      <label className="relative block">
        <span className="sr-only">Buscar anuncio, conjunto o campaña</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Nombre o id (mínimo 2 letras)"
          className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
      </label>
      <p className="text-[11px] text-muted-foreground">Elegir un anuncio completa su conjunto y su campaña; elegir un conjunto, su campaña.</p>

      {current?.failed && <p className="text-xs text-destructive">No pude buscar. Probá de nuevo.</p>}
      {searching && <p className="text-xs text-muted-foreground">Buscando…</p>}
      {current && !current.failed && current.options.length === 0 && (
        <p className="text-xs text-muted-foreground">No encontré nada con eso. Si el anuncio es muy nuevo, sincronizá la cuenta y probá de nuevo.</p>
      )}

      <ul className="space-y-1.5">
        {(current?.options ?? []).map((option) => (
          <li key={`${option.level}:${option.id}`}>
            <button type="button" onClick={() => onPick(option)} className="w-full rounded-lg border border-border p-2.5 text-left hover:bg-accent">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{LEVEL_LABEL[option.level]}</span>
              <span className="block text-sm font-medium">{option.name ?? option.id}</span>
              <span className="block text-[11px] text-muted-foreground">
                {option.id}
                {option.path ? ` · ${option.path}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
