"use client";

import { useId, useRef, type ReactNode } from "react";

/**
 * Pestañas accesibles: `role="tablist"`, flechas para pasar de una a otra
 * (Home y End saltan a los extremos) y el panel enlazado con `aria-controls`.
 *
 * Se usa asi: el padre guarda cual esta elegida y dibuja el contenido de esa;
 * `Tabs` solo dibuja la tira y el envoltorio del panel.
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  children,
}: {
  tabs: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  /** El nombre de la tira para el lector de pantalla. */
  label: string;
  /** El contenido de la pestaña elegida. */
  children: ReactNode;
}) {
  const base = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (index: number) => {
    const next = (index + tabs.length) % tabs.length;
    onChange(tabs[next].value);
    refs.current[next]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (event.key === "ArrowRight") select(index + 1);
    else if (event.key === "ArrowLeft") select(index - 1);
    else if (event.key === "Home") select(0);
    else if (event.key === "End") select(tabs.length - 1);
    else return;
    event.preventDefault();
  };

  const active = tabs.findIndex((t) => t.value === value);

  return (
    <div>
      <div role="tablist" aria-label={label} className="mb-3 inline-flex rounded-lg bg-muted p-1">
        {tabs.map((tab, index) => {
          const selected = tab.value === value;
          return (
            <button
              key={tab.value}
              ref={(el) => {
                refs.current[index] = el;
              }}
              id={`${base}-tab-${tab.value}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${base}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                selected ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-tab-${tabs[Math.max(active, 0)].value}`}>
        {children}
      </div>
    </div>
  );
}
