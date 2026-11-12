"use client";

import { useState } from "react";
import { META_CURRENCIES, STEP_META_EVENTS, checkStepEventName, isStepEventName, type MetaEventStepData } from "@/lib/meta/capi/events";

/**
 * Lo que se configura de «Enviar evento a Meta» (00328): qué evento, el valor (opcional, admite variables), la moneda,
 * el nombre del contenido y, en una reunión, si solo cuentan las que agendó el lead. Lo usan el editor de pasos
 * y el panel del lienzo: es el mismo paso en los dos lados.
 *
 * El código del evento y la hora no se configuran: los decide el paso (ver `lib/flow-engine/nodes/send-meta-event.ts`).
 */

const CUSTOM = "__custom__";

export function MetaEventFields({
  idPrefix,
  data,
  patch,
  disabled = false,
  bookingToggle,
  inputClassName,
}: {
  idPrefix: string;
  data: MetaEventStepData;
  patch: (next: Partial<MetaEventStepData>) => void;
  disabled?: boolean;
  /** `show`: en la Agenda. `hint`: en el lienzo, donde puede o no dispararlo una reunión. `hide`: donde no hay reuniones. */
  bookingToggle: "show" | "hint" | "hide";
  inputClassName: string;
}) {
  const eventName = String(data.eventName ?? "");
  // «Otro» se recuerda aparte: con el nombre todavía vacío, el desplegable igual tiene que mostrar «Otro».
  const [customMode, setCustomMode] = useState(!!eventName && !isStepEventName(eventName));
  const check = checkStepEventName(eventName);

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label htmlFor={`${idPrefix}-event`} className="text-xs text-muted-foreground">
          Qué evento recibe Meta
        </label>
        <select
          id={`${idPrefix}-event`}
          value={customMode ? CUSTOM : eventName}
          disabled={disabled}
          onChange={(e) => {
            const custom = e.target.value === CUSTOM;
            setCustomMode(custom);
            patch({ eventName: custom ? "" : e.target.value });
          }}
          className={inputClassName}
        >
          {!eventName && !customMode && <option value="">Elegí un evento…</option>}
          {STEP_META_EVENTS.map((e) => (
            <option key={e.name} value={e.name}>
              {e.label}
            </option>
          ))}
          <option value={CUSTOM}>Otro (un nombre propio)</option>
        </select>
        {customMode && (
          <input
            aria-label="Nombre del evento propio"
            value={eventName}
            disabled={disabled}
            maxLength={50}
            placeholder="Por ejemplo: LlamadaCalificada"
            onChange={(e) => patch({ eventName: e.target.value })}
            className={inputClassName}
          />
        )}
        {!check.ok && eventName && <p className="text-[11px] text-amber-700 dark:text-amber-300">{check.error}</p>}
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-2">
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-value`} className="text-xs text-muted-foreground">
            Valor (opcional)
          </label>
          <input
            id={`${idPrefix}-value`}
            value={String(data.value ?? "")}
            disabled={disabled}
            maxLength={200}
            placeholder="Ej: 500 o {{answer.presupuesto}}"
            onChange={(e) => patch({ value: e.target.value })}
            className={inputClassName}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-currency`} className="text-xs text-muted-foreground">
            Moneda
          </label>
          <select
            id={`${idPrefix}-currency`}
            value={String(data.currency ?? "USD")}
            disabled={disabled}
            onChange={(e) => patch({ currency: e.target.value })}
            className={inputClassName}
          >
            {META_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor={`${idPrefix}-content`} className="text-xs text-muted-foreground">
          Nombre del contenido (opcional)
        </label>
        <input
          id={`${idPrefix}-content`}
          value={String(data.contentName ?? "")}
          disabled={disabled}
          maxLength={200}
          placeholder="Si lo dejás vacío, va el nombre del formulario o de la reunión" // @plantilla-quitar(formularios)
          // @plantilla-sin(formularios): placeholder="Si lo dejás vacío, va el nombre de la reunión"
          onChange={(e) => patch({ contentName: e.target.value })}
          className={inputClassName}
        />
      </div>

      {bookingToggle !== "hide" && (
        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            checked={data.onlyLeadBookings !== false}
            disabled={disabled}
            onChange={(e) => patch({ onlyLeadBookings: e.target.checked })}
            className="mt-0.5"
          />
          <span>
            Solo reuniones que agendó el lead (página pública o embebida)
            <span className="block text-muted-foreground">
              {bookingToggle === "hint"
                ? "Aplica cuando el flujo lo dispara una reunión. Las que arma el equipo o el agente no se mandan."
                : "Las que arma el equipo o el agente no se mandan: no vinieron de un anuncio."}
            </span>
          </span>
        </label>
      )}

      <p className="text-[11px] text-muted-foreground">
        Llega a Meta en uno o dos minutos, con el email, el teléfono y las cookies de Meta de la persona. Si tu web también
        lo manda con el Pixel usando el mismo código, Meta lo cuenta una sola vez.
      </p>
    </div>
  );
}
