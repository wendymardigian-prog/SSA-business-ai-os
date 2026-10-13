"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { canDecrement, canIncrement, HOLD_DELAY_MS, HOLD_INTERVAL_MS, parseTyped, type StepperBounds } from "@/lib/eod/stepper";
import { cn } from "@/lib/utils";

/**
 * El número de un reporte de fin de día (E2): − y + grandes para usar con el dedo todo el
 * día como contador, y el número en el medio que también se puede escribir.
 *
 * - Botones de al menos 44 × 44 px; el número grande, en cifras tabulares.
 * - `inputMode="numeric"` (teclado numérico en el celular) y SIN `type="number"`: así no hay
 *   flechitas nativas y la rueda del mouse no cambia el valor al hacer scroll.
 * - − se deshabilita en el mínimo y + en el máximo. Un valor escrito fuera de rango se marca
 *   y NO se guarda hasta corregirlo.
 * - Mantener apretado repite (a los 400 ms, cada 80 ms). Flechas arriba y abajo suman y restan.
 *
 * Los "+1" se aplican sobre el valor MÁS NUEVO del borrador (`onIncrement`), no sobre el que
 * se ve: si otra pestaña sumó en el medio, no se pisa. La lógica está en `lib/eod/stepper.ts`.
 */
export function NumberStepper({
  label,
  value,
  bounds,
  required,
  help,
  disabled,
  onIncrement,
  onDecrement,
  onSet,
  error,
  context,
}: {
  label: string;
  value: number | null;
  bounds: StepperBounds;
  required?: boolean;
  help?: string;
  disabled?: boolean;
  onIncrement: () => void;
  onDecrement: () => void;
  /** Un número escrito a mano (o vacío). */
  onSet: (value: number | null) => void;
  /** Un error que viene del envío (por ejemplo, "Completá este campo"). */
  error?: string | null;
  /** Para los botones, cuando la misma pregunta está en varios canales ("Links enviados (Instagram)"). */
  context?: string;
}) {
  const named = context ? `${label} (${context})` : label;
  const id = useId();
  // Lo que se está escribiendo. null = se muestra el valor (el de esta pestaña, otra o el servidor).
  const [draftText, setDraftText] = useState<string | null>(null);
  // El valor más nuevo, para "mantener apretado" (que corre en un intervalo, fuera del render).
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  const timers = useRef<{ delay?: number; repeat?: number }>({});


  const step = bounds.step && bounds.step > 1 ? bounds.step : 1;
  const canMinus = !disabled && canDecrement(value, bounds);
  const canPlus = !disabled && canIncrement(value, bounds);

  function stopHold() {
    window.clearTimeout(timers.current.delay);
    window.clearInterval(timers.current.repeat);
    timers.current = {};
  }

  // Al desmontar, que no quede un "mantener apretado" corriendo.
  useEffect(() => {
    const t = timers.current;
    return () => {
      window.clearTimeout(t.delay);
      window.clearInterval(t.repeat);
    };
  }, []);

  function startHold(direction: 1 | -1) {
    stopHold();
    setDraftText(null);
    const act = () => {
      const current = valueRef.current;
      if (direction === 1 ? !canIncrement(current, bounds) : !canDecrement(current, bounds)) return stopHold();
      if (direction === 1) onIncrement();
      else onDecrement();
    };
    act();
    timers.current.delay = window.setTimeout(() => {
      timers.current.repeat = window.setInterval(act, HOLD_INTERVAL_MS);
    }, HOLD_DELAY_MS);
  }

  /** Al salir del campo: si lo escrito es válido, se guarda y se vuelve a mostrar el valor. */
  function commitText(raw: string) {
    const parsed = parseTyped(raw, bounds);
    if (parsed.kind === "invalid") return; // queda marcado y NO se guarda hasta corregirlo
    onSet(parsed.kind === "empty" ? null : parsed.value);
    setDraftText(null);
  }

  const typed = draftText === null ? null : parseTyped(draftText, bounds);
  const typedError = typed?.kind === "invalid" ? typed.reason : null;
  const shownError = typedError ?? error ?? null;
  const text = draftText ?? (value === null ? "" : String(value));
  const buttonClass =
    "flex h-14 w-14 shrink-0 touch-manipulation select-none items-center justify-center rounded-xl border border-border bg-background text-foreground transition-colors hover:bg-accent active:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35 sm:h-12 sm:w-12";

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
        {required && (
          <span className="text-destructive" aria-hidden>
            {" "}
            *
          </span>
        )}
      </label>
      {help && (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      )}
      <div className="flex w-full items-center gap-2">
        <button
          type="button"
          aria-label={step > 1 ? `Restar ${step} a ${named}` : `Restar uno a ${named}`}
          disabled={!canMinus}
          className={buttonClass}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            startHold(-1);
          }}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onPointerCancel={stopHold}
          // El teclado (Enter o espacio sobre el botón) llega como click sin puntero.
          onClick={(e) => {
            if (e.detail === 0 && canMinus) {
              setDraftText(null);
              onDecrement();
            }
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <Minus className="h-6 w-6" aria-hidden />
        </button>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          pattern="-?[0-9]*"
          autoComplete="off"
          disabled={disabled}
          value={text}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={[help ? `${id}-help` : null, shownError ? `${id}-error` : null].filter(Boolean).join(" ") || undefined}
          className={cn(
            "h-14 min-w-0 flex-1 rounded-xl border bg-background px-2 text-center text-3xl font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60 sm:h-12 sm:text-2xl",
            shownError ? "border-destructive" : "border-input",
          )}
          onChange={(e) => {
            setDraftText(e.target.value);
            const parsed = parseTyped(e.target.value, bounds);
            if (parsed.kind !== "invalid") onSet(parsed.kind === "empty" ? null : parsed.value);
          }}
          onBlur={(e) => commitText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" && canPlus) {
              e.preventDefault();
              setDraftText(null);
              onIncrement();
            } else if (e.key === "ArrowDown" && canMinus) {
              e.preventDefault();
              setDraftText(null);
              onDecrement();
            } else if (e.key === "Enter") {
              commitText((e.target as HTMLInputElement).value);
            }
          }}
          // La rueda del mouse NUNCA cambia el número (en XCRM pasaba sin querer al hacer scroll).
          onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
        />
        <button
          type="button"
          aria-label={step > 1 ? `Sumar ${step} a ${named}` : `Sumar uno a ${named}`}
          disabled={!canPlus}
          className={buttonClass}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            startHold(1);
          }}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onPointerCancel={stopHold}
          onClick={(e) => {
            if (e.detail === 0 && canPlus) {
              setDraftText(null);
              onIncrement();
            }
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <Plus className="h-6 w-6" aria-hidden />
        </button>
      </div>
      {shownError && (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {shownError}
        </p>
      )}
    </div>
  );
}
