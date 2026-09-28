"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfigShell } from "./config-shell";
import { ContentDialog, DialogField } from "@/components/content/dialog";
import { Notice } from "@/components/agents/fields";
import { AREA_COLORS, CATEGORY_NAME_MAX, canArchive, categoryTree, type CategoryRow } from "@/lib/scheduling/categories";
import { archiveCategory, createCategory, renameCategory, reorderCategory } from "@/lib/actions/scheduling/categories";

/**
 * Configuracion de agenda > Categorias (F50): areas con sus tipos debajo.
 * Nada se borra: se archiva. Ventas y Servicio se renombran, no se archivan.
 */
export function CategoriesView({
  categories,
  canEdit,
  usage,
}: {
  categories: CategoryRow[];
  canEdit: boolean;
  usage: Record<string, { events: number; bookings: number }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [modal, setModal] = useState<
    | { kind: "area" }
    | { kind: "type"; areaId: string; areaName: string }
    | { kind: "rename"; category: CategoryRow }
    | null
  >(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(AREA_COLORS[0]);

  const tree = categoryTree(categories);
  const archived = categories.filter((c) => c.archived_at);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) {
    setError(null);
    start(async () => {
      const r = await action();
      if (!r.ok) {
        setError(r.error ?? "No se pudo");
        return;
      }
      done?.();
      router.refresh();
    });
  }

  function openArea() {
    setName("");
    setColor(AREA_COLORS[tree.length % AREA_COLORS.length]);
    setModal({ kind: "area" });
  }

  const count = (id: string) => usage[id] ?? { events: 0, bookings: 0 };

  return (
    <ConfigShell
      route="/dashboard/agenda/configuracion/categorias"
      right={
        canEdit ? (
          <button type="button" onClick={openArea} className="inline-flex h-9 items-center whitespace-nowrap rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">
            + Nueva área
          </button>
        ) : undefined
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      {!canEdit && <Notice tone="info">Podés ver las categorías. Para crearlas o cambiarlas hace falta el permiso de administrar áreas y tipos.</Notice>}

      {tree.map(({ area, types }) => (
        <section key={area.id} className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: area.color ?? "#94a3b8" }} aria-hidden="true" />
            <h2 className="text-sm font-semibold">{area.name}</h2>
            {area.is_system && <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">Área de sistema</span>}
            <span className="text-xs text-muted-foreground">
              {count(area.id).events} {count(area.id).events === 1 ? "evento" : "eventos"} · {count(area.id).bookings} agendas
            </span>
            {canEdit && (
              <span className="ml-auto flex gap-2 text-xs">
                <button type="button" onClick={() => { setName(area.name); setColor(area.color ?? AREA_COLORS[0]); setModal({ kind: "rename", category: area }); }} className="rounded-lg border border-border px-2.5 py-1 hover:bg-muted">
                  Renombrar
                </button>
                <button type="button" onClick={() => { setName(""); setModal({ kind: "type", areaId: area.id, areaName: area.name }); }} className="rounded-lg border border-border px-2.5 py-1 hover:bg-muted">
                  + Tipo
                </button>
                {canArchive(area).ok && (
                  <button type="button" disabled={pending} onClick={() => run(() => archiveCategory({ id: area.id }))} className="rounded-lg border border-border px-2.5 py-1 text-red-600 hover:bg-muted">
                    Archivar
                  </button>
                )}
              </span>
            )}
          </div>
          <ul className="mt-3 divide-y divide-border">
            {types.map((type, i) => (
              <li key={type.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="font-medium">{type.name}</span>
                <span className="text-xs text-muted-foreground">
                  {count(type.id).events} {count(type.id).events === 1 ? "evento" : "eventos"} · {count(type.id).bookings} agendas
                </span>
                {canEdit && (
                  <span className="ml-auto flex items-center gap-2 text-xs">
                    <button type="button" disabled={pending || i === 0} aria-label={`Subir ${type.name}`} onClick={() => run(() => reorderCategory({ id: type.id, toIndex: i - 1 }))} className="rounded px-1.5 py-1 text-muted-foreground hover:bg-muted disabled:opacity-30">↑</button>
                    <button type="button" disabled={pending || i === types.length - 1} aria-label={`Bajar ${type.name}`} onClick={() => run(() => reorderCategory({ id: type.id, toIndex: i + 1 }))} className="rounded px-1.5 py-1 text-muted-foreground hover:bg-muted disabled:opacity-30">↓</button>
                    <button type="button" onClick={() => { setName(type.name); setModal({ kind: "rename", category: type }); }} className="text-primary">Renombrar</button>
                    <button type="button" disabled={pending} onClick={() => run(() => archiveCategory({ id: type.id }))} className="text-red-600">Archivar</button>
                  </span>
                )}
              </li>
            ))}
            {types.length === 0 && <li className="py-2 text-sm text-muted-foreground">Sin tipos: los eventos de esta área quedan solo con el área.</li>}
          </ul>
        </section>
      ))}

      {archived.length > 0 && (
        <section className="rounded-xl border border-dashed border-border p-4">
          <button type="button" onClick={() => setShowArchived((v) => !v)} aria-expanded={showArchived} className="text-sm font-medium">
            Archivadas ({archived.length}) {showArchived ? "▾" : "▸"}
          </button>
          {showArchived && (
            <ul className="mt-2 divide-y divide-border">
              {archived.map((c) => (
                <li key={c.id} className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                  <span>{c.name}</span>
                  {c.parent_id && <span className="text-xs">tipo</span>}
                  {canEdit && (
                    <button type="button" disabled={pending} onClick={() => run(() => archiveCategory({ id: c.id, restore: true }))} className="ml-auto text-xs text-primary">
                      Restaurar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        Ventas y Servicio vienen creadas: se renombran pero no se archivan. Nada se borra: un área o tipo se <strong>archiva</strong> y lo existente conserva su categoría.
      </p>

      {modal && (
        <ContentDialog
          title={modal.kind === "rename" ? `Renombrar ${modal.category.parent_id ? "tipo" : "área"}` : modal.kind === "area" ? "Nueva área" : `Nuevo tipo en ${modal.areaName}`}
          label="Categoría"
          onClose={() => setModal(null)}
          footer={
            <div className="flex w-full justify-end gap-2">
              <button type="button" data-close onClick={() => setModal(null)} className="rounded-lg border border-border px-3 py-2 text-sm">Cancelar</button>
              <button
                type="button"
                disabled={pending || name.trim().length === 0}
                onClick={() =>
                  run(
                    () =>
                      modal.kind === "rename"
                        ? renameCategory({ id: modal.category.id, name, color: modal.category.parent_id ? null : color })
                        : createCategory({ name, parentId: modal.kind === "type" ? modal.areaId : null, color: modal.kind === "area" ? color : null }),
                    () => setModal(null),
                  )
                }
                className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                Guardar
              </button>
            </div>
          }
        >
          <div className="space-y-3">
            <DialogField label="Nombre" hint={`Hasta ${CATEGORY_NAME_MAX} caracteres`}>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={CATEGORY_NAME_MAX} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm" />
            </DialogField>
            {(modal.kind === "area" || (modal.kind === "rename" && !modal.category.parent_id)) && (
              <div>
                <p className="text-xs font-medium">Color</p>
                <div role="radiogroup" aria-label="Color del área" className="mt-1 flex flex-wrap gap-2">
                  {AREA_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={color === c}
                      aria-label={`Color ${c}`}
                      onClick={() => setColor(c)}
                      style={{ backgroundColor: c }}
                      className={`h-7 w-7 rounded-full ${color === c ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : ""}`}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </ContentDialog>
      )}
    </ConfigShell>
  );
}
