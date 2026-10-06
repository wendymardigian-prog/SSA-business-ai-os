"use client";

import { ArrowDown, ArrowUp, X } from "lucide-react";
import { liveMedia, type MediaEntry } from "@/lib/content/media";
import { describeFile, idOf } from "@/lib/content/media-library";
import {
  changeFormat,
  checkFormatFiles,
  eligibleFiles,
  formatsFor,
  getFormat,
  moveFile,
  requirementText,
  suggestFormat,
  toggleFile,
} from "@/lib/content/network-format";
import type { NetworkEntry } from "@/lib/content/redistribution";
import { cn } from "@/lib/utils";

const field = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

/**
 * Formato y archivos de una red (F93).
 *
 * El formato dice cuantos archivos pide y de que tipo; el selector solo ofrece
 * los de la biblioteca que sirven, los elegidos van numerados EN EL ORDEN en
 * que se publican, y se reordenan con ↑ ↓ (sin arrastrar: funciona con
 * teclado y en el celular). Una linea en verde o rojo dice si esta lista.
 *
 * Una red sin formato sigue el modelo anterior (usa toda la biblioteca). Elegir
 * uno la pasa al modelo nuevo: se descartan los archivos que ya no sirven y se
 * propone uno valido si lo hay. Los archivos descartados quedan en la
 * biblioteca.
 */
export function FormatFiles({
  network,
  library,
  pieceFormat,
  editable,
  onChange,
}: {
  network: NetworkEntry;
  library: MediaEntry[];
  /** El formato escrito de la pieza, para sugerir uno. */
  pieceFormat: string | null;
  editable: boolean;
  onChange: (patch: Partial<NetworkEntry>) => void;
}) {
  const def = getFormat(network.platform, network.format);
  const live = liveMedia(library);
  const byId = new Map(live.map((m, index) => [idOf(m), { entry: m, index }]));
  const suggested = !network.format ? suggestFormat(network.platform, pieceFormat) : null;
  const suggestedLabel = suggested ? getFormat(network.platform, suggested)?.label : null;

  const legacyOwn = Array.isArray(network.media) ? network.media.length : 0;

  return (
    <div className="space-y-3">
      <label className="block space-y-1">
        <span className="text-xs font-medium">Formato en {network.platform}</span>
        <select
          value={network.format ?? ""}
          disabled={!editable}
          onChange={(e) => {
            if (!e.target.value) return;
            const next = changeFormat(network, e.target.value, library);
            onChange({ format: next.format, files: next.files, media: null });
          }}
          className={field}
        >
          {!network.format && <option value="">Elegí un formato</option>}
          {formatsFor(network.platform).map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </label>

      {!def ? (
        <div className="space-y-1.5 text-xs text-muted-foreground">
          <p>
            {legacyOwn > 0
              ? `Esta red usa ${legacyOwn} archivo${legacyOwn === 1 ? "" : "s"} propio${legacyOwn === 1 ? "" : "s"} del formato anterior.`
              : "Esta red usa todos los archivos de la biblioteca."}{" "}
            Elegí un formato para decidir cuáles publica y en qué orden.
          </p>
          {suggested && editable && (
            <button
              type="button"
              onClick={() => {
                const next = changeFormat(network, suggested, library);
                onChange({ format: next.format, files: next.files, media: null });
              }}
              className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-accent"
            >
              Usar el sugerido: {suggestedLabel}
            </button>
          )}
        </div>
      ) : (
        <FilesPicker network={network} def={def} byId={byId} live={live} editable={editable} onChange={onChange} />
      )}
    </div>
  );
}

function FilesPicker({
  network,
  def,
  byId,
  live,
  editable,
  onChange,
}: {
  network: NetworkEntry;
  def: NonNullable<ReturnType<typeof getFormat>>;
  byId: Map<string, { entry: MediaEntry; index: number }>;
  live: MediaEntry[];
  editable: boolean;
  onChange: (patch: Partial<NetworkEntry>) => void;
}) {
  const selectedIds = (network.files ?? []).filter((id) => byId.has(id));
  const selected = selectedIds.map((id) => byId.get(id)!);
  const available = eligibleFiles(def, live).filter((m) => !selectedIds.includes(idOf(m)));
  const check = checkFormatFiles(def, selected.map((s) => s.entry));

  const setFiles = (files: string[]) => onChange({ files });

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">Este formato pide {requirementText(def)}.</p>

      {def.max > 0 && (
        <>
          {selected.length > 0 && (
            <ol className="space-y-1" aria-label={`Archivos que publica ${network.platform}, en orden`}>
              {selected.map(({ entry, index }, position) => {
                const info = describeFile(entry, index);
                const id = idOf(entry);
                return (
                  <li key={id} className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5">
                    <span
                      aria-hidden
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-medium text-primary-foreground"
                    >
                      {position + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{info.name}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {[info.kindLabel, info.size, info.ratio].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {editable && (
                      <span className="flex shrink-0 items-center">
                        {def.max > 1 && (
                          <>
                            <IconButton
                              label={`Subir ${info.name}`}
                              disabled={position === 0}
                              onClick={() => setFiles(moveFile(selectedIds, id, "up"))}
                            >
                              <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                            </IconButton>
                            <IconButton
                              label={`Bajar ${info.name}`}
                              disabled={position === selected.length - 1}
                              onClick={() => setFiles(moveFile(selectedIds, id, "down"))}
                            >
                              <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                            </IconButton>
                          </>
                        )}
                        <IconButton
                          label={`Sacar ${info.name} de ${network.platform}`}
                          onClick={() => setFiles(toggleFile(selectedIds, id, def))}
                        >
                          <X className="h-3.5 w-3.5" aria-hidden />
                        </IconButton>
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {available.length > 0 && editable && (
            <div>
              <p className="mb-1 text-[11px] text-muted-foreground">
                {def.max === 1 ? "Elegí el archivo:" : "Agregá archivos de la biblioteca:"}
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {available.map((entry) => {
                  const index = byId.get(idOf(entry))!.index;
                  const info = describeFile(entry, index);
                  const full = def.max > 1 && selectedIds.length >= def.max;
                  return (
                    <li key={idOf(entry)}>
                      <button
                        type="button"
                        disabled={full}
                        onClick={() => setFiles(toggleFile(selectedIds, idOf(entry), def))}
                        title={full ? `Ya llegaste al máximo: ${def.max}` : undefined}
                        className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
                      >
                        + {info.name} <span className="text-muted-foreground">({info.kindLabel})</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {available.length === 0 && selected.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No hay archivos de la biblioteca que sirvan para este formato. Subí uno arriba, en &quot;Archivos de la pieza&quot;.
            </p>
          )}
        </>
      )}

      {/* La linea de verificacion: la misma regla que aplica el servidor. */}
      <p
        role="status"
        className={cn(
          "rounded-lg px-2.5 py-1.5 text-xs",
          check.ok
            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            : "bg-red-500/10 text-red-600 dark:text-red-400",
        )}
      >
        {check.ok ? "✓ " : "✕ "}
        {check.message}
      </p>
    </div>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
    >
      {children}
    </button>
  );
}
