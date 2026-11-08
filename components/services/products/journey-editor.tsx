// @plantilla-quitar(servicios)
"use client";

import { useRef, useState, useTransition, type DragEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, GripVertical, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { saveJourneyTemplate } from "@/lib/actions/services";
import { ITEM_KINDS, ITEM_KIND_LABELS, type ItemKind } from "@/lib/services/availability";
import { FUTURE_VISIBILITY, type JourneyItem, type JourneyPhase, type JourneyTemplate } from "@/lib/services/journey-template";
import {
  addItem,
  addPhase,
  itemLightAvailable,
  itemLightForm,
  itemsBefore,
  journeyEditorIssues,
  moveItem,
  movePhase,
  nudgeItem,
  nudgePhase,
  removeItem,
  removePhase,
  toItemLight,
  updateItem,
  updatePhase,
} from "@/lib/services/screens/journey-editor";
import { ActionError } from "@/components/contacts/ui";
import { InfoTooltip } from "@/components/ui/tooltip";
import { SidePanel } from "@/components/tasks/overlay";
import type { NamedOption } from "./service-settings-panel";
import { groupBySlot, type PathWorkflow } from "@/lib/services/screens/workflow-chips";
import { WorkflowSlot } from "./workflow-slot";

const input = "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:border-primary-edge focus:outline-none focus:ring-1 focus:ring-primary-edge";
const label = "mb-1.5 flex items-center gap-1 text-xs font-semibold text-foreground";
const iconBtn = "rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40";

const HELP = {
  duration: "Cuántos días dura la fase. Se cuentan desde que empieza, sin los días de pausa.",
  yellow: "Desde qué día de la fase el servicio se pinta amarillo si la fase sigue abierta. Días de la fase, sin pausas.",
  red: "Desde qué día de la fase el servicio se pinta rojo si la fase sigue abierta. Tiene que ser después del amarillo.",
  advance: "Manual: la pasa una persona. Sola con los obligatorios: avanza cuando se completan los pasos obligatorios. Sola con todos: cuando se completan todos.",
  challenge: "La fase se ve como «Reto» en el portal del cliente y puede empezar cuando la arranca el cliente, una automatización o una fecha fija.",
  light: "0 = el mismo día que vence. Sin regla, un paso vencido no cambia el color.",
};

const FUTURE_LABELS: Record<(typeof FUTURE_VISIBILITY)[number], string> = {
  names: "Solo los nombres",
  names_and_descriptions: "Los nombres y las descripciones",
  hidden: "Nada",
};

export interface JourneyRefs {
  forms: Array<NamedOption & { type: string }>;
  eventTypes: NamedOption[];
  /** Plantillas del Diseñador IA de tipo Certificado (F66). */
  certificates?: NamedOption[];
}

type DragData = { kind: "phase"; key: string } | { kind: "item"; key: string };

/**
 * La pestaña «Camino del cliente» de la variante (F32). Fases y pasos que se arrastran (HTML5) o se mueven con
 * Subir/Bajar y Alt+↑/↓; el drawer del paso; los problemas se ven antes de guardar con los mismos textos que da la
 * base. Guardar manda la plantilla entera con su `rev`.
 */
export function JourneyEditor({
  variantId,
  template: initial,
  rev,
  refs,
  members,
  workflows = [],
  canEditFlows = false,
}: {
  variantId: string;
  template: JourneyTemplate | null;
  rev: number;
  refs: JourneyRefs;
  members: NamedOption[];
  workflows?: PathWorkflow[];
  canEditFlows?: boolean;
}) {
  const slots = groupBySlot(workflows);
  const router = useRouter();
  const [t, setT] = useState<JourneyTemplate>(() => initial ?? { v: 1, phases: [] });
  const [dirty, setDirty] = useState(false);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const drag = useRef<DragData | null>(null);
  const issues = journeyEditorIssues(t);

  const change = (next: JourneyTemplate) => {
    setT(next);
    setDirty(true);
    setNotice(null);
  };

  function save() {
    setError(null);
    start(async () => {
      const res = await saveJourneyTemplate(variantId, t, rev);
      if (!res.ok) return setError(res.error.message);
      if (res.data.status === "conflict") return setError("Alguien cambió el camino mientras lo editabas. Recargá la página para ver lo último.");
      if (res.data.status === "invalid") return setError((res.data.problems ?? []).join(" · "));
      setDirty(false);
      const paused = (res.data as { pausedWorkflows?: number }).pausedWorkflows ?? 0;
      setNotice(paused > 0 ? `Guardado. Se pausaron ${paused} workflow(s) de pasos o fases que ya no están en el camino.` : "Guardado. Vale para los servicios nuevos.");
      router.refresh();
    });
  }

  const onPhaseKey = (e: KeyboardEvent, key: string) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    change(nudgePhase(t, key, e.key === "ArrowUp" ? -1 : 1));
  };
  const onItemKey = (e: KeyboardEvent, key: string) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    e.stopPropagation();
    change(nudgeItem(t, key, e.key === "ArrowUp" ? -1 : 1));
  };
  const dropOnPhase = (e: DragEvent, phaseKey: string, index: number) => {
    e.preventDefault();
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === "item") change(moveItem(t, d.key, phaseKey, index));
    else change(movePhase(t, d.key, t.phases.findIndex((p) => p.key === phaseKey)));
  };

  const item = openItem ? t.phases.flatMap((p) => p.items).find((i) => i.key === openItem) ?? null : null;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Los cambios valen para los servicios nuevos; los que ya existen guardan su copia.</p>
      {t.phases.length === 0 && <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Esta variante todavía no tiene camino. Sumá la primera fase.</p>}

      <div className="rounded-xl border border-dashed border-border p-3">
        <WorkflowSlot variantId={variantId} slot="start" title="Cuando empieza el servicio" workflows={slots.get("start") ?? []} canEdit={canEditFlows} />
      </div>

      <ol className="space-y-3">
        {t.phases.map((ph, pi) => (
          <li
            key={ph.key}
            tabIndex={0}
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            onKeyDown={(e) => onPhaseKey(e, ph.key)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => dropOnPhase(e, ph.key, ph.items.length)}
            className="rounded-xl border border-border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-edge"
          >
            <PhaseHeader
              phase={ph}
              index={pi}
              total={t.phases.length}
              onChange={(patch) => change(updatePhase(t, ph.key, patch))}
              onMove={(d) => change(nudgePhase(t, ph.key, d))}
              onRemove={() => {
                const r = removePhase(t, ph.key);
                change(r.template);
                if (r.clearedDue.length) setNotice(`Se quitó el plazo de: ${r.clearedDue.join(", ")} (dependía de un paso borrado).`);
              }}
              onDragStart={() => (drag.current = { kind: "phase", key: ph.key })}
            />
            <div className="grid gap-2 border-b border-border px-3 py-2 sm:grid-cols-2">
              <WorkflowSlot variantId={variantId} slot={`phase_start:${ph.key}`} title="Al empezar la fase" workflows={slots.get(`phase_start:${ph.key}`) ?? []} canEdit={canEditFlows} />
              <WorkflowSlot variantId={variantId} slot={`phase_end:${ph.key}`} title="Al terminar la fase" workflows={slots.get(`phase_end:${ph.key}`) ?? []} canEdit={canEditFlows} />
            </div>
            <ul className="space-y-1 px-3 pb-3">
              {ph.items.map((it, ii) => (
                <li
                  key={it.key}
                  tabIndex={0}
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                  onKeyDown={(e) => onItemKey(e, it.key)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.stopPropagation();
                    dropOnPhase(e, ph.key, ii);
                  }}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-edge"
                >
                  <span draggable onDragStart={() => (drag.current = { kind: "item", key: it.key })} className="cursor-grab text-muted-foreground" aria-hidden>
                    <GripVertical className="h-4 w-4" />
                  </span>
                  <button type="button" onClick={() => setOpenItem(it.key)} className="min-w-0 flex-1 truncate text-left hover:underline">
                    {it.name}
                  </button>
                  <span className="shrink-0 text-xs text-muted-foreground">{ITEM_KIND_LABELS[it.kind] ?? it.kind}</span>
                  <button type="button" className={iconBtn} aria-label={`Subir «${it.name}»`} onClick={() => change(nudgeItem(t, it.key, -1))}>
                    <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button type="button" className={iconBtn} aria-label={`Bajar «${it.name}»`} onClick={() => change(nudgeItem(t, it.key, 1))}>
                    <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <div className="basis-full">
                    <WorkflowSlot variantId={variantId} slot={`item:${it.key}`} title={`Al completar «${it.name}»`} workflows={slots.get(`item:${it.key}`) ?? []} canEdit={canEditFlows} compact />
                  </div>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  onClick={() => {
                    const r = addItem(t, ph.key, "checkbox", "Nuevo paso");
                    change(r.template);
                    setOpenItem(r.key);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  Paso
                </button>
              </li>
            </ul>
          </li>
        ))}
      </ol>

      <div className="rounded-xl border border-dashed border-border p-3">
        <WorkflowSlot variantId={variantId} slot="ending" title="Antes de terminar el servicio" workflows={slots.get("ending") ?? []} canEdit={canEditFlows} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => change(addPhase(t, "Nueva fase").template)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent">
          <Plus className="h-4 w-4" aria-hidden />
          Fase
        </button>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Qué ve el cliente de las fases que vienen
          <select
            value={t.future_visibility ?? "names"}
            onChange={(e) => change({ ...t, future_visibility: e.target.value as JourneyTemplate["future_visibility"] })}
            className="h-8 rounded-lg border border-border bg-background px-2 text-xs text-foreground"
          >
            {FUTURE_VISIBILITY.map((f) => (
              <option key={f} value={f}>
                {FUTURE_LABELS[f]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {issues.length > 0 && (
        <ul role="alert" className="list-disc space-y-0.5 rounded-lg border border-border bg-muted/40 px-6 py-3 text-xs text-foreground">
          {issues.map((p, i) => (
            <li key={`${p}-${i}`}>{p}</li>
          ))}
        </ul>
      )}
      {notice && <p className="text-xs text-good">{notice}</p>}
      {error && <ActionError message={error} />}
      <button
        type="button"
        onClick={save}
        disabled={pending || !dirty || issues.length > 0}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
        Guardar el camino
      </button>

      {item && (
        <ItemDrawer
          item={item}
          before={itemsBefore(t, item.key)}
          refs={refs}
          members={members}
          onChange={(patch) => change(updateItem(t, item.key, patch))}
          onRemove={() => {
            const r = removeItem(t, item.key);
            change(r.template);
            setOpenItem(null);
            if (r.clearedDue.length) setNotice(`Se quitó el plazo de: ${r.clearedDue.join(", ")} (dependía del paso borrado).`);
          }}
          onClose={() => setOpenItem(null)}
        />
      )}
    </div>
  );
}

function numOrNull(v: string): number | null {
  const s = v.trim();
  return s === "" ? null : Number(s);
}

function PhaseHeader({
  phase,
  index,
  total,
  onChange,
  onMove,
  onRemove,
  onDragStart,
}: {
  phase: JourneyPhase;
  index: number;
  total: number;
  onChange: (patch: Partial<JourneyPhase>) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
  onDragStart: () => void;
}) {
  const challengeOn = !!(phase.challenge && (phase.challenge as { enabled?: boolean }).enabled);
  return (
    <div className="space-y-3 border-b border-border p-3">
      <div className="flex items-center gap-2">
        <span draggable onDragStart={onDragStart} className="cursor-grab text-muted-foreground" aria-hidden>
          <GripVertical className="h-4 w-4" />
        </span>
        <label className="sr-only" htmlFor={`ph-name-${phase.key}`}>
          Nombre de la fase
        </label>
        <input id={`ph-name-${phase.key}`} value={phase.name} onChange={(e) => onChange({ name: e.target.value })} className={`${input} font-medium`} />
        <button type="button" className={iconBtn} disabled={index === 0} aria-label={`Subir la fase «${phase.name}»`} onClick={() => onMove(-1)}>
          <ArrowUp className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" className={iconBtn} disabled={index === total - 1} aria-label={`Bajar la fase «${phase.name}»`} onClick={() => onMove(1)}>
          <ArrowDown className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" className={iconBtn} aria-label={`Borrar la fase «${phase.name}»`} onClick={onRemove}>
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <span className={label}>
            Duración (días) <InfoTooltip text={HELP.duration} />
          </span>
          <input aria-label="Duración en días" inputMode="numeric" value={phase.duration_days ?? ""} onChange={(e) => onChange({ duration_days: numOrNull(e.target.value) })} className={input} />
        </div>
        <div>
          <span className={label}>
            Amarillo desde el día <InfoTooltip text={HELP.yellow} />
          </span>
          <input aria-label="Amarillo desde el día" inputMode="numeric" value={phase.yellow_day ?? ""} onChange={(e) => onChange({ yellow_day: numOrNull(e.target.value) })} className={input} />
        </div>
        <div>
          <span className={label}>
            Rojo desde el día <InfoTooltip text={HELP.red} />
          </span>
          <input aria-label="Rojo desde el día" inputMode="numeric" value={phase.red_day ?? ""} onChange={(e) => onChange({ red_day: numOrNull(e.target.value) })} className={input} />
        </div>
        <div>
          <span className={label}>
            Avance <InfoTooltip text={HELP.advance} />
          </span>
          <select aria-label="Avance" value={phase.advance ?? "auto"} onChange={(e) => onChange({ advance: e.target.value as JourneyPhase["advance"] })} className={input}>
            <option value="manual">Manual</option>
            <option value="auto">Sola con los obligatorios</option>
            <option value="auto_all">Sola con todos</option>
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs text-foreground">
        <input
          type="checkbox"
          checked={challengeOn}
          onChange={(e) => onChange({ challenge: e.target.checked ? { enabled: true, start: "previous_phase" } : null })}
        />
        Mostrar esta fase como Reto en el portal <InfoTooltip text={HELP.challenge} />
      </label>
      {challengeOn && (
        <select
          aria-label="Cómo empieza el Reto"
          value={(phase.challenge as { start?: string }).start ?? "previous_phase"}
          onChange={(e) => onChange({ challenge: { ...(phase.challenge as object), enabled: true, start: e.target.value } })}
          className={`${input} sm:w-72`}
        >
          <option value="previous_phase">Al terminar la fase anterior</option>
          <option value="student">Cuando lo arranca el cliente</option>
          <option value="automation">Desde una automatización</option>
          <option value="fixed_date">En una fecha fija</option>
        </select>
      )}
    </div>
  );
}

function ItemDrawer({
  item,
  before,
  refs,
  members,
  onChange,
  onRemove,
  onClose,
}: {
  item: JourneyItem;
  before: JourneyItem[];
  refs: JourneyRefs;
  members: NamedOption[];
  onChange: (patch: Partial<JourneyItem>) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const ref = (item.ref ?? {}) as Record<string, unknown>;
  const setRef = (patch: Record<string, unknown>) => onChange({ ref: { ...ref, ...patch } });
  const formType = item.kind === "form" ? "custom" : item.kind;
  const forms = refs.forms.filter((f) => f.type === formType);
  const light = itemLightForm(item);
  const due = item.due_rule;

  return (
    <SidePanel
      label={`Paso «${item.name}»`}
      onClose={onClose}
      header={<p className="text-sm font-semibold">Paso del camino</p>}
      footer={
        <div className="flex justify-between gap-2">
          <button type="button" onClick={onRemove} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-destructive hover:bg-accent">
            <Trash2 className="h-4 w-4" aria-hidden />
            Borrar el paso
          </button>
          <button type="button" onClick={onClose} className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">
            Listo
          </button>
        </div>
      }
    >
      <div className="space-y-4 p-4">
        <div>
          <label htmlFor="it-kind" className={label}>
            Tipo
          </label>
          <select id="it-kind" value={item.kind} onChange={(e) => onChange({ kind: e.target.value as ItemKind, ref: {} })} className={input}>
            {ITEM_KINDS.map((k) => (
              <option key={k} value={k}>
                {ITEM_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="it-name" className={label}>
            Nombre
          </label>
          <input id="it-name" value={item.name} onChange={(e) => onChange({ name: e.target.value })} className={input} />
        </div>
        <div>
          <label htmlFor="it-desc" className={label}>
            Descripción
          </label>
          <textarea id="it-desc" rows={3} value={item.description ?? ""} onChange={(e) => onChange({ description: e.target.value || undefined })} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        </div>

        {["form", "survey", "contract", "activity", "quiz"].includes(item.kind) && (
          <div>
            <label htmlFor="it-form" className={label}>
              Formulario
            </label>
            <select id="it-form" value={(ref.form_id as string) ?? ""} onChange={(e) => setRef({ form_id: e.target.value || undefined })} className={input}>
              <option value="">Elegí…</option>
              {forms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            {forms.length === 0 && <p className="mt-1 text-[11px] text-muted-foreground">No hay formularios de este tipo todavía.</p>}
          </div>
        )}
        {item.kind === "booking" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="it-event" className={label}>
                Tipo de reunión
              </label>
              <select id="it-event" value={(ref.event_type_id as string) ?? ""} onChange={(e) => setRef({ event_type_id: e.target.value || undefined })} className={input}>
                <option value="">Elegí…</option>
                {refs.eventTypes.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="it-complete" className={label}>
                Se completa
              </label>
              <select id="it-complete" value={(ref.complete_on as string) ?? "booked"} onChange={(e) => setRef({ complete_on: e.target.value })} className={input}>
                <option value="booked">Al agendar</option>
                <option value="attended">Cuando asistió</option>
              </select>
            </div>
          </div>
        )}

        {item.kind === "certificate" && (
          <div className="space-y-2">
            <div>
              <label htmlFor="it-cert" className={label}>
                Plantilla del certificado
              </label>
              <select id="it-cert" value={(ref.template_id as string) ?? ""} onChange={(e) => setRef({ template_id: e.target.value || undefined })} className={input}>
                <option value="">Elegí…</option>
                {(refs.certificates ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Solo plantillas de tipo Certificado.{" "}
                <a href="/dashboard/disenos" target="_blank" rel="noopener noreferrer" className="text-primary-ink hover:underline">
                  + Crear con el Diseñador IA
                </a>
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={ref.auto_issue === true} onChange={(e) => setRef({ auto_issue: e.target.checked })} />
              Emitirlo solo al llegar a este paso
            </label>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="it-assignee" className={label}>
              A cargo
            </label>
            <select
              id="it-assignee"
              value={item.assignee ?? "student"}
              onChange={(e) => onChange({ assignee: e.target.value as JourneyItem["assignee"], assignee_user_id: e.target.value === "user" ? item.assignee_user_id ?? null : undefined })}
              className={input}
            >
              <option value="student">El cliente</option>
              <option value="owner">El responsable del servicio</option>
              <option value="user">Una persona</option>
            </select>
          </div>
          {item.assignee === "user" && (
            <div>
              <label htmlFor="it-user" className={label}>
                Persona
              </label>
              <select id="it-user" value={item.assignee_user_id ?? ""} onChange={(e) => onChange({ assignee_user_id: e.target.value || null })} className={input}>
                <option value="">Elegí…</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <fieldset className="space-y-2">
          <legend className={label}>Plazo</legend>
          <div className="grid gap-2 sm:grid-cols-[6rem_1fr]">
            <input
              aria-label="Días del plazo"
              inputMode="numeric"
              placeholder="Sin plazo"
              value={due?.days ?? ""}
              onChange={(e) => {
                const n = numOrNull(e.target.value);
                onChange({ due_rule: n === null ? null : { from: due?.from ?? "phase_start", item_key: due?.item_key ?? null, days: n } });
              }}
              className={input}
            />
            <select
              aria-label="Desde cuándo cuenta el plazo"
              value={due?.from === "item_completed" ? `item:${due.item_key}` : due?.from ?? "phase_start"}
              disabled={!due}
              onChange={(e) => {
                const v = e.target.value;
                const days = due?.days ?? 0;
                onChange({ due_rule: v.startsWith("item:") ? { from: "item_completed", item_key: v.slice(5), days } : { from: v as "phase_start", item_key: null, days } });
              }}
              className={input}
            >
              <option value="phase_start">días desde que empieza la fase</option>
              <option value="service_start">días desde que empieza el servicio</option>
              <option value="service_created">días desde que se creó el servicio</option>
              {before.map((b) => (
                <option key={b.key} value={`item:${b.key}`}>
                  días después de completar «{b.name}»
                </option>
              ))}
            </select>
          </div>
        </fieldset>

        {itemLightAvailable(item) && (
          <fieldset className="space-y-2">
            <legend className={label}>
              Semáforo si se vence <InfoTooltip text={HELP.light} />
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <input aria-label="Amarillo: días después del vencimiento" placeholder="Amarillo: N días" inputMode="numeric" value={light.yellow} onChange={(e) => onChange({ light: toItemLight({ ...light, yellow: e.target.value }) })} className={input} />
              <input aria-label="Rojo: días después del vencimiento" placeholder="Rojo: M días" inputMode="numeric" value={light.red} onChange={(e) => onChange({ light: toItemLight({ ...light, red: e.target.value }) })} className={input} />
            </div>
          </fieldset>
        )}

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={item.required !== false} onChange={(e) => onChange({ required: e.target.checked })} />
            Obligatorio
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={item.visible_to_client !== false} onChange={(e) => onChange({ visible_to_client: e.target.checked })} />
            Lo ve el cliente
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={item.portal_button === true} onChange={(e) => onChange({ portal_button: e.target.checked })} />
            Mostrar el botón en el portal
          </label>
        </div>
      </div>
    </SidePanel>
  );
}
