"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Archive, ArchiveRestore, Check, Loader2, Pencil, Plus, X } from "lucide-react";
import {
  archiveOffer,
  archivePillar,
  createOffer,
  createPillar,
  renameOffer,
  renamePillar,
  restoreOffer,
  restorePillar,
  setPillarColor,
  type TaxonomyResult,
} from "@/lib/actions/content-taxonomy";
import { PILLAR_COLORS, TAXONOMY_NAME_MAX } from "@/lib/content/taxonomy";
import { ActionError } from "@/components/contacts/ui";
import { PageHeader } from "@/components/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { SettingsEmptyState } from "@/components/settings/settings-empty-state";
import { SETTINGS_EMPTY_STATES } from "@/lib/settings/empty-states";
import { cn } from "@/lib/utils";

export interface TaxonomyRow {
  id: string;
  name: string;
  color: string | null;
  archived: boolean;
  /** Cuantas piezas lo usan. */
  pieces: number;
}

/**
 * Ajustes -> Contenido (F89): los pilares y las ofertas del negocio.
 *
 * Dos listas con el mismo esqueleto. Cada fila: nombre, cuantas piezas lo
 * usan, renombrar y archivar. NO hay "eliminar": archivar lo saca del
 * selector sin tocar lo ya publicado, y por eso los archivados se pueden
 * ver y restaurar.
 */
export function ContenidoView({ pillars, offers }: { pillars: TaxonomyRow[]; offers: TaxonomyRow[] }) {
  return (
    <div className="flex h-full flex-col overflow-auto">
      <PageHeader
        route="/dashboard/settings/contenido"
        backHref={
          <Link
            href="/dashboard/settings"
            aria-label="Volver a Ajustes"
            className="-ml-1 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        }
      />
      <SettingsTabs />

      <div className="grid flex-1 gap-8 px-4 py-6 md:px-8 lg:grid-cols-2">
        <TaxonomySection
          title="Pilares"
          description="Los grandes temas de tu contenido. Cada idea y cada pieza apunta a uno."
          singular="pilar"
          feminine={false}
          rows={pillars}
          withColor
          actions={{
            create: (name, color) => createPillar({ name, color }),
            rename: (id, name) => renamePillar({ id, name }),
            archive: (id) => archivePillar({ id }),
            restore: (id) => restorePillar({ id }),
            setColor: (id, color) => setPillarColor({ id, color }),
          }}
        />
        <TaxonomySection
          title="Ofertas"
          description="Lo que vendes. Sirve para saber que contenido empuja cada oferta."
          singular="oferta"
          feminine
          rows={offers}
          actions={{
            create: (name) => createOffer({ name }),
            rename: (id, name) => renameOffer({ id, name }),
            archive: (id) => archiveOffer({ id }),
            restore: (id) => restoreOffer({ id }),
          }}
        />
      </div>
    </div>
  );
}

interface SectionActions {
  create: (name: string, color?: string | null) => Promise<TaxonomyResult<{ id: string; name: string; color: string | null }>>;
  rename: (id: string, name: string) => Promise<TaxonomyResult>;
  archive: (id: string) => Promise<TaxonomyResult>;
  restore: (id: string) => Promise<TaxonomyResult>;
  setColor?: (id: string, color: string) => Promise<TaxonomyResult>;
}

function TaxonomySection({
  title,
  description,
  singular,
  feminine,
  rows,
  withColor = false,
  actions,
}: {
  title: string;
  description: string;
  singular: string;
  /** "oferta" es femenino: cambia el articulo de las etiquetas. */
  feminine: boolean;
  rows: TaxonomyRow[];
  withColor?: boolean;
  actions: SectionActions;
}) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const nameOf = feminine ? `de la ${singular}` : `del ${singular}`;
  const active = rows.filter((r) => !r.archived);
  const archived = rows.filter((r) => r.archived);
  const shown = showArchived ? rows : active;

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
    run(() => actions.create(newName), () => setNewName(""));
  }

  function saveEdit(id: string) {
    run(() => actions.rename(id, editName), () => setEditingId(null));
  }

  return (
    <section aria-labelledby={`taxonomy-${singular}`} className="min-w-0">
      <h2 id={`taxonomy-${singular}`} className="text-base font-semibold">
        {title}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <label htmlFor={`new-${singular}`} className="sr-only">
          Nombre {nameOf} {feminine ? "nueva" : "nuevo"}
        </label>
        <input
          id={`new-${singular}`}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          maxLength={TAXONOMY_NAME_MAX}
          placeholder={feminine ? `Nueva ${singular}` : `Nuevo ${singular}`}
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
          <SettingsEmptyState description={singular === "pilar" ? SETTINGS_EMPTY_STATES.contentPillars : SETTINGS_EMPTY_STATES.contentOffers} />
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
              {withColor && (
                <ColorSwatch
                  row={row}
                  disabled={pending || row.archived || !actions.setColor}
                  onPick={(color) => run(() => actions.setColor!(row.id, color))}
                />
              )}

              {editingId === row.id ? (
                <form
                  className="flex min-w-0 flex-1 items-center gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveEdit(row.id);
                  }}
                >
                  <label htmlFor={`edit-${row.id}`} className="sr-only">
                    Nombre {nameOf}
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
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">
                          Archivado
                        </span>
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
                    onClick={() => run(() => (row.archived ? actions.restore(row.id) : actions.archive(row.id)))}
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

function ColorSwatch({
  row,
  disabled,
  onPick,
}: {
  row: TaxonomyRow;
  disabled: boolean;
  onPick: (color: string) => void;
}) {
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
              className={cn(
                "h-5 w-5 rounded-full border",
                row.color === color ? "border-foreground" : "border-transparent",
              )}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
