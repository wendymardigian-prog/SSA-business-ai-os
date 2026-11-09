"use client";

import { Braces } from "lucide-react";
import { Popover } from "@/components/ui/popover";

/** Una variable para insertar: la clave (`contact.first_name`) y, si hay, cómo se llama para la persona. */
export type VariableOption = string | { name: string; label: string };

export function variableName(v: VariableOption): string {
  return typeof v === "string" ? v : v.name;
}

/**
 * El botón «{ } Variable»: abre la lista de variables y la elegida se inserta donde está el cursor. Lo usan el
 * editor con formato (como ficha) y los campos de una línea, como un asunto (como `{{…}}`).
 */
export function VariableMenu({
  variables,
  onPick,
  disabled = false,
  align = "start",
}: {
  variables: readonly VariableOption[];
  onPick: (name: string) => void;
  disabled?: boolean;
  align?: "start" | "end";
}) {
  if (variables.length === 0) return null;
  if (disabled) {
    return (
      <span className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground opacity-50">
        <Braces className="h-3.5 w-3.5" aria-hidden /> Variable
      </span>
    );
  }
  return (
    <Popover
      label="Insertar variable"
      align={align}
      closeOnSelect
      panelClassName="w-64 p-1"
      triggerClassName="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
      trigger={
        <>
          <Braces className="h-3.5 w-3.5" aria-hidden /> Variable
        </>
      }
    >
      <ul className="max-h-64 overflow-y-auto">
        {variables.map((v) => {
          const name = variableName(v);
          return (
            <li key={name}>
              <button
                type="button"
                // mouseDown no le saca el foco (ni la selección) al campo donde se va a insertar.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(name)}
                className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-accent"
              >
                {typeof v === "string" ? (
                  <span className="font-mono text-xs">{`{{${name}}}`}</span>
                ) : (
                  <>
                    <span className="text-sm text-foreground">{v.label}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{`{{${name}}}`}</span>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </Popover>
  );
}
