"use client";

/**
 * Cómo sale un WhatsApp de una automatización (cola de WhatsApp, 00420): según el disparador, por la cola del número o
 * al instante y, por la cola, programado «N minutos, horas o días después». Se guarda en `data.delivery` del paso. Las
 * reglas son las de `lib/send-queue/automation/*` (puras): este componente solo las compone. Lo que está mal se marca
 * acá y frena la publicación; el borrador se guarda igual.
 */
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { deliveryProblem, parseDelivery, type DeliveryMode } from "@/lib/send-queue/automation/settings";
import { UNIT_LABELS, type ScheduleUnit } from "@/lib/send-queue/automation/schedule";

const labelClass = "mb-2 block text-xs font-semibold text-foreground";
const inputClass = "rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring";

export function WhatsappDeliveryFields({
  value,
  onChange,
  groupStep = false,
  idPrefix,
}: {
  value: unknown;
  onChange: (next: Record<string, unknown>) => void;
  /** El paso manda a un grupo: en «según el disparador» sale al instante. */
  groupStep?: boolean;
  idPrefix: string;
}) {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const delivery = parseDelivery(value);
  const schedule = delivery.schedule;
  const problem = deliveryProblem(value);
  const set = (patch: Record<string, unknown>) => onChange({ ...raw, ...patch });
  const setSchedule = (patch: Record<string, unknown>) => set({ schedule: { ...schedule, ...patch } });

  const options: Array<{ mode: DeliveryMode; title: string; help: string }> = [
    {
      mode: "auto",
      title: "Según el disparador (recomendado)",
      help: groupStep
        ? "Un mensaje a un grupo sale al instante, como siempre."
        : "Si la automatización arranca porque el contacto escribió o por su agenda, sale al instante. Si arranca por otra cosa (etiqueta, formulario, fecha, venta…), va por la cola del número.",
    },
    {
      mode: "queue",
      title: "Por la cola del número",
      help: "Sale de a uno, con esperas al azar, dentro del horario de envío del número y sin pasar su cupo. Lo más seguro contra el bloqueo.",
    },
    {
      mode: "immediate",
      title: "Al instante",
      help: "Sale en el momento, sin esperar turno ni horario (cuenta igual en el cupo del número).",
    },
  ];

  return (
    <div className="space-y-3 rounded-lg border border-border p-3" data-testid="whatsapp-delivery">
      <fieldset>
        <legend className={labelClass}>Cómo sale por WhatsApp</legend>
        <div className="space-y-2">
          {options.map((o) => (
            <label key={o.mode} className="flex items-start gap-2 text-sm text-foreground">
              <input
                type="radio"
                name={`${idPrefix}-mode`}
                className="mt-1"
                checked={delivery.mode === o.mode}
                onChange={() => set({ mode: o.mode === "auto" ? undefined : o.mode, ...(o.mode === "immediate" ? { schedule: { ...schedule, enabled: false } } : {}) })}
              />
              <span>
                {o.title}
                <span className="block text-xs text-muted-foreground">{o.help}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {delivery.mode !== "immediate" && (
        <div>
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input type="checkbox" className="mt-0.5" checked={schedule.enabled} onChange={(e) => setSchedule({ enabled: e.target.checked, amount: schedule.amount || 1 })} />
            <span>
              Programarlo para más tarde
              <span className="block text-xs text-muted-foreground">El texto queda fijo al correr el paso: editar la automatización después no cambia lo ya programado.</span>
            </span>
          </label>
          {schedule.enabled && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <input
                id={`${idPrefix}-schedule-amount`}
                type="number"
                min={1}
                aria-label="Cuánto tiempo después"
                value={Number.isFinite(schedule.amount) ? schedule.amount : ""}
                onChange={(e) => setSchedule({ amount: e.target.value === "" ? 0 : Number(e.target.value) })}
                className={`${inputClass} w-20`}
              />
              <select aria-label="Unidad" value={schedule.unit} onChange={(e) => setSchedule({ unit: e.target.value as ScheduleUnit })} className={inputClass}>
                {(Object.keys(UNIT_LABELS) as ScheduleUnit[]).map((u) => (
                  <option key={u} value={u}>
                    {UNIT_LABELS[u]}
                  </option>
                ))}
              </select>
              <span className="text-muted-foreground">después de que corre el paso</span>
            </div>
          )}
        </div>
      )}

      {problem && (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {problem}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        <Link href="/dashboard/flows/cola" className="underline">
          Ver la cola de mensajes
        </Link>
      </p>
    </div>
  );
}
