"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ListFilter, Search, X } from "lucide-react";
import type { MineSummary } from "@/lib/tasks/mine";
import type { ProjectSummary } from "@/lib/tasks/project";
import type { MemberLite } from "@/lib/tasks/table-model";
import { PRIORITY_LABELS, STATUS_LABELS, TASK_PRIORITIES, TASK_SOURCES, TASK_STATUSES } from "@/lib/tasks/types";
import { clearPanelFilters, countPanelFilters, ME, NONE, type GroupBy, type TasksViewState } from "@/lib/tasks/view-state";
import { cn } from "@/lib/utils";

const SOURCE_LABELS: Record<(typeof TASK_SOURCES)[number], string> = { manual: "Manual", flow: "Flujo", agent: "Agente", cx: "CX" };

interface Option {
  value: string;
  label: string;
}

function toggleValue(selected: string[], value: string): string[] {
  return selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];
}

/** Un boton de encendido y apagado (una opcion corta del panel, o «Mis tareas»). */
function Toggle({ pressed, onClick, children, className }: { pressed: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn("h-8 whitespace-nowrap rounded-lg border px-2.5 text-[13px] font-medium transition-colors", pressed ? "border-primary bg-primary/10" : "border-input bg-background hover:border-muted-foreground/60", className)}
    >
      {children}
    </button>
  );
}

/** Un filtro de pocas opciones: botones que se prenden y se apagan. */
function ChipGroup({ legend, options, selected, onChange }: { legend: string; options: Option[]; selected: string[]; onChange: (next: string[]) => void }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-xs font-medium text-muted-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={selected.includes(o.value)}
            onClick={() => onChange(toggleValue(selected, o.value))}
            className={cn("h-7 rounded-full border px-2.5 text-xs transition-colors", selected.includes(o.value) ? "border-primary bg-primary/10 font-medium" : "border-input hover:border-muted-foreground/60")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Un filtro de muchas opciones (personas, proyectos): casillas en una lista con scroll propio. */
function CheckGroup({ legend, options, selected, onChange }: { legend: string; options: Option[]; selected: string[]; onChange: (next: string[]) => void }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-xs font-medium text-muted-foreground">{legend}</legend>
      <div className="max-h-36 overflow-y-auto rounded-lg border border-input p-1">
        {options.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[13px] hover:bg-accent">
            <input type="checkbox" checked={selected.includes(o.value)} onChange={() => onChange(toggleValue(selected, o.value))} />
            <span className="truncate">{o.label}</span>
          </label>
        ))}
        {options.length === 0 && <p className="px-1.5 py-1 text-[13px] text-muted-foreground">Todavía no hay opciones.</p>}
      </div>
    </fieldset>
  );
}

/** Un chip de resumen de «Mis tareas»: el numero y lo que cuenta. En rojo si es de lo vencido y hay alguna. */
function SummaryChip({ n, text, hot }: { n: number; text: string; hot?: boolean }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs", hot && n > 0 ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300" : "border-border text-muted-foreground")}>
      <span className="font-semibold tabular-nums">{n}</span> {text}
    </span>
  );
}

/**
 * La barra de arriba de la lista, en UNA sola linea: buscador, boton «Filtros» (todos los filtros adentro),
 * «Mis tareas» y, en pantallas anchas, los contadores de lo mio (vencidas, vencen hoy, proximos 7 dias).
 * En el celular quedan solo el buscador y los dos botones.
 */
export function FiltersBar({
  state,
  onChange,
  members,
  projects,
  mine,
  onToggleMine,
  showGroup = true,
  total,
  shown,
}: {
  state: TasksViewState;
  onChange: (next: TasksViewState) => void;
  members: MemberLite[];
  projects: ProjectSummary[];
  mine: MineSummary;
  onToggleMine: () => void;
  showGroup?: boolean;
  total: number;
  shown: number;
}) {
  const panelFilters = countPanelFilters(state);
  const anyFilter = panelFilters > 0 || state.q !== "" || state.mine;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // El panel se cierra con Esc (devolviendo el foco al boton) y con un clic afuera.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  // La busqueda se escribe sin esperar a la URL y se manda a los 250 ms.
  const [q, setQ] = useState(state.q);
  const [seenQ, setSeenQ] = useState(state.q);
  if (state.q !== seenQ) {
    setSeenQ(state.q);
    setQ(state.q);
  }
  useEffect(() => {
    if (q.trim() === state.q) return;
    const t = setTimeout(() => onChange({ ...state, q: q.replace(/\s+/g, " ").trim().slice(0, 100) }), 250);
    return () => clearTimeout(t);
  }, [q, state, onChange]);

  const set = <K extends keyof TasksViewState>(key: K, value: TasksViewState[K]) => onChange({ ...state, [key]: value });
  const peopleOptions: Option[] = [{ value: ME, label: "Yo" }, ...members.map((m) => ({ value: m.id, label: m.name }))];

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center gap-2" role="search">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar en el título"
            aria-label="Buscar tareas por título"
            className="h-8 w-full rounded-lg border border-input bg-background pl-8 pr-2 text-sm"
          />
        </div>

        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-haspopup="dialog"
          className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition-colors", panelFilters > 0 || open ? "border-primary bg-primary/10" : "border-input bg-background hover:border-muted-foreground/60")}
        >
          <ListFilter className="h-3.5 w-3.5" aria-hidden /> Filtros
          {panelFilters > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">{panelFilters}</span>}
        </button>

        <Toggle pressed={state.mine} onClick={onToggleMine} className="shrink-0 px-3">Mis tareas</Toggle>

        <div className="hidden min-w-0 items-center gap-2 lg:flex" aria-label="Mis tareas, resumen">
          <SummaryChip n={mine.overdue} text={mine.overdue === 1 ? "vencida" : "vencidas"} hot />
          <SummaryChip n={mine.today} text={mine.today === 1 ? "vence hoy" : "vencen hoy"} />
          <SummaryChip n={mine.next7} text="en los próximos 7 días" />
        </div>

        <p className="ml-auto hidden shrink-0 whitespace-nowrap text-xs text-muted-foreground sm:block" aria-live="polite">
          {anyFilter ? `${shown} de ${total} tareas` : total === 1 ? "1 tarea" : `${total} tareas`}
        </p>
      </div>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Filtros"
          className="absolute left-0 top-full z-30 mt-1.5 max-h-[70vh] w-full space-y-4 overflow-y-auto rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg sm:w-[26rem]"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Filtros</h3>
            <div className="flex items-center gap-1">
              {panelFilters > 0 && (
                <button type="button" onClick={() => onChange(clearPanelFilters(state))} className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
                  <X className="h-3.5 w-3.5" aria-hidden /> Limpiar ({panelFilters})
                </button>
              )}
              <button type="button" onClick={() => { setOpen(false); buttonRef.current?.focus(); }} aria-label="Cerrar los filtros" className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>

          <ChipGroup legend="Estado" options={TASK_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))} selected={state.status} onChange={(v) => set("status", v as TasksViewState["status"])} />
          <ChipGroup legend="Prioridad" options={TASK_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} selected={state.priority} onChange={(v) => set("priority", v as TasksViewState["priority"])} />
          <ChipGroup legend="Origen" options={TASK_SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] }))} selected={state.source} onChange={(v) => set("source", v as TasksViewState["source"])} />

          <fieldset>
            <legend className="mb-1.5 text-xs font-medium text-muted-foreground">Situación</legend>
            <div className="flex flex-wrap gap-1.5">
              <Toggle pressed={state.overdue} onClick={() => set("overdue", !state.overdue)} className="h-7 rounded-full px-2.5 text-xs">Vencidas</Toggle>
              <Toggle pressed={state.blocked} onClick={() => set("blocked", !state.blocked)} className="h-7 rounded-full px-2.5 text-xs">Bloqueadas</Toggle>
            </div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <CheckGroup legend="Responsable" options={[...peopleOptions.slice(0, 1), { value: NONE, label: "Sin responsable" }, ...peopleOptions.slice(1)]} selected={state.owner} onChange={(v) => set("owner", v)} />
            <CheckGroup legend="Seguidor" options={peopleOptions} selected={state.follower} onChange={(v) => set("follower", v)} />
          </div>
          <CheckGroup legend="Proyecto" options={[{ value: NONE, label: "Sin proyecto" }, ...projects.map((p) => ({ value: p.key, label: p.name }))]} selected={state.project} onChange={(v) => set("project", v)} />

          {showGroup && (
            <label className="flex items-center justify-between gap-3 text-[13px]">
              <span className="text-xs font-medium text-muted-foreground">Agrupar</span>
              <select
                value={state.group}
                onChange={(e) => set("group", e.target.value as GroupBy)}
                aria-label="Agrupar tareas"
                className="h-8 rounded-lg border border-input bg-background px-2 text-[13px] text-foreground"
              >
                <option value="none">Sin agrupar</option>
                <option value="project">Por proyecto</option>
                <option value="status">Por estado</option>
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
