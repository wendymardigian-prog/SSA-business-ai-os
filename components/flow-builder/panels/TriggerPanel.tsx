"use client";

import { useCallback, useState, useMemo } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TriggerType } from "@/lib/types/database";
import { BASE_CALL_TYPES } from "@/lib/calls/classification";
import { OUTCOME_CATEGORIES } from "@/lib/calls/rubric";

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
}

const triggerTypes: Array<{ value: TriggerType; label: string; description: string }> = [
  { value: "keyword", label: "Palabra clave", description: "Cuando el lead escribe una palabra que coincide" },
  { value: "postback", label: "Clic en un boton", description: "Cuando el lead toca un boton del mensaje" },
  { value: "quick_reply", label: "Respuesta rapida", description: "Cuando el lead toca una respuesta rapida" },
  { value: "welcome", label: "Primer mensaje", description: "La primera vez que el lead escribe" },
  { value: "default", label: "Respuesta por defecto", description: "Cuando ningun otro trigger coincide" },
  { value: "comment_keyword", label: "Palabra clave en comentarios", description: "Por palabras clave en los comentarios de una publicacion" },
  { value: "new_contact", label: "Contacto nuevo", description: "Cuando se crea un contacto, venga de donde venga (mensaje, import o alta manual)" },
  { value: "crm_event", label: "Evento del CRM", description: "Cuando cambia algo del contacto: un tag, un campo, el setter o el vendedor" },
  { value: "inactivity", label: "Inactividad", description: "Cuando pasan X horas sin que el lead conteste" },
  { value: "email_received", label: "Email recibido", description: "Cuando entra un correo a la direccion del negocio" },
  // Etapa 4: agenda. Los tres ultimos se calculan contra la hora de la
  // reunion, asi que piden ademas cuanto antes o cuanto despues.
  { value: "booking_created", label: "Se agendo una reunion", description: "Cuando alguien agenda, por el link, a mano, por el embed o por el agente" },
  { value: "booking_rescheduled", label: "Cambiaron la fecha", description: "Cuando una reunion se mueve a otro horario" },
  { value: "booking_cancelled", label: "Se cancelo", description: "Cuando se cancela una reunion" },
  { value: "booking_updated", label: "Se edito la reunion", description: "Cuando cambia la ubicacion o las notas" },
  { value: "booking_ended", label: "Termino la reunion", description: "Cuando pasa la hora de fin y la reunion no quedo cancelada" },
  { value: "booking_status_changed", label: "Cambio el estado", description: "Cuando la reunion pasa a otro estado (no-show, venta, seguimiento...)" },
  { value: "booking_before_start", label: "Antes de la reunion", description: "Un recordatorio antes de la hora de inicio" },
  { value: "booking_after_end", label: "Despues de la reunion", description: "Un seguimiento despues de la hora de fin" },
  { value: "booking_after_created", label: "Despues de agendar", description: "Un mensaje un rato despues de que agendaron" },
  // Llamadas: solo se dispara si la llamada tiene contacto.
  { value: "call_analyzed", label: "Se analizo una llamada", description: "Cuando una llamada con contacto queda analizada (nueva o regenerada)" },
  { value: "call_linked", label: "Se vinculo una llamada", description: "Cuando una llamada se vincula a un contacto, sola o a mano" },
];

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

/** Los dos de Llamadas, para mostrar sus filtros. */
const CALL_TRIGGERS = ["call_analyzed", "call_linked"];

const QUALIFICATIONS = [
  { value: "calificado", label: "Calificado" },
  { value: "con_reservas", label: "Con reservas" },
  { value: "no_calificado", label: "No calificado" },
];

const RELATIVE_TRIGGERS = ["booking_before_start", "booking_after_end", "booking_after_created"];

/** Cuanto antes o cuanto despues (F44). */
const OFFSETS = [
  { minutes: 15, label: "15 minutos" },
  { minutes: 30, label: "30 minutos" },
  { minutes: 60, label: "1 hora" },
  { minutes: 120, label: "2 horas" },
  { minutes: 240, label: "4 horas" },
  { minutes: 1440, label: "1 dia" },
  { minutes: 2880, label: "2 dias" },
  { minutes: 10080, label: "1 semana" },
];

const ORIGINS = [
  { value: "public_page", label: "Link publico" },
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
  { value: "tag_added", label: "Se agrego un tag", valueLabel: "Solo este tag", valuePlaceholder: "interesado" },
  { value: "tag_removed", label: "Se quito un tag", valueLabel: "Solo este tag", valuePlaceholder: "interesado" },
  { value: "field_changed", label: "Cambio un campo personalizado", valueLabel: "Solo este campo", valuePlaceholder: "presupuesto" },
  { value: "assignment_changed", label: "Se asigno setter o vendedor", valueLabel: "Solo este rol", valuePlaceholder: "vendedor" },
  { value: "do_not_contact", label: 'Se marco "no contactar"', valueLabel: "Solo por este motivo", valuePlaceholder: "" },
];

const matchTypes: Array<{ value: "exact" | "contains" | "startsWith"; label: string }> = [
  { value: "exact", label: "Exact match" },
  { value: "contains", label: "Contains" },
  { value: "startsWith", label: "Starts with" },
];

export function TriggerPanel({ data: rawData, onChange }: TriggerPanelProps) {
  const data = rawData as TriggerPanelData;
  const triggerType = data.triggerType || "keyword";
  // Con `data.keywords || []` el array es nuevo en cada render, asi que los
  // useCallback que dependen de el se rehacian siempre (tres warnings del
  // linter). El useMemo lo estabiliza mientras la lista no cambie.
  const keywords = useMemo(() => data.keywords ?? [], [data.keywords]);
  const [newKeyword, setNewKeyword] = useState("");
  const [newMatchType, setNewMatchType] = useState<"exact" | "contains" | "startsWith">("contains");

  const handleTriggerTypeChange = useCallback(
    (type: string) => {
      onChange({ ...data, triggerType: type });
    },
    [data, onChange]
  );

  const addKeyword = useCallback(() => {
    const trimmed = newKeyword.trim();
    if (!trimmed) return;
    const updated: Keyword[] = [...keywords, { value: trimmed, matchType: newMatchType }];
    onChange({ ...data, keywords: updated });
    setNewKeyword("");
  }, [data, keywords, newKeyword, newMatchType, onChange]);

  const removeKeyword = useCallback(
    (index: number) => {
      const updated = keywords.filter((_, i) => i !== index);
      onChange({ ...data, keywords: updated });
    },
    [data, keywords, onChange]
  );

  const updateKeywordMatchType = useCallback(
    (index: number, matchType: "exact" | "contains" | "startsWith") => {
      const updated = keywords.map((k, i) => (i === index ? { ...k, matchType } : k));
      onChange({ ...data, keywords: updated });
    },
    [data, keywords, onChange]
  );

  const showKeywords = triggerType === "keyword" || triggerType === "comment_keyword";
  const showPayload = triggerType === "postback" || triggerType === "quick_reply";
  const selectedEvent = CRM_EVENTS.find((e) => e.value === data.event) ?? CRM_EVENTS[0];

  return (
    <div className="space-y-5">
      {/* Trigger Type */}
      <div>
        <label className="mb-2 block text-xs font-semibold text-foreground">
          Trigger Type
        </label>
        <div className="space-y-1.5">
          {triggerTypes.map((t) => (
            <label
              key={t.value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                triggerType === t.value
                  ? "border-emerald-500 bg-emerald-50"
                  : "border-border bg-card hover:border-input"
              )}
            >
              <input
                type="radio"
                name="triggerType"
                value={t.value}
                checked={triggerType === t.value}
                onChange={() => handleTriggerTypeChange(t.value)}
                className="mt-0.5 h-4 w-4 border-input text-emerald-500 focus:ring-emerald-500"
              />
              <div>
                <p className="text-sm font-medium text-foreground">{t.label}</p>
                <p className="text-xs text-muted-foreground">{t.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Keywords Section */}
      {showKeywords && (
        <div>
          <label className="mb-2 block text-xs font-semibold text-foreground">
            Keywords
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
              placeholder="Enter keyword..."
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
              Add keywords that will trigger this flow. Press Enter or click + to add.
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
                <p className="text-sm font-medium text-foreground">Also match in DMs</p>
                <p className="text-xs text-muted-foreground">
                  {keywords.length === 0
                    ? "Add at least one keyword to use this."
                    : "Run this flow when someone sends a keyword as a direct message, not just as a comment."}
                </p>
                {data.alsoMatchInDms === true && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    A DM has no comment behind it, so public replies and the comment
                    variables ({"{{comment_text}}"}, {"{{post_id}}"}) are empty on that run.
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
                El flow corre unicamente cuando la palabra llega respondiendo una
                historia de Instagram. Un DM comun con la misma palabra no lo
                dispara.
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
              Que tiene que pasar
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
              Dejalo vacio para que dispare con cualquier valor.
            </p>
          </div>
        </div>
      )}

      {/* Etapa 4: filtros de los triggers de agenda (F43, F44) */}
      {BOOKING_TRIGGERS.includes(triggerType) && (
        <div className="space-y-3">
          {RELATIVE_TRIGGERS.includes(triggerType) && (
            <div>
              <label className="mb-2 block text-xs font-semibold text-foreground">
                {triggerType === "booking_before_start" ? "Cuanto antes de la reunion" : "Cuanto despues"}
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
                Si la reunion se mueve, el aviso se reprograma solo.
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

      {/* F5: ventana de inactividad */}
      {triggerType === "inactivity" && (
        <div>
          <label className="mb-2 block text-xs font-semibold text-foreground">
            Cuanto esperar sin respuesta
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
              <option value="days">dias</option>
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
            <span className="block text-sm font-medium text-foreground">Solo si el agente de IA esta apagado</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {triggerType === "default"
                ? "Recomendado: sin esto, este flow responde todos los mensajes y el agente nunca contesta."
                : "El flow no arranca en las conversaciones que esta atendiendo el agente."}
            </span>
          </span>
        </label>
      )}

      {/* Payload Section */}
      {showPayload && (
        <div>
          <label className="mb-2 block text-xs font-semibold text-foreground">
            Payload
          </label>
          <input
            type="text"
            value={data.payload || ""}
            onChange={(e) => onChange({ ...data, payload: e.target.value })}
            placeholder="Enter payload value..."
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            The payload value to match when a {triggerType === "postback" ? "button is clicked" : "quick reply is tapped"}.
          </p>
        </div>
      )}
    </div>
  );
}
