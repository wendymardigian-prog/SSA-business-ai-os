"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Pencil, Trash2, X } from "lucide-react";
import { ContentDialog } from "@/components/content/dialog";
import { categoryKey, MAX_CATEGORY_LENGTH, normalizeCategory } from "@/lib/categories";

export type CategoryChange = { kind: "rename"; from: string; to: string } | { kind: "delete"; name: string };
type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Editar las categorias de una pantalla (formularios o automatizaciones): cuantas piezas usa cada una, renombrar
 * (si el nombre nuevo ya existe, las dos quedan unidas) y quitar (sale de todas las piezas; no se borra nada mas).
 * Se abre desde «Editar categorías…», al pie del filtro «Categorías» de la barra.
 */
export function ManageCategoriesDialog({
  items,
  noun,
  onRename,
  onDelete,
  onChanged,
  onClose,
}: {
  /** Las categorias en uso, con cuantas piezas tiene cada una. */
  items: Array<{ name: string; count: number }>;
  /** Singular y plural: "formulario" / "formularios". */
  noun: [string, string];
  onRename: (from: string, to: string) => Promise<ActionResult>;
  onDelete: (name: string) => Promise<ActionResult>;
  /** Despues de un cambio que salio bien (la pantalla refresca y ajusta su filtro). */
  onChanged: (change: CategoryChange) => void;
  onClose: () => void;
}) {
  // `ContentDialog` vuelve a enfocar el primer campo si cambia `onClose`: se lo pasa estable.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  const close = useCallback(() => closeRef.current(), []);

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const count = (n: number) => (n === 1 ? `1 ${noun[0]}` : `${n} ${noun[1]}`);
  const typed = normalizeCategory(draft);
  const mergeWith = editing && typed ? items.find((i) => categoryKey(i.name) === categoryKey(typed) && categoryKey(i.name) !== categoryKey(editing)) : undefined;
  const unchanged = !!editing && typed === editing;

  async function run(action: () => Promise<ActionResult>, change: CategoryChange) {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(null);
      setDeleting(null);
      onChanged(change);
    } catch {
      setError("No se pudo guardar el cambio. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  function saveRename() {
    if (!editing || !typed || unchanged) {
      setEditing(null);
      return;
    }
    const from = editing;
    const to = mergeWith ? mergeWith.name : typed;
    void run(() => onRename(from, to), { kind: "rename", from, to });
  }

  return (
    <ContentDialog
      title="Editar categorías"
      label="Editar categorías"
      onClose={close}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">Las categorías nuevas se crean escribiéndolas en cada {noun[0]}.</p>
          <button type="button" onClick={close} className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent">
            Listo
          </button>
        </div>
      }
    >
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Todavía no hay categorías.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map((item) => (
            <li key={item.name} className="px-3 py-2">
              {editing === item.name ? (
                <div>
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      aria-label={`Nuevo nombre para ${item.name}`}
                      value={draft}
                      maxLength={MAX_CATEGORY_LENGTH}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          saveRename();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          e.stopPropagation();
                          setEditing(null);
                        }
                      }}
                      className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm focus:border-primary-edge focus:outline-none focus:ring-1 focus:ring-primary-edge"
                    />
                    <button type="button" onClick={saveRename} disabled={busy || !typed} aria-label="Guardar el nombre" className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    </button>
                    <button type="button" onClick={() => setEditing(null)} disabled={busy} aria-label="Cancelar" className="grid h-7 w-7 place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {mergeWith && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Ya existe «{mergeWith.name}»: las dos se van a unir en una sola.
                    </p>
                  )}
                </div>
              ) : deleting === item.name ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1">
                    ¿Quitar «{item.name}» de {count(item.count)}? No se borra nada más.
                  </span>
                  <button
                    type="button"
                    onClick={() => void run(() => onDelete(item.name), { kind: "delete", name: item.name })}
                    disabled={busy}
                    className="inline-flex items-center gap-1 rounded-md bg-destructive px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                    Quitar
                  </button>
                  <button type="button" onClick={() => setDeleting(null)} disabled={busy} className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent">
                    Cancelar
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="inline-flex min-w-0 max-w-[60%] items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary-ink">
                    <span className="truncate">{item.name}</span>
                  </span>
                  <span className="flex-1 text-xs text-muted-foreground">{count(item.count)}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setDeleting(null);
                      setEditing(item.name);
                      setDraft(item.name);
                    }}
                    disabled={busy}
                    aria-label={`Renombrar ${item.name}`}
                    title="Renombrar"
                    className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setEditing(null);
                      setDeleting(item.name);
                    }}
                    disabled={busy}
                    aria-label={`Quitar ${item.name}`}
                    title="Quitar"
                    className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </ContentDialog>
  );
}
