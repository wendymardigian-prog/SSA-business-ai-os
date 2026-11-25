"use client";
// @plantilla-quitar(servicios)

/**
 * Las secciones del Reto genérico en el editor del camino (F127): en la fase, las reglas para aceptar (solo si lo
 * arranca el cliente), el control semanal y la fecha límite para empezar; en el paso, la repetición (con las anclas
 * nuevas), el atraso y el certificado según si llegó a tiempo. Lo valida `validateJourneyTemplate` (y su gemela en la
 * base): acá solo se arma el JSON.
 */
import { Plus, Trash2 } from "lucide-react";
import { InfoTooltip } from "@/components/ui/tooltip";
import type { JourneyItem } from "@/lib/services/journey-template";
import { WEEKDAY_NAMES, WEEKDAY_SHORT } from "@/lib/services/repetition";
import type { NamedOption } from "./service-settings-panel";

const input = "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:border-primary-edge focus:outline-none focus:ring-1 focus:ring-primary-edge";
const label = "mb-1.5 flex items-center gap-1 text-xs font-semibold text-foreground";
const box = "space-y-3 rounded-lg border border-border p-3";
type Obj = Record<string, unknown>;
const numOrNull = (v: string): number | null => (v.trim() === "" ? null : Number(v));
const keyOrNull = (v: string): string | null => (v.trim() === "" ? null : v.trim());
/** Saca las claves en undefined: la validación mira si la clave está (y en la base no llegan). */
const clean = (o: Obj): Obj => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export const CHALLENGE_HELP = {
  acceptance: "Antes de empezar, el cliente ve estas reglas y las tilda una por una. Queda guardado cuándo las aceptó y en la ficha del servicio.",
  weekly: "Semanas contadas desde el día 1 del Reto. Suma el campo de número de los reportes de cada semana y mira si hubo un link. Escribí la clave de cada campo del formulario del reporte.",
  stuck: "Si el reporte tiene un campo «Trabado en», escribí su clave: en la ficha se marcan los días con algo escrito.",
  startBy: "Si el cliente no lo empezó para esa fecha, le avisa al responsable (una vez). No le impide empezar.",
  from: "Desde cuándo se crean las repeticiones. Igual, solo se crean mientras la fase de este paso está abierta.",
  until: "Hasta cuándo se repite. «Una cantidad de vueltas cumplidas» cuenta solo las que se completaron. «Tope de días» corta antes si llega primero.",
  late: "Por defecto, una repetición no se puede cargar antes de su día. Pasado el plazo (y las horas de gracia), solo si aceptás tarde.",
  certificate: "Si el paso elegido se completó dentro de su plazo (sin gracia), emite la primera plantilla; si no, la otra.",
};

// ── Fase ─────────────────────────────────────────────────────────────────────
export function ChallengeSettings({ challenge, onChange }: { challenge: Obj; onChange: (next: Obj) => void }) {
  const set = (patch: Obj) => onChange({ ...challenge, ...patch });
  const acc = (challenge.acceptance ?? null) as Obj | null;
  const weekly = (challenge.weekly ?? null) as Obj | null;
  const startBy = (challenge.start_by ?? null) as Obj | null;
  const items = Array.isArray(acc?.items) ? (acc!.items as string[]) : [];
  const student = challenge.start === "student";

  return (
    <div className="space-y-3">
      {student && (
        <div className={box}>
          <label className="flex items-center gap-2 text-xs font-semibold">
            <input
              type="checkbox"
              checked={acc?.enabled === true}
              onChange={(e) => set({ acceptance: e.target.checked ? { enabled: true, description: "", items: [""], button_label: "" } : null })}
            />
            Pedir que acepte reglas antes de empezar <InfoTooltip text={CHALLENGE_HELP.acceptance} />
          </label>
          {acc?.enabled === true && (
            <>
              <textarea
                aria-label="Texto antes de las reglas"
                rows={2}
                value={(acc.description as string) ?? ""}
                onChange={(e) => set({ acceptance: { ...acc, description: e.target.value } })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                placeholder="Antes de empezar, leé y aceptá…"
              />
              {items.map((it, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    aria-label={`Regla ${i + 1}`}
                    value={it}
                    onChange={(e) => set({ acceptance: { ...acc, items: items.map((x, k) => (k === i ? e.target.value : x)) } })}
                    className={input}
                  />
                  <button type="button" aria-label={`Quitar la regla ${i + 1}`} className="rounded p-1.5 text-muted-foreground hover:bg-accent" onClick={() => set({ acceptance: { ...acc, items: items.filter((_, k) => k !== i) } })}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              ))}
              {items.length < 20 && (
                <button type="button" className="inline-flex items-center gap-1 text-xs text-primary-ink hover:underline" onClick={() => set({ acceptance: { ...acc, items: [...items, ""] } })}>
                  <Plus className="h-3.5 w-3.5" aria-hidden /> Sumar una regla
                </button>
              )}
              <input
                aria-label="Texto del botón para empezar"
                value={(acc.button_label as string) ?? ""}
                maxLength={40}
                onChange={(e) => set({ acceptance: { ...acc, button_label: e.target.value } })}
                className={input}
                placeholder="Empezar el Reto"
              />
            </>
          )}
        </div>
      )}

      <div className={box}>
        <label className="flex items-center gap-2 text-xs font-semibold">
          <input type="checkbox" checked={!!weekly} onChange={(e) => set({ weekly: e.target.checked ? { min: null, video: false } : null })} />
          Control semanal <InfoTooltip text={CHALLENGE_HELP.weekly} />
        </label>
        {weekly && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className={label}>Mínimo por semana</span>
              <input aria-label="Mínimo por semana" inputMode="decimal" value={(weekly.min as number | null) ?? ""} onChange={(e) => set({ weekly: { ...weekly, min: numOrNull(e.target.value) } })} className={input} />
            </div>
            <label className="mt-6 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={weekly.video === true} onChange={(e) => set({ weekly: { ...weekly, video: e.target.checked } })} />
              Un video por semana
            </label>
            {(
              [
                ["number_field_key", "Campo de número (horas)"],
                ["link_field_key", "Campo del link (video)"],
                ["stuck_field_key", "Campo «Trabado en»"],
              ] as const
            ).map(([k, l]) => (
              <div key={k}>
                <span className={label}>
                  {l} {k === "stuck_field_key" ? <InfoTooltip text={CHALLENGE_HELP.stuck} /> : null}
                </span>
                <input aria-label={l} value={(weekly[k] as string | null) ?? ""} onChange={(e) => set({ weekly: { ...weekly, [k]: keyOrNull(e.target.value) } })} className={`${input} font-mono`} placeholder="clave_del_campo" />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={box}>
        <label className="flex items-center gap-2 text-xs font-semibold">
          <input type="checkbox" checked={!!startBy} onChange={(e) => set({ start_by: e.target.checked ? { from: "service_start", days: 56 } : null })} />
          Fecha límite para empezar <InfoTooltip text={CHALLENGE_HELP.startBy} />
        </label>
        {startBy && (
          <div className="grid grid-cols-2 gap-3">
            <input aria-label="Días para empezar" inputMode="numeric" value={(startBy.days as number) ?? ""} onChange={(e) => set({ start_by: { ...startBy, days: numOrNull(e.target.value) } })} className={input} />
            <select aria-label="Desde" value={(startBy.from as string) ?? "service_start"} onChange={(e) => set({ start_by: { ...startBy, from: e.target.value } })} className={input}>
              <option value="service_start">días desde el inicio del servicio</option>
              <option value="service_created">días desde que se creó el servicio</option>
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Los días de la semana de una repetición semanal (00522) ─────────────────
function WeekdayPicker({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  return (
    <div>
      <span className={label}>Qué días</span>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Días de la semana">
        {WEEKDAY_NAMES.map((name, i) => {
          const day = i + 1;
          const on = value.includes(day);
          return (
            <button
              key={day}
              type="button"
              aria-pressed={on}
              aria-label={name}
              title={name}
              onClick={() => onChange(on ? value.filter((d) => d !== day) : [...value, day].sort((a, b) => a - b))}
              className={`h-10 w-10 rounded-full border text-xs font-medium md:h-8 md:w-8 ${on ? "border-primary-edge bg-primary/10 text-primary-ink" : "border-border text-muted-foreground hover:bg-accent"}`}
            >
              {WEEKDAY_SHORT[i]}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{value.length ? "Una vuelta cada uno de esos días." : "Sin días elegidos: el mismo día de la semana en que empieza."}</p>
    </div>
  );
}

// ── Paso: repetición y atraso ────────────────────────────────────────────────
export function RepeatSection({
  item,
  phases,
  items,
  ownPhaseKey,
  onChange,
}: {
  item: JourneyItem;
  phases: NamedOption[];
  items: NamedOption[];
  ownPhaseKey: string;
  onChange: (patch: Partial<JourneyItem>) => void;
}) {
  const r = (item.recurrence ?? null) as Obj | null;
  const late = (item.late ?? null) as Obj | null;
  const setR = (patch: Obj) => onChange({ recurrence: clean({ ...(r ?? {}), ...patch }) });
  const from = (r?.from ?? null) as Obj | null;
  const otherPhases = phases.filter((p) => p.id !== ownPhaseKey);
  const otherItems = items.filter((p) => p.id !== item.key);
  const fromKind = from ? (from.from as string) + (from.phase_key ? ":other" : "") : "";

  return (
    <div className={box}>
      <label className="flex items-center gap-2 text-xs font-semibold">
        <input
          type="checkbox"
          checked={!!r}
          onChange={(e) => {
            if (e.target.checked) return onChange({ recurrence: { every: "day", until: "phase_end" } });
            // Sin repetición no hay serie: «cómo se agenda» se saca (la base rechazaría una serie que no se repite).
            const { schedule: _schedule, ...restRef } = ((item.ref as Obj | undefined) ?? {}) as Obj;
            void _schedule;
            onChange(item.kind === "booking" ? { recurrence: null, late: null, ref: restRef as JourneyItem["ref"] } : { recurrence: null, late: null });
          }}
        />
        Se repite
      </label>
      {r && (
        <>
          {item.kind === "booking" && (
            <div>
              <span className={label}>Cómo se agenda</span>
              <select
                aria-label="Cómo se agenda cada reunión"
                value={(item.ref as Obj | undefined)?.schedule === "series" ? "series" : "team"}
                onChange={(e) => onChange({ ref: { ...((item.ref as Obj | undefined) ?? {}), schedule: e.target.value } as JourneyItem["ref"] })}
                className={input}
              >
                <option value="team">La agenda el equipo en cada vuelta</option>
                <option value="series">La fija quien atiende, como una serie en su Google</option>
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                {(item.ref as Obj | undefined)?.schedule === "series"
                  ? "Cuando empiece, quien atiende recibe la tarea «Fijar reuniones recurrentes»: elige el primer día y la hora, y se crea un solo evento que se repite en su Google Calendar, con Meet e invitación al cliente. Necesita Google conectado."
                  : "Cada vuelta crea la tarea «Agendar … · vuelta N» para quien atiende; se cierra sola cuando la reunión queda agendada."}
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className={label}>Cada</span>
              <select
                aria-label="Cada cuánto"
                value={(r.every as string) ?? "day"}
                onChange={(e) => {
                  const every = e.target.value;
                  // Al cambiar la frecuencia se sacan los datos que ya no le corresponden (la base los rechazaría).
                  setR({
                    every,
                    n: every === "n_days" || every === "n_weeks" ? 2 : undefined,
                    weekdays: every === "week" || every === "n_weeks" ? r.weekdays : undefined,
                    day_of_month: every === "month" ? r.day_of_month : undefined,
                  });
                }}
                className={input}
              >
                <option value="day">Día</option>
                <option value="week">Semana</option>
                <option value="n_weeks">Cada N semanas</option>
                <option value="month">Mes</option>
                <option value="n_days">Cada N días</option>
              </select>
            </div>
            {r.every === "n_days" && (
              <div>
                <span className={label}>Días</span>
                <input aria-label="Cada cuántos días" inputMode="numeric" value={(r.n as number) ?? ""} onChange={(e) => setR({ n: numOrNull(e.target.value) })} className={input} />
              </div>
            )}
            {r.every === "n_weeks" && (
              <div>
                <span className={label}>Semanas</span>
                <input aria-label="Cada cuántas semanas" inputMode="numeric" value={(r.n as number) ?? ""} onChange={(e) => setR({ n: numOrNull(e.target.value) })} className={input} />
              </div>
            )}
            {r.every === "month" && (
              <div>
                <span className={label}>Día del mes</span>
                <input
                  aria-label="Qué día del mes"
                  inputMode="numeric"
                  placeholder="El día en que empieza"
                  value={(r.day_of_month as number | null) ?? ""}
                  onChange={(e) => setR({ day_of_month: numOrNull(e.target.value) ?? undefined })}
                  className={input}
                />
              </div>
            )}
          </div>
          {(r.every === "week" || r.every === "n_weeks") && (
            <WeekdayPicker value={Array.isArray(r.weekdays) ? (r.weekdays as number[]) : []} onChange={(days) => setR({ weekdays: days.length ? days : undefined })} />
          )}
          {r.every === "month" && <p className="text-xs text-muted-foreground">Si un mes no tiene ese día (por ejemplo el 31), cae el último día del mes.</p>}

          <div>
            <span className={label}>
              Desde <InfoTooltip text={CHALLENGE_HELP.from} />
            </span>
            <select
              aria-label="Desde cuándo se repite"
              value={fromKind}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return setR({ from: undefined });
                const [f, other] = v.split(":");
                setR({
                  from: {
                    from: f,
                    days: (from?.days as number) ?? 0,
                    ...(other ? { phase_key: otherPhases[0]?.id ?? null } : {}),
                    ...(f === "item_completed" ? { item_key: otherItems[0]?.id ?? null } : {}),
                  },
                });
              }}
              className={input}
            >
              <option value="">El inicio de su fase</option>
              <option value="service_start">El inicio del servicio</option>
              <option value="service_created">Cuando se creó el servicio</option>
              <option value="phase_start:other">El inicio de otra fase</option>
              <option value="phase_end:other">El fin de otra fase</option>
              <option value="item_completed">Cuando se completa otro paso</option>
            </select>
            {from?.phase_key !== undefined && (
              <select aria-label="Fase desde la que se repite" value={(from.phase_key as string) ?? ""} onChange={(e) => setR({ from: { ...from, phase_key: e.target.value } })} className={`${input} mt-2`}>
                {otherPhases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            {from?.from === "item_completed" && (
              <select aria-label="Paso desde el que se repite" value={(from.item_key as string) ?? ""} onChange={(e) => setR({ from: { ...from, item_key: e.target.value } })} className={`${input} mt-2`}>
                {otherItems.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            {from && (
              <input aria-label="Días después" inputMode="numeric" value={(from.days as number) ?? 0} onChange={(e) => setR({ from: { ...from, days: numOrNull(e.target.value) ?? 0 } })} className={`${input} mt-2`} placeholder="Días después" />
            )}
          </div>

          <div>
            <span className={label}>
              Hasta <InfoTooltip text={CHALLENGE_HELP.until} />
            </span>
            <select
              aria-label="Hasta cuándo se repite"
              value={(r.until as string) + (r.until === "phase_end" && r.phase_key ? ":other" : "")}
              onChange={(e) => {
                const [u, other] = e.target.value.split(":");
                setR({
                  until: u,
                  phase_key: other ? otherPhases[0]?.id ?? null : undefined,
                  item_key: u === "item_completed" ? otherItems[0]?.id ?? null : undefined,
                  n_until: u === "n_days" || u === "n_times" ? ((r.n_until as number) ?? 30) : undefined,
                });
              }}
              className={input}
            >
              <option value="phase_end">El fin de su fase</option>
              <option value="phase_end:other">El fin de otra fase</option>
              <option value="service_end">El fin del servicio</option>
              <option value="n_days">Una cantidad de días</option>
              <option value="n_times">Una cantidad de vueltas cumplidas</option>
              <option value="item_completed">Que se complete otro paso</option>
            </select>
            {(r.until === "n_days" || r.until === "n_times") && (
              <input aria-label={r.until === "n_days" ? "Cuántos días" : "Cuántas veces"} inputMode="numeric" value={(r.n_until as number) ?? ""} onChange={(e) => setR({ n_until: numOrNull(e.target.value) })} className={`${input} mt-2`} />
            )}
            {r.until === "phase_end" && r.phase_key !== undefined && (
              <select aria-label="Fase hasta la que se repite" value={(r.phase_key as string) ?? ""} onChange={(e) => setR({ phase_key: e.target.value })} className={`${input} mt-2`}>
                {otherPhases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            {r.until === "item_completed" && (
              <select aria-label="Paso que corta la repetición" value={(r.item_key as string) ?? ""} onChange={(e) => setR({ item_key: e.target.value })} className={`${input} mt-2`}>
                {otherItems.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <input aria-label="Tope de días" inputMode="numeric" value={(r.max_days as number | null) ?? ""} onChange={(e) => setR({ max_days: numOrNull(e.target.value) ?? undefined })} className={`${input} mt-2`} placeholder="Tope de días (opcional)" />
          </div>

          <div className="space-y-2 border-t border-border pt-3">
            <span className={label}>
              Atraso <InfoTooltip text={CHALLENGE_HELP.late} />
            </span>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!late} onChange={(e) => onChange({ late: e.target.checked ? { accept: false, early: false, grace_hours: 0 } : null })} />
              Controlar cuándo se puede cargar
            </label>
            {late && (
              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={late.early === true} onChange={(e) => onChange({ late: { ...late, early: e.target.checked } })} />
                  Se puede adelantar
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={late.accept === true} onChange={(e) => onChange({ late: { ...late, accept: e.target.checked } })} />
                  Acepta tarde
                </label>
                <div>
                  <span className={label}>Horas de gracia</span>
                  <input aria-label="Horas de gracia" inputMode="numeric" value={(late.grace_hours as number) ?? ""} onChange={(e) => onChange({ late: { ...late, grace_hours: numOrNull(e.target.value) ?? 0 } })} className={input} />
                </div>
                {late.accept === true && (
                  <div>
                    <span className={label}>Hasta cuántos días tarde</span>
                    <input aria-label="Días tarde" inputMode="numeric" value={(late.grace_days as number | null) ?? ""} onChange={(e) => onChange({ late: clean({ ...late, grace_days: numOrNull(e.target.value) ?? undefined }) })} className={input} placeholder="Sin tope" />
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Paso de certificado: según si llegó a tiempo ─────────────────────────────
export function CertificateConditions({
  refValue,
  items,
  certificates,
  onRef,
}: {
  refValue: Obj;
  items: NamedOption[];
  certificates: NamedOption[];
  onRef: (next: Obj) => void;
}) {
  const list = Array.isArray(refValue.templates) ? (refValue.templates as Obj[]) : null;
  const onTime = list?.[0] ?? null;
  const other = list?.[1] ?? null;
  const set = (a: Obj, b: Obj) => {
    const next: Obj = { ...refValue, templates: [a, b] };
    delete next.template_id;
    onRef(next);
  };
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={!!list}
          onChange={(e) => {
            if (e.target.checked) set({ if: "on_time", item_key: items[0]?.id ?? "", template_id: (refValue.template_id as string) ?? "" }, { else: true, template_id: (refValue.template_id as string) ?? "" });
            else {
              const next: Obj = { ...refValue, template_id: (other?.template_id as string) ?? undefined };
              delete next.templates;
              onRef(next);
            }
          }}
        />
        Según si llegó a tiempo <InfoTooltip text={CHALLENGE_HELP.certificate} />
      </label>
      {list && onTime && other && (
        <div className="space-y-2">
          <select aria-label="Paso que tiene que estar a tiempo" value={(onTime.item_key as string) ?? ""} onChange={(e) => set({ ...onTime, item_key: e.target.value }, other)} className={input}>
            {items.map((p) => (
              <option key={p.id} value={p.id}>
                A tiempo: {p.name}
              </option>
            ))}
          </select>
          {(
            [
              [onTime, "Plantilla si llegó a tiempo", (v: string) => set({ ...onTime, template_id: v }, other)],
              [other, "Plantilla si no", (v: string) => set(onTime, { ...other, template_id: v })],
            ] as const
          ).map(([c, l, on]) => (
            <select key={l} aria-label={l} value={(c.template_id as string) ?? ""} onChange={(e) => on(e.target.value)} className={input}>
              <option value="">{l}…</option>
              {certificates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          ))}
        </div>
      )}
    </div>
  );
}
