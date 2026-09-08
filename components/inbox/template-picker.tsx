"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { SearchableTemplate } from "@/lib/templates/search";

/**
 * Selector de respuestas rapidas que aparece al escribir "/" en la bandeja (F17).
 *
 * Es presentacional a proposito: el texto que se busca, la lista ya filtrada y
 * cual esta seleccionado los maneja el composer, porque las flechas y el Enter
 * se tienen que interceptar en el textarea (que es donde esta el foco) antes
 * de que Enter mande el mensaje.
 */

export function TemplatePicker({
  matches,
  activeIndex,
  onPick,
  onHover,
}: {
  matches: SearchableTemplate[];
  activeIndex: number;
  onPick: (template: SearchableTemplate) => void;
  onHover: (index: number) => void;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);

  // Con muchos templates el seleccionado se va abajo del panel; las flechas
  // tienen que arrastrar el scroll con ellas.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <div
      role="listbox"
      aria-label="Respuestas rápidas"
      className="absolute bottom-full left-0 right-0 z-20 mb-2 max-h-64 overflow-auto rounded-lg border border-border bg-background shadow-lg"
    >
      {matches.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted-foreground">
          No hay respuestas rápidas con ese nombre.
        </p>
      ) : (
        <ul>
          {matches.map((template, index) => (
            <li key={template.id}>
              <button
                ref={index === activeIndex ? activeRef : null}
                role="option"
                aria-selected={index === activeIndex}
                // El mousedown adelanta al blur del textarea: con onClick el
                // campo pierde el foco antes de que llegue la eleccion.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(template);
                }}
                onMouseEnter={() => onHover(index)}
                className={cn(
                  "block w-full px-3 py-2 text-left transition-colors",
                  index === activeIndex ? "bg-accent" : "hover:bg-accent/50",
                )}
              >
                <span className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">{template.name}</span>
                  {template.shortcut && (
                    <code className="rounded bg-muted px-1 py-0.5 text-xs text-muted-foreground">
                      {template.shortcut}
                    </code>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {template.content}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground/70">
        ↑↓ para elegir · Enter para insertar · Esc para cerrar
      </p>
    </div>
  );
}
