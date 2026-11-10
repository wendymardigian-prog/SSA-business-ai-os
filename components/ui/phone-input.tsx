"use client";

import { useState } from "react";
import { PHONE_COUNTRIES } from "@/lib/scheduling/phone-countries";
import { OTHER_COUNTRY, joinPhone, splitPhone } from "@/lib/phone-input";
import { flagOf } from "@/lib/phone-country";
import { cn } from "@/lib/utils";

/**
 * Un teléfono: selector de país (con su prefijo) + el número. Es el único campo de teléfono del panel: siempre con
 * país. Lo que avisa (`onChange`) es `+<dígitos>` listo para guardar, o "" si está vacío; validar sigue siendo cosa de
 * quien lo usa. Un número de un país que no está en la lista se muestra en «Otro», entero.
 *
 * `onBlur` avisa cuando el foco sale del campo entero (país + número), para los campos que guardan al salir.
 */
export function PhoneInput({
  id,
  value,
  onChange,
  onBlur,
  defaultCountry,
  disabled = false,
  invalid = false,
  describedBy,
  placeholder = "Número",
  autoFocus,
  className,
  size = "md",
  label = "Teléfono",
  selectClassName,
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  /** El país con el que arranca un campo vacío (por ejemplo, el de la zona horaria del negocio). */
  defaultCountry?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  size?: "sm" | "md";
  /** Nombre accesible del número (el del país es «País de …»). */
  label?: string;
  /** Para darle otro ancho al selector de país (por defecto, angosto). */
  selectClassName?: string;
}) {
  const [parts, setParts] = useState(() => splitPhone(value, defaultCountry));
  const [seen, setSeen] = useState(value);
  // Si el valor cambia desde afuera (deshacer, recargar), el campo lo sigue. Se ajusta en el render, no en un efecto.
  if (value !== seen) {
    setSeen(value);
    if (value !== joinPhone(parts.country, parts.number)) setParts(splitPhone(value, defaultCountry ?? parts.country));
  }

  function update(next: { country: string; number: string }) {
    setParts(next);
    const joined = joinPhone(next.country, next.number);
    setSeen(joined);
    onChange(joined);
  }

  const height = size === "sm" ? "h-8" : "h-9";
  return (
    <div
      className={cn("flex gap-2", className)}
      onBlur={(e) => {
        if (onBlur && !e.currentTarget.contains(e.relatedTarget as Node | null)) onBlur();
      }}
    >
      <select
        aria-label={`País de ${label.toLowerCase()}`}
        value={parts.country}
        disabled={disabled}
        onChange={(e) => update({ country: e.target.value, number: parts.number })}
        className={cn("w-32 shrink-0 rounded-lg border border-border bg-background px-2 text-sm text-foreground", height, selectClassName)}
      >
        {PHONE_COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {/* El prefijo adelante: el selector es angosto y lo que importa ver es el código. */}
            {flagOf(c.code)} +{c.dial} {c.label}
          </option>
        ))}
        <option value={OTHER_COUNTRY}>🌐 Otro país (con +)</option>
      </select>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        aria-label={id ? undefined : label}
        value={parts.number}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={parts.country === OTHER_COUNTRY ? "+81 90 1234 5678" : placeholder}
        onChange={(e) => update({ country: parts.country, number: e.target.value })}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cn("min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground disabled:opacity-60", height)}
      />
    </div>
  );
}
