"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Check, Loader2, Pencil, Plus, X } from "lucide-react";
import {
  archivePillar,
  createPillar,
  renamePillar,
  restorePillar,
  setPillarColor,
} from "@/lib/actions/content-taxonomy";
import { PILLAR_COLORS, TAXONOMY_NAME_MAX } from "@/lib/content/taxonomy";
import { ActionError } from "@/components/contacts/ui";
import { SettingsEmptyState } from "@/components/settings/settings-empty-state";
import { SETTINGS_EMPTY_STATES } from "@/lib/settings/empty-states";
import { cn } from "@/lib/utils";

export interface PillarRow {
  id: string;
  name: string;
  color: string | null;
  archived: boolean;
  /** Cuantas piezas lo usan. */
  pieces: number;
}

/**
 * Los pilares del contenido: los grandes temas con los que se clasifica cada
 * idea y cada pieza.
 *
 * Vive detras del boton de ajustes (⚙️) de la pagina de Contenido (antes era
 * una columna de Ajustes -> Contenido). Cada fila: color, nombre, cuantas
 * piezas lo usan, renombrar y archivar. NO hay "eliminar": archivar lo saca del
 * selector sin tocar lo ya publicado, y por eso los archivados se pueden ver y
 * restaurar.
 */
export function PillarsManager({ pillars }: { pillars: PillarRow[] }) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const active = pillars.filter((r) => !r.archived);
  const archived = pillars.filter((r) => r.archived);
  const shown = showArchived ? pillars : active;

  function run(task: () => Promise<{ ok: true } | { ok: false; error: string }>, onDone?: () => void) {
    setError(null);
    start(async () => {
      const result = await task();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onDone?.();
      router.refresh();
    });
  }

  function add() {
    if (!newName.trim()) return;
    run(() => createPillar({ name: newName }), () => setNewName(""));
  }

  function saveEdit(id: string) {
    run(() => renamePillar({ id, name: editName }), () => setEditingId(null));
  }

  return (
    <section aria-labelledby="taxonomy-pilar" className="min-w-0">
      <h3 id="taxonomy-pilar" className="text-base font-semibold">
        Pilares
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">Los grandes temas de tu contenido. Cada idea y cada pieza apunta a uno.</p>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <label htmlFor="new-pilar" className="sr-only">
          Nombre del pilar nuevo
        </label>
        <input
          id="new-pilar"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          maxLength={TAXONOMY_NAME_MAX}
          placeholder="Nuevo pilar"
          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
        />
        <button
          type="submit"
          disabled={pending || !newName.trim()}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Agregar
        </button>
      </form>

      {error && (
        <div className="mt-3">
          <ActionError message={error} />
        </div>
      )}

      {active.length === 0 && archived.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-border">
          <SettingsEmptyState description={SETTINGS_EMPTY_STATES.contentPillars} />
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
          {shown.length === 0 && (
            <li className="px-3 py-4 text-sm text-muted-foreground">
              Todo está archivado. Mostrá los archivados para restaurar alguno.
            </li>
          )}
          {shown.map((row) => (
            <li key={row.id} className={cn("flex items-center gap-3 px-3 py-2.5", row.archived && "bg-muted/40")}>
              <ColorSwatch row={row} disabled={pending || row.archived} onPick={(color) => run(() => setPillarColor({ id: row.id, color }))} />

              {editingId === row.id ? (
                <form
                  className="flex min-w-0 flex-1 items-center gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveEdit(row.id);
                  }}
                >
                  <label htmlFor={`edit-${row.id}`} className="sr-only">
                    Nombre del pilar
                  </label>
                  <input
                    id={`edit-${row.id}`}
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={TAXONOMY_NAME_MAX}
                    className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary"
                  />
                  <button
                    type="submit"
                    aria-label="Guardar nombre"
                    disabled={pending}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Cancelar"
                    onClick={() => setEditingId(null)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </form>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-sm font-medium", row.archived && "text-muted-foreground")}>
                      {row.name}
                      {row.archived && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">Archivado</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {row.pieces === 0 ? "Sin piezas" : `${row.pieces} ${row.pieces === 1 ? "pieza" : "piezas"}`}
                    </p>
                  </div>
                  {!row.archived && (
                    <button
                      type="button"
                      aria-label={`Renombrar ${row.name}`}
                      onClick={() => {
                        setError(null);
                        setEditName(row.name);
                        setEditingId(row.id);
                      }}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`${row.archived ? "Restaurar" : "Archivar"} ${row.name}`}
                    title={
                      row.archived
                        ? "Vuelve a aparecer en los selectores"
                        : row.pieces > 0
                          ? "Deja de ofrecerse, pero las piezas que lo tienen lo siguen mostrando"
                          : "Deja de ofrecerse en los selectores"
                    }
                    disabled={pending}
                    onClick={() => run(() => (row.archived ? restorePillar({ id: row.id }) : archivePillar({ id: row.id })))}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                  >
                    {row.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          className="mt-3 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {showArchived ? "Ocultar archivados" : `Mostrar archivados (${archived.length})`}
        </button>
      )}
    </section>
  );
}

function ColorSwatch({ row, disabled, onPick }: { row: PillarRow; disabled: boolean; onPick: (color: string) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label={`Color de ${row.name}`}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="block h-5 w-5 rounded-full border border-border disabled:cursor-default"
        style={{ backgroundColor: row.color ?? "#64748b" }}
      />
      {open && (
        <div
          role="listbox"
          aria-label="Elegí un color"
          className="absolute left-0 top-7 z-10 flex gap-1.5 rounded-lg border border-border bg-popover p-2 shadow-md"
        >
          {PILLAR_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              role="option"
              aria-selected={row.color === color}
              aria-label={color}
              onClick={() => {
                setOpen(false);
                onPick(color);
              }}
              className={cn("h-5 w-5 rounded-full border", row.color === color ? "border-foreground" : "border-transparent")}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
