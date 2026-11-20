// @plantilla-quitar(ventas)
"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { searchAffiliates } from "@/lib/actions/affiliates";

const inputClass = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring";

/**
 * Los filtros de los disparadores de afiliados: qué afiliado (alguien del equipo o un contacto afiliado) y qué tipo de
 * asignación. Vacío = cualquiera. Se guarda `affiliateId` (lo compara `affiliateEventMatches`) y, para mostrarlo, el
 * nombre (`affiliateName`, nunca se usa para filtrar).
 */
export function AffiliateTriggerPanel({ data, onChange }: { data: Record<string, unknown>; onChange: (data: Record<string, unknown>) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ type: string; id: string; name: string }> | null>(null);
  const affiliateId = typeof data.affiliateId === "string" ? data.affiliateId : "";
  const affiliateName = typeof data.affiliateName === "string" ? data.affiliateName : "";
  const kind = data.affiliateKind === "originated" || data.affiliateKind === "influenced" ? data.affiliateKind : "";

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      searchAffiliates(query)
        .then((r) => alive && setResults(r))
        .catch(() => alive && setResults([]));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);

  const set = (patch: Record<string, unknown>) => {
    const next = { ...data, ...patch };
    for (const [k, v] of Object.entries(patch)) if (v === null || v === "") delete next[k];
    onChange(next);
  };

  return (
    <div className="space-y-4">
      <div>
        <span className="mb-1.5 block text-xs font-semibold text-foreground">Qué afiliado</span>
        {affiliateId ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
            <span className="truncate">{affiliateName || "Afiliado elegido"}</span>
            <button type="button" onClick={() => set({ affiliateId: null, affiliateName: null })} className="text-muted-foreground hover:text-foreground" aria-label="Sacar el afiliado">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ) : (
          <>
            <input aria-label="Buscar afiliado" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre o código…" className={inputClass} />
            {results === null ? (
              <p className="mt-1 text-[11px] text-muted-foreground">Cargando…</p>
            ) : results.length === 0 ? (
              <p className="mt-1 text-[11px] text-muted-foreground">{query.trim().length < 2 ? "Escribí al menos dos letras para buscar contactos afiliados." : "No encontré afiliados con ese nombre (o no tenés permiso para verlos)."}</p>
            ) : (
              <ul className="mt-1 max-h-48 overflow-auto rounded-lg border border-border">
                {results.map((r) => (
                  <li key={`${r.type}-${r.id}`}>
                    <button type="button" onClick={() => set({ affiliateId: r.id, affiliateName: r.name })} className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent">
                      {r.name} <span className="text-xs text-muted-foreground">{r.type === "user" ? "· equipo" : "· contacto"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">Sin elegir, vale para cualquier afiliado.</p>
      </div>
      <div>
        <label htmlFor="aff-kind" className="mb-1.5 block text-xs font-semibold text-foreground">Tipo de asignación</label>
        <select id="aff-kind" value={kind} onChange={(e) => set({ affiliateKind: e.target.value || null })} className={inputClass}>
          <option value="">Cualquiera</option>
          <option value="originated">Lo trajo el afiliado</option>
          <option value="influenced">El afiliado influyó</option>
        </select>
      </div>
    </div>
  );
}
