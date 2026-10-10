"use client";

/**
 * Los interruptores chicos de las tarjetas (Gasto / Alcance / Clics...).
 * Una opcion siempre esta elegida: son botones con `aria-pressed`.
 */

export function PillToggle<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="flex gap-1" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-lg px-2.5 py-1 text-xs transition-colors ${
            value === option.value
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** El mismo interruptor, dentro de una caja gris (placement y detalle). */
export function MiniToggle<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md bg-muted/30 p-0.5" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
            value === option.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
