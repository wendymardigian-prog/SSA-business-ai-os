"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { listAssets } from "@/lib/actions/response-assets";
import { ASSET_KIND_LABEL, isAssetKind, type AssetKind } from "@/lib/response-assets/kind";

/**
 * Elegir un recurso de la banca, para las automatizaciones: el nodo "Enviar
 * recurso" de los flows y el paso "Recurso" de las secuencias.
 *
 * Con buscador por nombre, el tipo de cada uno a la vista y avisos claros
 * cuando el elegido ya no esta en la banca o esta apagado (el paso se
 * saltearia). Lee la banca con `listAssets`, que puede llamar cualquier
 * miembro.
 *
 * El que lo usa guarda el id (es lo que manda) y, aparte, el nombre y el tipo
 * que devuelve `onPick`: asi puede mostrar el recurso sin leer la banca.
 */

export interface AssetOption {
  id: string;
  name: string;
  kind: AssetKind;
  isActive: boolean;
}

const fieldClass =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";

export function AssetSelect({
  value,
  valueName,
  onPick,
  disabled = false,
  label = "Recurso de la banca",
  /** Avisa el tipo del elegido apenas se conoce (para decidir que mas pedir, como un texto que lo acompañe). */
  onKnownKind,
}: {
  /** El id elegido. */
  value: string | undefined;
  /** El nombre guardado, por si el recurso ya no esta en la banca. */
  valueName?: string;
  onPick: (option: AssetOption | null) => void;
  disabled?: boolean;
  label?: string;
  onKnownKind?: (kind: AssetKind | null) => void;
}) {
  const [options, setOptions] = useState<AssetOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const searchId = useId();

  useEffect(() => {
    let alive = true;
    listAssets()
      .then((rows) => {
        if (!alive) return;
        setOptions(
          rows
            .filter((r) => isAssetKind(r.kind))
            .map((r) => ({ id: r.id, name: r.name, kind: r.kind as AssetKind, isActive: r.is_active })),
        );
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (options ?? []).filter((o) => !q || o.name.toLowerCase().includes(q));
  }, [options, query]);

  const selected = (options ?? []).find((o) => o.id === value) ?? null;

  // Apenas se sabe el tipo del elegido (la banca llego), se avisa.
  const knownKind = selected?.kind ?? null;
  useEffect(() => {
    onKnownKind?.(knownKind);
  }, [knownKind, onKnownKind]);

  if (options === null && !failed) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Cargando la banca…
      </p>
    );
  }
  if (failed) {
    return (
      <p role="alert" className="text-xs text-red-600">
        No pude leer la banca de recursos. Recargá la página.
      </p>
    );
  }
  if (options!.length === 0) {
    return <p className="text-xs text-muted-foreground">Todavía no hay recursos. Cargalos en Ajustes → Recursos y volvé acá.</p>;
  }

  return (
    <div>
      <label htmlFor={searchId} className="mb-2 block text-xs font-semibold text-foreground">
        {label}
      </label>
      <input
        id={searchId}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar por nombre…"
        disabled={disabled}
        className={`${fieldClass} mb-2`}
      />
      <select
        aria-label="Recurso"
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onPick((options ?? []).find((o) => o.id === e.target.value) ?? null)}
        className={fieldClass}
      >
        <option value="">Elegí un recurso…</option>
        {shown.map((o) => (
          <option key={o.id} value={o.id}>
            {ASSET_KIND_LABEL[o.kind]} · {o.name}
            {o.isActive ? "" : " (inactivo)"}
          </option>
        ))}
        {/* El elegido se ve aunque el buscador lo esconda, o si ya no esta en la banca. */}
        {value && !shown.some((o) => o.id === value) && (
          <option value={value}>
            {selected ? `${ASSET_KIND_LABEL[selected.kind]} · ${selected.name}` : `${valueName ?? "Recurso"} (ya no está en la banca)`}
          </option>
        )}
      </select>
      {value && !selected && (
        <p role="alert" className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">
          Este recurso ya no está en la banca: el paso se va a saltear.
        </p>
      )}
      {selected && !selected.isActive && (
        <p role="alert" className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">
          Este recurso está inactivo: el paso se va a saltear hasta que lo actives.
        </p>
      )}
    </div>
  );
}
