"use client";

import { useEffect, useState, useMemo } from "react";
import { useActiveWorkspaceId } from "@/components/dashboard-chrome";
import { createClient } from "@/lib/supabase/client";
import { STATUS_ROLES, STATUS_ROLE_LABELS, isStatusRole, parseStatusSettings, statusName, type ContactStatusSettings, type StatusRole } from "@/lib/contacts/statuses";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TriggerType } from "@/lib/types/database";
import { BASE_CALL_TYPES } from "@/lib/calls/classification"; // @plantilla-quitar(llamadas)
import { OUTCOME_CATEGORIES } from "@/lib/calls/rubric"; // @plantilla-quitar(llamadas)
import { FormTriggerPanel } from "./FormTriggerPanel"; // @plantilla-quitar(formularios)
import { WebhookTriggerPanel } from "./WebhookTriggerPanel"; // @plantilla-quitar(webhooks)
import { TaskTriggerPanel } from "./TaskTriggerPanel"; // @plantilla-quitar(tareas)
import { SalesTriggerPanel } from "./SalesTriggerPanel"; // @plantilla-quitar(ventas)
import { chosenType, triggerDisplayLabel, triggerEntry } from "@/lib/flow-engine/trigger-catalog";

interface Keyword {
  value: string;
  matchType: "exact" | "contains" | "startsWith";
}

interface TriggerPanelData {
  triggerType?: string;
  keywords?: Keyword[];
  payload?: string;
  alsoMatchInDms?: boolean;
  /** F6: acota el trigger de palabra clave a las respuestas a historias. */
  storyReply?: boolean;
  /** Solo si el mensaje vino de un anuncio (Extra L, F19). */
  fromAdOnly?: boolean;
  /** Solo si alguien menciono la cuenta en su historia (Extra L, F19). */
  storyMentionOnly?: boolean;
  /** F4: que evento del CRM se espera, y con que valor. */
  event?: string;
  value?: string;
  /** F5: ventana de inactividad. */
  amount?: number;
  unit?: "hours" | "days";
  /** Fase 3: el flow no arranca en conversaciones que atiende el agente de IA. */
  onlyIfAgentOff?: boolean;
  [key: string]: unknown;
}

/** Triggers de mensaje directo: son los que compiten con el agente de IA. */
const MESSAGE_TRIGGER_TYPES = ["keyword", "postback", "quick_reply", "welcome", "default"];

interface TriggerPanelProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
  /** El flujo que se edita (el «Solo si…» de un webhook le pide al servidor los campos comparables). */
  flowId?: string;
  /** El flujo tiene un paso que le manda algo a la persona (el webhook sugiere «una sola vez por contacto»). */
  sendsMessages?: boolean;
  /** Abre el selector de disparador ("Cambiar disparador"). */
  onChangeTrigger?: () => void;
}


/** Los nueve de agenda, para mostrar sus filtros. */
const BOOKING_TRIGGERS = [
  "booking_created",
  "booking_rescheduled",
  "booking_cancelled",
  "booking_updated",
  "booking_ended",
  "booking_status_changed",
  "booking_before_start",
  "booking_after_end",
  "booking_after_created",
];

// @plantilla-desde(ventas)
/** Los seis de Ventas: se ofrecen como atajos aparte y llevan su propio panel de filtros. */
const SALES_TRIGGERS = ["sale_created", "sale_status_changed", "payment_created", "payment_status_changed", "payment_before_due", "payment_after_due"];
// @plantilla-hasta(ventas)

// @plantilla-desde(llamadas)
/** Los dos de Llamadas, para mostrar sus filtros. */
const CALL_TRIGGERS = ["call_analyzed", "call_linked"];
// @plantilla-hasta(llamadas)

// @plantilla-desde(formularios)
/** Los tres de Formularios, para mostrar sus filtros. */
const FORM_TRIGGERS = ["form_submitted", "survey_answered", "contract_signed"];
// @plantilla-hasta(formularios)

// @plantilla-desde(llamadas)
const QUALIFICATIONS = [
  { value: "calificado", label: "Calificado" },
  { value: "con_reservas", label: "Con reservas" },
  { value: "no_calificado", label: "No calificado" },
];
// @plantilla-hasta(llamadas)

const RELATIVE_TRIGGERS = ["booking_before_start", "booking_after_end", "booking_after_created"];

/** Cuanto antes o cuanto despues (F44). */
const OFFSETS = [
  { minutes: 15, label: "15 minutos" },
  { minutes: 30, label: "30 minutos" },
  { minutes: 60, label: "1 hora" },
  { minutes: 120, label: "2 horas" },
  { minutes: 240, label: "4 horas" },
  { minutes: 1440, label: "1 día" },
  { minutes: 2880, label: "2 días" },
  { minutes: 10080, label: "1 semana" },
];

const ORIGINS = [
  { value: "public_page", label: "Link público" },
  { value: "embed", label: "Embed" },
  { value: "manual", label: "A mano" },
  { value: "agent", label: "Agente de IA" },
  { value: "api", label: "API" },
];

const BY_WHOM = [
  { value: "invitee", label: "El invitado" },
  { value: "host", label: "El equipo" },
  { value: "system", label: "El sistema" },
];

/** Los eventos del CRM que pueden disparar un flow (F4). */
const CRM_EVENTS: Array<{ value: string; label: string; valueLabel: string; valuePlaceholder: string }> = [
  { value: "tag_added", label: "Se agregó una etiqueta", valueLabel: "Solo esta etiqueta", valuePlaceholder: "interesado" },
  { value: "tag_removed", label: "Se quitó una etiqueta", valueLabel: "Solo esta etiqueta", valuePlaceholder: "interesado" },
  { value: "field_changed", label: "Cambió un campo personalizado", valueLabel: "Solo este campo", valuePlaceholder: "presupuesto" },
  { value: "assignment_changed", label: "Se asignó setter o vendedor", valueLabel: "Solo este rol", valuePlaceholder: "vendedor" },
  { value: "do_not_contact", label: 'Se marcó "no contactar"', valueLabel: "Solo por este motivo", valuePlaceholder: "" },
  // Pipeline (00245): el valor lo arma su propio selector (rol, o rol:estado).
  { value: "status_changed", label: "Cambió el estado del contacto", valueLabel: "Qué estado", valuePlaceholder: "" },
];

const matchTypes: Array<{ value: "exact" | "contains" | "startsWith"; label: string }> = [
  { value: "exact", label: "Exacta" },
  { value: "contains", label: "Contiene" },
  { value: "startsWith", label: "Empieza con" },
];

export function TriggerPanel({ data: rawData, onChange, flowId, sendsMessages, onChangeTrigger }: TriggerPanelProps) {
  const data = rawData as TriggerPanelData;
  // `null` = todavia no se eligio (asi nace una automatizacion). Un nodo viejo sin la clave es palabra clave.
  const triggerType = chosenType(data) ?? "";
  const entry = triggerEntry(triggerType);
  // Con `data.keywords || []` el array es nuevo en cada render, asi que los
  // useCallback que dependen de el se rehacian siempre (tres warnings del
  // linter). El useMemo lo estabiliza mientras la lista no cambie.
  const keywords = useMemo(() => data.keywords ?? [], [data.keywords]);
  const [newKeyword, setNewKeyword] = useState("");
  const [newMatchType, setNewMatchType] = useState<"exact" | "contains" | "startsWith">("contains");

  // Funciones comunes: el React Compiler ya las memoiza (con useCallback a mano el compilador se salteaba el panel).
  const addKeyword = () => {
    const trimmed = newKeyword.trim();
    if (!trimmed) return;
    const updated: Keyword[] = [...keywords, { value: trimmed, matchType: newMatchType }];
    onChange({ ...data, keywords: updated });
    setNewKeyword("");
  };

  const removeKeyword = (index: number) => {
    onChange({ ...data, keywords: keywords.filter((_, i) => i !== index) });
  };

  const updateKeywordMatchType = (index: number, matchType: "exact" | "contains" | "startsWith") => {
    onChange({ ...data, keywords: keywords.map((k, i) => (i === index ? { ...k, matchType } : k)) });
  };

  const showKeywords = triggerType === "keyword" || triggerType === "comment_keyword";
  const showPayload = triggerType === "postback" || triggerType === "quick_reply";
  const selectedEvent = CRM_EVENTS.find((e) => e.value === data.event) ?? CRM_EVENTS[0];

  return (
    <div className="space-y-5">
      {/* El disparador elegido. Se elige (y se cambia) en el selector, no en una lista larga dentro del panel. */}
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/20">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Disparador</p>
        <p className="mt-1 text-sm font-semibold text-foreground">{triggerDisplayLabel(data)}</p>
        {entry ? <p className="mt-0.5 text-xs text-muted-foreground">{entry.description}</p> : <p className="mt-0.5 text-xs text-muted-foreground">Todavía no elegiste cómo arranca esta automatización.</p>}
        {onChangeTrigger && (
          <button
            type="button"
            onClick={onChangeTrigger}
            className="mt-3 inline-flex items-center rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
          >
            {triggerType ? "Cambiar disparador" : "Elegir disparador"}
          </button>
        )}
      </div>

      {/* @plantilla-desde(ventas) */}
      {SALES_TRIGGERS.includes(triggerType) && <SalesTriggerPanel triggerType={triggerType} data={data} onChange={onChange} />}
      {/* @plantilla-hasta(ventas) */}

      {/* Keywords Section */}
      {showKeywords && (
        <div>
          <label className="mb-2 block text-xs font-semibold text-foreground">
            Palabras clave
          </label>

          {/* Existing keywords */}
          {keywords.length > 0 && (
            <div className="mb-3 space-y-2">
              {keywords.map((keyword, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 rounded-lg border border-border bg-card p-2"
                >
                  <span className="flex-1 truncate text-sm text-foreground">
                    {keyword.value}
                  </span>
                  <select
                    value={keyword.matchType}
                    onChange={(e) =>
                      updateKeywordMatchType(index, e.target.value as "exact" | "contains" | "startsWith")
                    }
                    className="rounded border border-border bg-muted px-2 py-1 text-xs text-foreground"
                  >
                    {matchTypes.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeKeyword(index)}
                    className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add new keyword */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addKeyword();
                }
              }}
              placeholder="Escribí una palabra o frase…"
              className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            <select
              value={newMatchType}
              onChange={(e) => setNewMatchType(e.target.value as "exact" | "contains" | "startsWith")}
              className="rounded-lg border border-border bg-card px-2 py-2 text-xs text-foreground focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              {matchTypes.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addKeyword}
              disabled={!newKeyword.trim()}
              className="rounded-lg bg-emerald-500 p-2 text-white transition-colors hover:bg-emerald-600 disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          {keywords.length === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Agregá las palabras que disparan esta automatización. Enter o + para sumar cada una. No importan las mayúsculas ni las tildes.
            </p>
          )}

          {/* Comment keywords only: publish also writes a `keyword` trigger row so
              the same flow answers people who DM the keyword instead of commenting. */}
          {triggerType === "comment_keyword" && (
            <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-card p-3">
              <input
                type="checkbox"
                checked={data.alsoMatchInDms === true}
                onChange={(e) => onChange({ ...data, alsoMatchInDms: e.target.checked })}
                disabled={keywords.length === 0}
                className="mt-0.5 h-4 w-4 rounded border-input text-emerald-500 focus:ring-emerald-500 disabled:opacity-40"
              />
              <div>
                <p className="text-sm font-medium text-foreground">También por mensaje directo</p>
                <p className="text-xs text-muted-foreground">
                  {keywords.length === 0
                    ? "Agregá al menos una palabra para usar esto."
                    : "La automatización también corre cuando alguien manda la palabra por mensaje directo, no solo en un comentario."}
                </p>
                {data.alsoMatchInDms === true && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Un mensaje directo no tiene un comentario detrás: la respuesta pública y las variables del comentario
                    ({"{{comment_text}}"}, {"{{post_id}}"}) quedan vacías en esa corrida.
                  </p>
                )}
              </div>
            </label>
          )}
        </div>
      )}

      {/* F6: filtro de respuesta a historia */}
      {triggerType === "keyword" && (
        <div className="rounded-lg border border-border bg-card p-3">
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={Boolean(data.storyReply)}
              onChange={(e) => onChange({ ...data, storyReply: e.target.checked })}
              className="mt-0.5 h-3.5 w-3.5 rounded border-input text-emerald-500 focus:ring-emerald-500"
            />
            <span>
              <span className="font-medium text-foreground">
                Solo respuestas a historias
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                La automatización corre únicamente cuando la palabra llega respondiendo una
                historia de Instagram. Un mensaje común con la misma palabra no la
                dispara.
              </span>
            </span>
          </label>
        </div>
      )}

      {/* Extra L (F19): origen del mensaje. Dos filtros mas, del mismo estilo que el de historias. */}
      {triggerType === "keyword" && (
        <div className="space-y-3 rounded-lg border border-border bg-card p-3">
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={Boolean(data.fromAdOnly)}
              onChange={(e) => onChange({ ...data, fromAdOnly: e.target.checked })}
              className="mt-0.5 h-3.5 w-3.5 rounded border-input text-emerald-500 focus:ring-emerald-500"
            />
            <span>
              <span className="font-medium text-foreground">Solo si vino de un anuncio</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Corre únicamente cuando el mensaje llega desde un anuncio (el primer mensaje después del clic). Dentro de la
                automatización podés usar {"{{message_origin.ad_title}}"} y {"{{message_origin.ad_id}}"}.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={Boolean(data.storyMentionOnly)}
              onChange={(e) => onChange({ ...data, storyMentionOnly: e.target.checked })}
              className="mt-0.5 h-3.5 w-3.5 rounded border-input text-emerald-500 focus:ring-emerald-500"
            />
            <span>
              <span className="font-medium text-foreground">Solo menciones en historias</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Corre únicamente cuando alguien menciona tu cuenta en SU historia de Instagram. Sin palabras clave cargadas, la mención sola alcanza.
              </span>
            </span>
          </label>
        </div>
      )}

      {/* F4: evento del CRM */}
      {triggerType === "crm_event" && (
        <div className="space-y-3">
          <div>
            <label className="mb-2 block text-xs font-semibold text-foreground">
              Qué tiene que pasar
            </label>
            <select
              value={data.event ?? CRM_EVENTS[0].value}
              onChange={(e) => onChange({ ...data, event: e.target.value, value: "" })}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              {CRM_EVENTS.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </select>
          </div>

          {data.event === "status_changed" ? (
            <StatusChangedPicker flowId={flowId} value={typeof data.value === "string" ? data.value : ""} onChange={(value) => onChange({ ...data, value })} />
          ) : (
          <div>
            <label className="mb-2 block text-xs font-semibold text-foreground">
              {selectedEvent.valueLabel}
            </label>
            <input
              type="text"
              value={data.value ?? ""}
              onChange={(e) => onChange({ ...data, value: e.target.value })}
              placeholder={selectedEvent.valuePlaceholder || "Cualquiera"}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            <p className="mt-1 text-[11px] text-muted-foreground/60">
              Dejalo vacío para que dispare con cualquier valor.
            </p>
          </div>
          )}
        </div>
      )}

      {/* Etapa 4: filtros de los triggers de agenda (F43, F44) */}
      {BOOKING_TRIGGERS.includes(triggerType) && (
        <div className="space-y-3">
          {RELATIVE_TRIGGERS.includes(triggerType) && (
            <div>
              <label className="mb-2 block text-xs font-semibold text-foreground">
                {triggerType === "booking_before_start" ? "Cuánto antes de la reunión" : "Cuánto después"}
              </label>
              <select
                value={String(data.offset_minutes ?? 1440)}
                onChange={(e) => onChange({ ...data, offset_minutes: Number(e.target.value) })}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                {OFFSETS.map((o) => (
                  <option key={o.minutes} value={o.minutes}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-muted-foreground/60">
                Si la reunión se mueve, el aviso se reprograma solo.
              </p>
            </div>
          )}

          <div>
            <label className="mb-2 block text-xs font-semibold text-foreground">Solo estos origenes</label>
            <div className="flex flex-wrap gap-2">
              {ORIGINS.map((o) => {
                const list = (data.origins as string[] | undefined) ?? [];
                const on = list.includes(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      onChange({ ...data, origins: on ? list.filter((v) => v !== o.value) : [...list, o.value] })
                    }
                    className={
                      on
                        ? "rounded-lg bg-emerald-500/15 px-2.5 py-1 text-xs text-emerald-600 dark:text-emerald-300"
                        : "rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
                    }
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground/60">Sin elegir ninguno, vale para todos.</p>
          </div>

          {(triggerType === "booking_cancelled" || triggerType === "booking_rescheduled") && (
            <div>
              <label className="mb-2 block text-xs font-semibold text-foreground">Solo si lo hizo</label>
              <div className="flex flex-wrap gap-2">
                {BY_WHOM.map((o) => {
                  const list = (data.by_whom as string[] | undefined) ?? [];
                  const on = list.includes(o.value);
                  return (
                    <button
                      key={o.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        onChange({ ...data, by_whom: on ? list.filter((v) => v !== o.value) : [...list, o.value] })
                      }
                      className={
                        on
                          ? "rounded-lg bg-emerald-500/15 px-2.5 py-1 text-xs text-emerald-600 dark:text-emerald-300"
                          : "rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
                      }
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {triggerType === "booking_status_changed" && (
            <div>
              <label className="mb-2 block text-xs font-semibold text-foreground">Solo si pasa a</label>
              <input
                type="text"
                value={((data.to_status as string[] | undefined) ?? []).join(", ")}
                onChange={(e) =>
                  onChange({ ...data, to_status: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) })
                }
                placeholder="sale, no_show"
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <p className="mt-1 text-[11px] text-muted-foreground/60">
                Separados por coma. Vacio = cualquier estado.
              </p>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground/60">
            Para acotar por evento, area o anfitrion, conviene crear el flujo desde el evento: ahi el filtro queda puesto solo.
          </p>
        </div>
      )}

      {/* @plantilla-desde(llamadas) */}
      {/* Llamadas (F32): filtros de call_analyzed y call_linked */}
      {CALL_TRIGGERS.includes(triggerType) && (
        <div className="space-y-3">
          {([
            ["call_types", "Solo estos tipos de llamada", BASE_CALL_TYPES.map((t) => ({ value: t, label: t }))],
            ...(triggerType === "call_analyzed"
              ? ([
                  ["outcomes", "Solo estos resultados", OUTCOME_CATEGORIES.map((o) => ({ value: o, label: o.replace(/_/g, " ") }))],
                  ["qualifications", "Solo estos leads", QUALIFICATIONS],
                ] as const)
              : []),
          ] as const).map(([key, title, options]) => {
            const list = (data[key] as string[] | undefined) ?? [];
            return (
              <div key={key}>
                <label className="mb-2 block text-xs font-semibold text-foreground">{title}</label>
                <div className="flex flex-wrap gap-2">
                  {options.map((o) => {
                    const on = list.includes(o.value);
                    return (
                      <button
                        key={o.value}
                        type="button"
                        aria-pressed={on}
                        onClick={() => onChange({ ...data, [key]: on ? list.filter((v) => v !== o.value) : [...list, o.value] })}
                        className={
                          on
                            ? "rounded-lg bg-emerald-500/15 px-2.5 py-1 text-xs text-emerald-600 dark:text-emerald-300"
                            : "rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
                        }
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {triggerType === "call_analyzed" && (
            <div className="grid grid-cols-2 gap-3">
              {([
                ["lead_score_min", "Puntaje del lead desde"],
                ["lead_score_max", "Puntaje del lead hasta"],
                ["closer_score_min", "Puntaje del closer desde"],
                ["closer_score_max", "Puntaje del closer hasta"],
              ] as const).map(([key, label]) => (
                <div key={key}>
                  <label htmlFor={`call-${key}`} className="mb-1 block text-xs font-semibold text-foreground">{label}</label>
                  <input
                    id={`call-${key}`}
                    type="number"
                    min={0}
                    max={100}
                    value={typeof data[key] === "number" ? (data[key] as number) : ""}
                    onChange={(e) => onChange({ ...data, [key]: e.target.value === "" ? null : Math.min(100, Math.max(0, Number(e.target.value))) })}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground/60">
            Sin elegir nada, vale para cualquier llamada. Solo dispara si la llamada tiene contacto. Las variables {"{{call.title}}"}, {"{{call.date}}"}, {"{{call.outcome}}"}, {"{{call.next_step}}"}, {"{{call.closer_name}}"}, {"{{call.closer_score}}"} y {"{{call.lead_score}}"} quedan disponibles para los mensajes.
          </p>
        </div>
      )}
      {/* @plantilla-hasta(llamadas) */}

      {/* @plantilla-desde(formularios) */}
      {/* Formularios (F19): formularios, puntaje y condiciones sobre las respuestas */}
      {FORM_TRIGGERS.includes(triggerType) && <FormTriggerPanel triggerType={triggerType} data={data} onChange={onChange} />}
      {/* @plantilla-hasta(formularios) */}

      {/* @plantilla-desde(tareas) */}
      {/* Tareas (F25): proyectos y origenes */}
      {(triggerType === "task_completed" || triggerType === "task_overdue") && <TaskTriggerPanel triggerType={triggerType} data={data} onChange={onChange} />}
      {/* @plantilla-hasta(tareas) */}

      {/* @plantilla-desde(webhooks) */}
      {triggerType === "webhook_received" && <WebhookTriggerPanel flowId={flowId} data={data} onChange={onChange} sendsMessages={sendsMessages} />}
      {/* @plantilla-hasta(webhooks) */}

      {/* F5: ventana de inactividad */}
      {triggerType === "inactivity" && (
        <div>
          <label className="mb-2 block text-xs font-semibold text-foreground">
            Cuánto esperar sin respuesta
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              value={data.amount ?? 24}
              onChange={(e) =>
                onChange({ ...data, amount: parseInt(e.target.value) || 1 })
              }
              className="w-24 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            <select
              value={data.unit ?? "hours"}
              onChange={(e) =>
                onChange({ ...data, unit: e.target.value as "hours" | "days" })
              }
              className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="hours">horas</option>
              <option value="days">días</option>
            </select>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground/60">
            Se cuenta desde la ultima vez que el lead interactuo. Dispara una
            sola vez por conversacion y por ventana, aunque el chequeo corra
            cada quince minutos.
          </p>
          <p className="mt-2 rounded-md bg-muted px-2.5 py-2 text-[11px] text-muted-foreground">
            Solo aplica a canales donde se puede saber si el lead contesto:
            Instagram hoy, WhatsApp cuando se conecte el numero.
          </p>
        </div>
      )}

      {/* Email recibido: el filtro por asunto que el motor ya leia y el panel no mostraba. */}
      {triggerType === "email_received" && (
        <div>
          <label htmlFor="trg-subject" className="mb-2 block text-xs font-semibold text-foreground">
            Solo si el asunto contiene
          </label>
          <input
            id="trg-subject"
            type="text"
            value={typeof data.subjectContains === "string" ? data.subjectContains : ""}
            onChange={(e) => onChange({ ...data, subjectContains: e.target.value })}
            placeholder="Por ejemplo: presupuesto"
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">Vacío: corre con cualquier correo que entre. No distingue mayúsculas.</p>
        </div>
      )}

      {/* Comentarios: la respuesta pública que el motor ya mandaba y el panel no mostraba. */}
      {triggerType === "comment_keyword" && (
        <div>
          <label htmlFor="trg-reply" className="mb-2 block text-xs font-semibold text-foreground">
            Respuesta pública al comentario (opcional)
          </label>
          <textarea
            id="trg-reply"
            rows={2}
            value={typeof data.replyText === "string" ? data.replyText : ""}
            onChange={(e) => onChange({ ...data, replyText: e.target.value })}
            placeholder="¡Te escribimos por privado! 💬"
            className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">Se contesta debajo del comentario, a la vista de todos. Para limitarlo a ciertas publicaciones, usá la pestaña Growth.</p>
        </div>
      )}

      {/* Fase 3: convivencia con el agente de IA */}
      {(MESSAGE_TRIGGER_TYPES.includes(triggerType) || (triggerType === "comment_keyword" && data.alsoMatchInDms)) && (
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3">
          <input
            type="checkbox"
            checked={data.onlyIfAgentOff === true}
            onChange={(e) => onChange({ ...data, onlyIfAgentOff: e.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-input text-emerald-500 focus:ring-emerald-500"
          />
          <span>
            <span className="block text-sm font-medium text-foreground">Solo si el agente de IA está apagado</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {triggerType === "default"
                ? "Recomendado: sin esto, esta automatización responde todos los mensajes y el agente nunca contesta."
                : "La automatización no arranca en las conversaciones que está atendiendo el agente."}
            </span>
          </span>
        </label>
      )}

      {/* Payload Section */}
      {showPayload && (
        <div>
          <label className="mb-2 block text-xs font-semibold text-foreground">
            Valor del botón (payload)
          </label>
          <input
            type="text"
            value={data.payload || ""}
            onChange={(e) => onChange({ ...data, payload: e.target.value })}
            placeholder="Por ejemplo: QUIERO_INFO"
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            El valor que tiene que traer {triggerType === "postback" ? "el botón que toca el lead" : "la respuesta rápida que toca el lead"}. Solo Instagram: en WhatsApp las opciones llegan como lista numerada.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * "Cambió el estado del contacto" (pipeline, 00245): qué rol y, opcionalmente,
 * a qué estado. Guarda `setter`, `closer`, `setter:<clave>` o vacío (cualquiera).
 * Las listas se leen del workspace (cualquier miembro lo ve).
 */
function StatusChangedPicker({ flowId, value, onChange }: { flowId?: string; value: string; onChange: (value: string) => void }) {
  const [settings, setSettings] = useState<ContactStatusSettings | null>(null);
  const workspaceId = useActiveWorkspaceId();
  useEffect(() => {
    let alive = true;
    const supabase = createClient();
    // El workspace del flujo (con la RLS de quien edita); sin flujo, el activo (una persona puede estar en dos).
    const load = flowId
      ? supabase.from("flows").select("workspaces(contact_status_settings)").eq("id", flowId).maybeSingle()
          .then(({ data }) => (data as { workspaces?: { contact_status_settings?: unknown } | null } | null)?.workspaces?.contact_status_settings)
      : workspaceId
        ? supabase.from("workspaces").select("contact_status_settings").eq("id", workspaceId).maybeSingle()
            .then(({ data }) => (data as { contact_status_settings?: unknown } | null)?.contact_status_settings)
        : Promise.resolve(null);
    void load.then((raw) => {
      if (alive) setSettings(parseStatusSettings(raw));
    });
    return () => {
      alive = false;
    };
  }, [flowId, workspaceId]);

  const [rawRole, status = ""] = value.split(":");
  const role: StatusRole | "" = isStatusRole(rawRole) ? rawRole : "";
  const options = role && settings ? settings[role] : [];
  const selectClass =
    "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="status-trigger-role" className="mb-2 block text-xs font-semibold text-foreground">
          Que estado
        </label>
        <select id="status-trigger-role" value={role} onChange={(e) => onChange(e.target.value)} className={selectClass}>
          <option value="">Cualquiera (setter o vendedor)</option>
          {STATUS_ROLES.map((r) => (
            <option key={r} value={r}>
              Estado de {STATUS_ROLE_LABELS[r].toLowerCase()}
            </option>
          ))}
        </select>
      </div>
      {role && (
        <div>
          <label htmlFor="status-trigger-status" className="mb-2 block text-xs font-semibold text-foreground">
            Cuando pasa a
          </label>
          <select
            id="status-trigger-status"
            value={status}
            onChange={(e) => onChange(e.target.value ? `${role}:${e.target.value}` : role)}
            className={selectClass}
          >
            <option value="">Cualquier estado</option>
            {options.map((st) => (
              <option key={st.key} value={st.key}>
                {statusName(options, st.key)}
              </option>
            ))}
            {status && !options.some((st) => st.key === status) && <option value={status}>{status} (ya no existe)</option>}
          </select>
          {settings === null && <p className="mt-1 text-[11px] text-muted-foreground/60">Cargando estados…</p>}
        </div>
      )}
    </div>
  );
}
