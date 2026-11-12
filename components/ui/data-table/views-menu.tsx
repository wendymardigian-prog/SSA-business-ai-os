"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bookmark, Check, Pencil, Star, Trash2, X } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { deleteTableView, saveTableView, setTableViewDefault } from "@/lib/actions/table-views";
import { buildViewConfig, canManageView, VISIBILITY_LABELS, viewFilterString, viewHref, visibilityLine, VIEW_VISIBILITIES, type TableViewItem, type ViewVisibility } from "@/lib/ui/data-table/views";
import { clearTableDraft, type TablePrefsState } from "./use-table-prefs";

/**
 * El menú de vistas de una tabla: elegir una vista guardada (columnas y filtros), guardar la actual, y administrarlas.
 *
 *  - Cada persona tiene las suyas (privadas) y una predeterminada: la que se abre al entrar a la pantalla.
 *  - Owner y Admin pueden compartirlas con todo el equipo o con personas elegidas, y dejarlas como la predeterminada de
 *    otras personas. Lo que cada quien puede lo vuelve a decidir la base (migración 00360).
 *  - Una vista compartida solo la edita quien la creó o un Owner/Admin; el resto puede guardar una copia propia.
 */

export interface ViewsMenuMember {
  id: string;
  name: string;
}

export interface ViewsMenuProps {
  tableKey: string;
  views: readonly TableViewItem[];
  /** La predeterminada de quien mira. */
  defaultViewId: string | null;
  /** La vista cuyas columnas se aplican ahora (null = la de sistema). */
  activeId: string | null;
  userId: string;
  isAdmin: boolean;
  members: readonly ViewsMenuMember[];
  state: TablePrefsState;
  /** Los filtros puestos ahora en la URL (`viewFilterString`). */
  currentFilters: string;
}

type Mode = { kind: "list" } | { kind: "edit"; view: TableViewItem | null };

export function ViewsMenu(props: ViewsMenuProps) {
  const { views, activeId, defaultViewId, state, currentFilters } = props;
  const active = views.find((v) => v.id === activeId) ?? null;
  const filtersDirty = !!active && viewFilterString(active.config.filters) !== viewFilterString(currentFilters);
  const dirty = state.dirty || filtersDirty;
  const [mode, setMode] = useState<Mode>({ kind: "list" });

  return (
    <Popover
      label="Vistas"
      triggerClassName={`relative flex h-8 max-w-[11rem] max-topbar:h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-[13px] font-medium transition-colors ${active ? "border-primary-edge bg-primary/10" : "border-input bg-background hover:border-muted-foreground/60"}`}
      trigger={
        <>
          <Bookmark className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="hidden truncate md:inline">{active ? active.name : "Vistas"}</span>
          <span className="sr-only md:hidden">Vistas</span>
          {dirty && <span aria-hidden className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" title="Hay cambios sin guardar" />}
        </>
      }
      panelClassName="w-[min(22rem,calc(100vw-2rem))] max-h-[75vh] overflow-y-auto"
      align="end"
    >
      {mode.kind === "list" ? (
        <ViewsList {...props} active={active} dirty={dirty} defaultViewId={defaultViewId} onEdit={(view) => setMode({ kind: "edit", view })} />
      ) : (
        <ViewEditor {...props} active={active} view={mode.view} dirty={dirty} onDone={() => setMode({ kind: "list" })} />
      )}
    </Popover>
  );
}

function useErrorState() {
  const [error, setError] = useState<string | null>(null);
  return { error, setError };
}

function ViewsList({
  tableKey,
  views,
  defaultViewId,
  active,
  userId,
  isAdmin,
  state,
  dirty,
  onEdit,
}: ViewsMenuProps & { active: TableViewItem | null; dirty: boolean; onEdit: (view: TableViewItem | null) => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const { error, setError } = useErrorState();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  function go(view: TableViewItem | null) {
    router.push(viewHref(pathname, view));
  }

  function toggleDefault(view: TableViewItem) {
    setError(null);
    start(async () => {
      const res = await setTableViewDefault({ tableKey, viewId: defaultViewId === view.id ? null : view.id });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  function remove(view: TableViewItem) {
    setError(null);
    start(async () => {
      const res = await deleteTableView(view.id);
      setConfirmDelete(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      clearTableDraft(tableKey, view.id);
      if (active?.id === view.id) router.push(viewHref(pathname, null));
      else router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {dirty && (
        <div className="space-y-2 rounded-lg border border-primary-edge bg-primary/5 p-2.5">
          <p className="text-xs font-medium">Hay cambios sin guardar{active ? ` en «${active.name}»` : ""}.</p>
          <div className="flex flex-wrap gap-1.5">
            {active && canManageView(active, userId, isAdmin) && (
              <button type="button" disabled={pending} onClick={() => onEdit(active)} className="h-7 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
                Guardar en esta vista
              </button>
            )}
            <button type="button" onClick={() => onEdit(null)} className="h-7 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-accent">
              Guardar como vista nueva
            </button>
            <button
              type="button"
              onClick={() => {
                state.discard();
                if (active) go(active);
              }}
              className="h-7 rounded-md px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Descartar
            </button>
          </div>
        </div>
      )}

      <div>
        <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Vistas</p>
        <ul className="space-y-0.5">
          <li>
            <button
              type="button"
              onClick={() => go(null)}
              aria-current={active ? undefined : "true"}
              className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-xs hover:bg-accent/60"
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">{!active && <Check className="h-3.5 w-3.5 text-primary-ink" aria-hidden />}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">Vista del sistema</span>
                <span className="block text-[11px] text-muted-foreground">Las columnas y los filtros de siempre</span>
              </span>
            </button>
          </li>
          {views.map((view) => {
            const isDefault = defaultViewId === view.id;
            const manageable = canManageView(view, userId, isAdmin);
            return (
              <li key={view.id} className="group flex items-center gap-1 rounded-md hover:bg-accent/60">
                <button type="button" onClick={() => go(view)} aria-current={active?.id === view.id ? "true" : undefined} className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1.5 text-left text-xs">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">{active?.id === view.id && <Check className="h-3.5 w-3.5 text-primary-ink" aria-hidden />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{view.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {visibilityLine(view)}
                      {view.ownerId !== userId && view.visibility !== "private" ? " · compartida con vos" : ""}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => toggleDefault(view)}
                  aria-pressed={isDefault}
                  aria-label={isDefault ? `Quitar «${view.name}» como mi predeterminada` : `Dejar «${view.name}» como mi predeterminada`}
                  title={isDefault ? "Es tu vista predeterminada. Clic para quitarla." : "Dejarla como tu vista predeterminada"}
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-accent ${isDefault ? "text-amber-500" : "text-muted-foreground/50 hover:text-foreground"}`}
                >
                  <Star className={`h-3.5 w-3.5 ${isDefault ? "fill-current" : ""}`} aria-hidden />
                </button>
                {manageable &&
                  (confirmDelete === view.id ? (
                    <span className="flex shrink-0 items-center gap-1 pr-1 text-[11px]">
                      <button type="button" disabled={pending} onClick={() => remove(view)} className="rounded bg-red-600 px-1.5 py-0.5 font-medium text-white hover:bg-red-700 disabled:opacity-50">
                        Borrar
                      </button>
                      <button type="button" onClick={() => setConfirmDelete(null)} className="rounded px-1.5 py-0.5 hover:bg-accent">
                        No
                      </button>
                    </span>
                  ) : (
                    <>
                      <button type="button" onClick={() => onEdit(view)} aria-label={`Editar «${view.name}»`} title="Editar" className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:bg-accent hover:text-foreground">
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button type="button" onClick={() => setConfirmDelete(view.id)} aria-label={`Borrar «${view.name}»`} title="Borrar" className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:bg-accent hover:text-red-600">
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </>
                  ))}
              </li>
            );
          })}
        </ul>
        {views.length === 0 && <p className="px-1.5 pt-1 text-[11px] text-muted-foreground">Todavía no guardaste ninguna vista. Armá las columnas y los filtros como te sirvan y guardalos.</p>}
      </div>

      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      <button type="button" onClick={() => onEdit(null)} className="h-8 w-full rounded-lg border border-border text-xs font-medium hover:bg-accent">
        Guardar la vista actual…
      </button>
    </div>
  );
}

function ViewEditor({
  tableKey,
  view,
  members,
  userId,
  isAdmin,
  state,
  currentFilters,
  dirty,
  active,
  onDone,
}: ViewsMenuProps & { view: TableViewItem | null; dirty: boolean; active: TableViewItem | null; onDone: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const { error, setError } = useErrorState();
  const editing = view !== null;

  const [name, setName] = useState(view?.name ?? "");
  const [visibility, setVisibility] = useState<ViewVisibility>(view?.visibility ?? "private");
  const [memberIds, setMemberIds] = useState<string[]>(view?.memberIds ?? []);
  const previousDefaults = view?.defaultFor ?? [];
  const [defaultFor, setDefaultFor] = useState<string[]>(previousDefaults);
  const [refresh, setRefresh] = useState(!editing || (dirty && view?.id === active?.id));

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const shared = visibility !== "private";
  // A quién se le puede dejar como predeterminada: a todas las personas que la ven.
  const audience = visibility === "private" ? members.filter((m) => m.id === userId) : visibility === "workspace" ? members : members.filter((m) => memberIds.includes(m.id) || m.id === userId);

  function save() {
    setError(null);
    const keep = defaultFor.filter((id) => audience.some((m) => m.id === id));
    const add = keep.filter((id) => !previousDefaults.includes(id));
    const remove = previousDefaults.filter((id) => !keep.includes(id) && (isAdmin || id === userId));
    start(async () => {
      const res = await saveTableView({
        id: view?.id ?? null,
        tableKey,
        name,
        ...(refresh ? { columns: state.prefs, filters: currentFilters } : {}),
        visibility: isAdmin ? visibility : "private",
        memberIds: visibility === "selected" ? memberIds : undefined,
        makeDefaultForMe: add.includes(userId),
        defaultForUserIds: add.filter((id) => id !== userId),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (remove.length > 0) {
        const removed = await setTableViewDefault({ tableKey, viewId: null, userIds: remove });
        if (!removed.ok) {
          setError(removed.error);
          return;
        }
      }
      // Lo que se guardó ya no es «sin guardar»: se borra el borrador de la vista de donde venía y de la nueva.
      if (refresh) {
        clearTableDraft(tableKey, editing ? res.id : (active?.id ?? "base"));
        clearTableDraft(tableKey, res.id);
      }
      onDone();
      // Una vista nueva se abre (con sus filtros); editar una existente solo vuelve a leer.
      if (!editing) router.push(viewHref(pathname, { id: res.id, config: buildViewConfig(state.prefs, currentFilters) }));
      else router.refresh();
      if (res.warning) console.warn(res.warning);
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="space-y-3"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{editing ? "Editar vista" : "Guardar la vista actual"}</p>
        <button type="button" onClick={onDone} aria-label="Volver" className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <label className="block space-y-1">
        <span className="text-xs font-medium">Nombre</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          autoFocus
          placeholder="Por ejemplo: Cobranza de la semana" // @plantilla-quitar(ventas)
          // @plantilla-sin(ventas): placeholder="Por ejemplo: Contactos de la semana"
          className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm focus:border-primary-edge focus:outline-none focus:ring-1 focus:ring-primary-edge"
        />
      </label>

      {editing ? (
        <label className="flex cursor-pointer items-start gap-2 text-xs">
          <input type="checkbox" checked={refresh} onChange={(e) => setRefresh(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-primary)]" />
          <span>
            <span className="block font-medium">Guardar las columnas y los filtros que estoy viendo</span>
            <span className="block text-[11px] text-muted-foreground">Si no, queda como estaba y solo cambian los datos de abajo.</span>
          </span>
        </label>
      ) : (
        <p className="text-[11px] text-muted-foreground">Se guardan las columnas (orden, fijas, anchos) y los filtros que estás viendo ahora.</p>
      )}

      {isAdmin && (
        <fieldset className="space-y-1.5">
          <legend className="pb-0.5 text-xs font-medium">Quién la ve</legend>
          <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="Quién la ve">
            {VIEW_VISIBILITIES.map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={visibility === v}
                onClick={() => setVisibility(v)}
                className={`h-8 rounded-lg border px-1 text-[11px] font-medium ${visibility === v ? "border-primary-edge bg-primary/10 text-primary-ink" : "border-border hover:bg-accent"}`}
              >
                {VISIBILITY_LABELS[v]}
              </button>
            ))}
          </div>
          {visibility === "selected" && (
            <PeopleList label="Se la muestro a" members={members.filter((m) => m.id !== userId)} selected={memberIds} onToggle={(id) => setMemberIds((list) => toggle(list, id))} />
          )}
        </fieldset>
      )}

      <fieldset className="space-y-1.5">
        <legend className="pb-0.5 text-xs font-medium">{isAdmin && shared ? "Predeterminada para" : "Predeterminada"}</legend>
        {isAdmin && shared ? (
          <>
            <PeopleList label="Es la vista que se abre al entrar para" members={audience} selected={defaultFor} onToggle={(id) => setDefaultFor((list) => toggle(list, id))} youId={userId} />
          </>
        ) : (
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input type="checkbox" checked={defaultFor.includes(userId)} onChange={() => setDefaultFor((list) => toggle(list, userId))} className="h-3.5 w-3.5 accent-[var(--color-primary)]" />
            Que sea la que se abre cuando entro a esta pantalla
          </label>
        )}
      </fieldset>

      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={pending || !name.trim()} className="h-8 flex-1 rounded-lg bg-primary text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
          {pending ? "Guardando…" : editing ? "Guardar cambios" : "Guardar vista"}
        </button>
        <button type="button" onClick={onDone} className="h-8 rounded-lg border border-border px-3 text-xs hover:bg-accent">
          Cancelar
        </button>
      </div>
    </form>
  );
}

function PeopleList({ label, members, selected, onToggle, youId }: { label: string; members: readonly ViewsMenuMember[]; selected: readonly string[]; onToggle: (id: string) => void; youId?: string }) {
  if (members.length === 0) return <p className="text-[11px] text-muted-foreground">No hay otras personas en el equipo.</p>;
  return (
    <div className="space-y-1">
      <p className="text-[11px] text-muted-foreground">{label}:</p>
      <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-border p-1">
        {members.map((m) => (
          <li key={m.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-accent/60">
              <input type="checkbox" checked={selected.includes(m.id)} onChange={() => onToggle(m.id)} className="h-3.5 w-3.5 accent-[var(--color-primary)]" />
              <span className="truncate">
                {m.name}
                {youId === m.id ? " (vos)" : ""}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
