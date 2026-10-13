"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ListFilter, Search, X } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import type { ProjectSummary } from "@/lib/tasks/project";
import type { MemberLite } from "@/lib/tasks/table-model";
import { PRIORITY_LABELS, STATUS_LABELS, TASK_PRIORITIES, TASK_SOURCES, TASK_STATUSES } from "@/lib/tasks/types";
import { clearFilters, countActiveFilters, ME, NONE, type GroupBy, type TasksViewState } from "@/lib/tasks/view-state";
import { cn } from "@/lib/utils";

const SOURCE_LABELS: Record<(typeof TASK_SOURCES)[number], string> = { manual: "Manual", flow: "Flujo", agent: "Agente", cx: "CX" };

interface Option {
  value: string;
  label: string;
}

/** Un filtro de varias opciones: un boton con lo elegido y un panel de casillas que no se cierra al tildar. */
function MultiFilter({ label, options, selected, onChange, width = "w-64" }: { label: string; options: Option[]; selected: string[]; onChange: (next: string[]) => void; width?: string }) {
  const active = selected.length > 0;
  const summary = !active ? "Todos" : selected.length === 1 ? (options.find((o) => o.value === selected[0])?.label ?? "1") : `${selected.length}`;
  return (
    <Popover
      label={`Filtrar por ${label.toLowerCase()}`}
      align="start"
      panelClassName={cn("max-h-80 overflow-auto", width)}
      triggerClassName={cn(
        "flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-[13px] font-medium transition-colors",
        active ? "border-primary bg-primary/10" : "border-input bg-background hover:border-muted-foreground/60",
      )}
      trigger={
        <>
          <span className="font-normal text-muted-foreground">{label}:</span>
          <span className="max-w-[9rem] truncate">{summary}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        </>
      }
    >
      <fieldset>
        <legend className="sr-only">{label}</legend>
        {options.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent">
            <input
              type="checkbox"
              checked={selected.includes(o.value)}
              onChange={() => onChange(selected.includes(o.value) ? selected.filter((v) => v !== o.value) : [...selected, o.value])}
            />
            <span className="truncate">{o.label}</span>
          </label>
        ))}
        {options.length === 0 && <p className="px-2 py-1 text-sm text-muted-foreground">Todavía no hay opciones.</p>}
      </fieldset>
      {active && (
        <button type="button" onClick={() => onChange([])} className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent">
          Quitar este filtro
        </button>
      )}
    </Popover>
  );
}

function Toggle({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn("h-8 whitespace-nowrap rounded-lg border px-2.5 text-[13px] font-medium transition-colors", pressed ? "border-primary bg-primary/10" : "border-input bg-background hover:border-muted-foreground/60")}
    >
      {children}
    </button>
  );
}

export function FiltersBar({
  state,
  onChange,
  members,
  projects,
  showGroup = true,
  total,
  shown,
}: {
  state: TasksViewState;
  onChange: (next: TasksViewState) => void;
  members: MemberLite[];
  projects: ProjectSummary[];
  showGroup?: boolean;
  total: number;
  shown: number;
}) {
  const active = countActiveFilters(state);
  // En el celular los filtros se esconden detras de un boton; en la computadora siempre estan a la vista.
  const [expanded, setExpanded] = useState(false);

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
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2" role="search">
        <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
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
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="tasks-filters"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 text-[13px] font-medium md:hidden"
        >
          <ListFilter className="h-3.5 w-3.5" aria-hidden /> Filtros
          {active > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">{active}</span>}
        </button>
        <div id="tasks-filters" className={cn("w-full flex-wrap items-center gap-2 md:flex md:w-auto", expanded ? "flex" : "hidden")}>
        <MultiFilter label="Estado" options={TASK_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))} selected={state.status} onChange={(v) => set("status", v as TasksViewState["status"])} />
        <MultiFilter label="Responsable" options={[...peopleOptions.slice(0, 1), { value: NONE, label: "Sin responsable" }, ...peopleOptions.slice(1)]} selected={state.owner} onChange={(v) => set("owner", v)} />
        <MultiFilter label="Seguidor" options={peopleOptions} selected={state.follower} onChange={(v) => set("follower", v)} />
        <MultiFilter label="Proyecto" options={[{ value: NONE, label: "Sin proyecto" }, ...projects.map((p) => ({ value: p.key, label: p.name }))]} selected={state.project} onChange={(v) => set("project", v)} />
        <MultiFilter label="Prioridad" options={TASK_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} selected={state.priority} onChange={(v) => set("priority", v as TasksViewState["priority"])} width="w-52" />
        <MultiFilter label="Origen" options={TASK_SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] }))} selected={state.source} onChange={(v) => set("source", v as TasksViewState["source"])} width="w-48" />
        <Toggle pressed={state.overdue} onClick={() => set("overdue", !state.overdue)}>Vencidas</Toggle>
        <Toggle pressed={state.blocked} onClick={() => set("blocked", !state.blocked)}>Bloqueadas</Toggle>
        {showGroup && (
          <label className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            Agrupar
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
        {active > 0 && (
          <button type="button" onClick={() => onChange(clearFilters(state))} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" aria-hidden /> Limpiar ({active})
          </button>
        )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {active > 0 ? `${shown} de ${total} tareas` : total === 1 ? "1 tarea" : `${total} tareas`}
      </p>
    </div>
  );
}
