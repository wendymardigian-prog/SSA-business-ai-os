"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Check, Plus, Search } from "lucide-react";
import { Avatar } from "@/components/ui/filter-menu";
import { foldText } from "@/lib/tasks/text";
import { colorOf, initialsOf } from "@/lib/shared/people";
import { shouldOfferCreate, type ProjectSummary } from "@/lib/tasks/project";
import { PRIORITY_LABELS, STATUS_LABELS, TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus } from "@/lib/tasks/types";
import type { MemberLite } from "@/lib/tasks/table-model";
import { cn } from "@/lib/utils";
import { FloatingPanel } from "@/components/shared/floating";
import { PriorityChip, StatusChip } from "./chips";

/**
 * Los selectores de las celdas y del drawer: estado, prioridad, persona, personas (seguidores) y proyecto.
 * Cada uno es un panel flotante anclado a su celda. Teclado: flechas para recorrer, Enter elige, Esc cancela.
 */

type Close = (reason: "escape" | "outside") => void;

function Row({ active, selected, onPick, children, id }: { active: boolean; selected: boolean; onPick: () => void; children: ReactNode; id: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <button
      ref={ref}
      id={id}
      type="button"
      role="option"
      aria-selected={selected}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent", active && "bg-accent")}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      {selected && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
    </button>
  );
}

/** Recorrer una lista con el teclado sin sacar el foco del campo de busqueda. */
function useListKeys(count: number, onPick: (index: number) => void) {
  const [active, setActive] = useState(0);
  // Si la lista se achica (se escribio en el buscador), el indice no se pasa del final.
  const safe = Math.min(active, Math.max(0, count - 1));
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(Math.min(count - 1, safe + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(Math.max(0, safe - 1));
    } else if (event.key === "Enter" && count > 0) {
      event.preventDefault();
      onPick(safe);
    }
  };
  return { active: safe, setActive, onKeyDown };
}

function SearchBox({ value, onChange, placeholder, onKeyDown, listId, activeId }: { value: string; onChange: (v: string) => void; placeholder: string; onKeyDown: (e: React.KeyboardEvent) => void; listId: string; activeId?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="relative mb-1">
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-activedescendant={activeId}
        className="h-8 w-full rounded-lg border border-input bg-background pl-7 pr-2 text-sm outline-none focus:border-primary"
      />
    </div>
  );
}

// ── Estado y prioridad ──────────────────────────────────────────────────────

function EnumPicker<T extends string>({
  anchor, label, values, current, onPick, onClose, render,
}: {
  anchor: RefObject<HTMLElement | null>;
  label: string;
  values: readonly T[];
  current: T;
  onPick: (v: T) => void;
  onClose: Close;
  render: (v: T) => ReactNode;
}) {
  const { active, onKeyDown } = useListKeys(values.length, (i) => onPick(values[i]));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <FloatingPanel anchor={anchor} onClose={onClose} label={label} width={200}>
      <div ref={ref} tabIndex={-1} role="listbox" aria-label={label} onKeyDown={onKeyDown} className="outline-none">
        {values.map((v, i) => (
          <Row key={v} id={`${label}-${v}`} active={i === active} selected={v === current} onPick={() => onPick(v)}>
            {render(v)}
          </Row>
        ))}
      </div>
    </FloatingPanel>
  );
}

export function StatusPicker(props: { anchor: RefObject<HTMLElement | null>; current: TaskStatus; onPick: (s: TaskStatus) => void; onClose: Close }) {
  return <EnumPicker {...props} label="Estado" values={TASK_STATUSES} render={(s) => <StatusChip status={s} />} />;
}

export function PriorityPicker(props: { anchor: RefObject<HTMLElement | null>; current: TaskPriority; onPick: (p: TaskPriority) => void; onClose: Close }) {
  return <EnumPicker {...props} label="Prioridad" values={TASK_PRIORITIES} render={(p) => <PriorityChip priority={p} />} />;
}

export { PRIORITY_LABELS, STATUS_LABELS };

// ── Personas ────────────────────────────────────────────────────────────────

function filterMembers(members: readonly MemberLite[], query: string): MemberLite[] {
  const q = foldText(query.trim());
  return q ? members.filter((m) => foldText(m.name).includes(q)) : [...members];
}

function Person({ m }: { m: MemberLite }) {
  return (
    <>
      <Avatar initials={initialsOf(m.name)} color={colorOf(m.id)} />
      <span className="truncate">{m.name}</span>
    </>
  );
}

/** Una persona (el responsable). `null` = sin responsable. */
export function MemberPicker({
  anchor, members, current, onPick, onClose, noneLabel = "Sin responsable", label = "Responsable",
}: {
  anchor: RefObject<HTMLElement | null>;
  members: readonly MemberLite[];
  current: string | null;
  onPick: (id: string | null) => void;
  onClose: Close;
  noneLabel?: string | null;
  label?: string;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => filterMembers(members, query), [members, query]);
  const options: Array<MemberLite | null> = useMemo(() => (noneLabel && !query.trim() ? [null, ...shown] : shown), [noneLabel, query, shown]);
  const { active, onKeyDown } = useListKeys(options.length, (i) => onPick(options[i]?.id ?? null));
  const listId = `${label}-lista`;
  return (
    <FloatingPanel anchor={anchor} onClose={onClose} label={label} width={260}>
      <SearchBox value={query} onChange={setQuery} placeholder="Buscar persona" onKeyDown={onKeyDown} listId={listId} activeId={`${label}-${active}`} />
      <div id={listId} role="listbox" aria-label={label}>
        {options.map((m, i) => (
          <Row key={m?.id ?? "none"} id={`${label}-${i}`} active={i === active} selected={(m?.id ?? null) === current} onPick={() => onPick(m?.id ?? null)}>
            {m ? <Person m={m} /> : <span className="text-muted-foreground">{noneLabel}</span>}
          </Row>
        ))}
        {options.length === 0 && <p className="px-2 py-2 text-sm text-muted-foreground">No hay nadie con ese nombre.</p>}
      </div>
    </FloatingPanel>
  );
}

/** Varias personas (los seguidores). Se confirma con «Listo», con Enter fuera de la lista o al hacer clic afuera. */
export function MembersMultiPicker({
  anchor, members, selected, excludeId, max, onCommit, onClose,
}: {
  anchor: RefObject<HTMLElement | null>;
  members: readonly MemberLite[];
  selected: readonly string[];
  /** El responsable no se puede elegir como seguidor. */
  excludeId?: string | null;
  max: number;
  onCommit: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<string[]>([...selected]);
  const pool = useMemo(() => members.filter((m) => m.id !== excludeId), [members, excludeId]);
  const shown = useMemo(() => filterMembers(pool, query), [pool, query]);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  });
  const toggle = (id: string) => setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : d.length >= max ? d : [...d, id]));
  const { active, onKeyDown } = useListKeys(shown.length, (i) => toggle(shown[i].id));
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const finish = (reason: "done" | "escape" | "outside") => {
    if (reason !== "escape" && !same(draftRef.current, selected)) onCommit(draftRef.current);
    onClose();
  };
  return (
    <FloatingPanel anchor={anchor} onClose={(r) => finish(r)} label="Seguidores" width={270}>
      <SearchBox value={query} onChange={setQuery} placeholder="Buscar persona" onKeyDown={onKeyDown} listId="seguidores-lista" activeId={`seguidor-${active}`} />
      <div id="seguidores-lista" role="listbox" aria-multiselectable aria-label="Seguidores">
        {shown.map((m, i) => (
          <Row key={m.id} id={`seguidor-${i}`} active={i === active} selected={draft.includes(m.id)} onPick={() => toggle(m.id)}>
            <Person m={m} />
          </Row>
        ))}
        {shown.length === 0 && <p className="px-2 py-2 text-sm text-muted-foreground">No hay nadie con ese nombre.</p>}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 border-t border-border px-1 pt-1.5">
        <span className="text-xs text-muted-foreground">{draft.length} de {max}</span>
        <button type="button" onClick={() => finish("done")} className="h-7 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90">
          Listo
        </button>
      </div>
    </FloatingPanel>
  );
}

// ── Proyecto ────────────────────────────────────────────────────────────────

/**
 * El proyecto es un texto: se elige uno que ya existe o se escribe uno nuevo. Escribir «lanzamiento  q4»
 * reutiliza «Lanzamiento Q4» (misma clave normalizada); «Crear «…»» aparece solo si la clave no existe.
 */
export function ProjectPicker({
  anchor, projects, current, onPick, onClose,
}: {
  anchor: RefObject<HTMLElement | null>;
  projects: readonly ProjectSummary[];
  /** La clave del proyecto actual (o null). */
  current: string | null;
  /** El texto del proyecto a guardar, o null para quitarlo. */
  onPick: (project: string | null) => void;
  onClose: Close;
}) {
  const [query, setQuery] = useState("");
  const q = foldText(query.trim());
  const matches = useMemo(() => (q ? projects.filter((p) => foldText(p.name).includes(q)) : [...projects]), [projects, q]);
  const offerCreate = shouldOfferCreate(query, projects);
  type Option = { kind: "none" } | { kind: "project"; project: ProjectSummary } | { kind: "create"; text: string };
  const options: Option[] = useMemo(() => {
    const list: Option[] = [];
    if (!q) list.push({ kind: "none" });
    for (const p of matches) list.push({ kind: "project", project: p });
    if (offerCreate) list.push({ kind: "create", text: query.replace(/\s+/g, " ").trim() });
    return list;
  }, [q, matches, offerCreate, query]);

  const pick = (o: Option) => onPick(o.kind === "none" ? null : o.kind === "project" ? o.project.name : o.text);
  const { active, onKeyDown } = useListKeys(options.length, (i) => pick(options[i]));

  return (
    <FloatingPanel anchor={anchor} onClose={onClose} label="Proyecto" width={280}>
      <SearchBox value={query} onChange={setQuery} placeholder="Buscar o escribir un proyecto" onKeyDown={onKeyDown} listId="proyecto-lista" activeId={`proyecto-${active}`} />
      <div id="proyecto-lista" role="listbox" aria-label="Proyecto">
        {options.map((o, i) => (
          <Row
            key={o.kind === "project" ? o.project.key : o.kind}
            id={`proyecto-${i}`}
            active={i === active}
            selected={o.kind === "project" ? o.project.key === current : o.kind === "none" ? current === null : false}
            onPick={() => pick(o)}
          >
            {o.kind === "none" && <span className="text-muted-foreground">Sin proyecto</span>}
            {o.kind === "project" && (
              <>
                <span className="truncate">{o.project.name}</span>
                <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">{o.project.openCount}</span>
              </>
            )}
            {o.kind === "create" && (
              <>
                <Plus className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                <span className="truncate">Crear «{o.text}»</span>
              </>
            )}
          </Row>
        ))}
        {options.length === 0 && <p className="px-2 py-2 text-sm text-muted-foreground">Escribí el nombre del proyecto.</p>}
      </div>
    </FloatingPanel>
  );
}
