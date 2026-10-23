"use client";

/**
 * Las variables disponibles como fichas que se tocan para insertarlas (`{{contact.display_name}}`). Las arma el panel
 * lateral con `pickerVariables` (lib/flow-engine/variable-catalog.ts): solo las que de verdad se resuelven en este paso.
 */
export function VariableChips({
  variables,
  onInsert,
  hint = "Tocá una variable para agregarla.",
}: {
  variables?: string[];
  onInsert: (token: string) => void;
  hint?: string;
}) {
  if (!variables || variables.length === 0) return null;
  return (
    <div className="mt-1.5">
      <p className="text-[11px] text-muted-foreground/70">{hint}</p>
      <div className="mt-1 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
        {variables.map((variable) => (
          <button
            key={variable}
            type="button"
            onClick={() => onInsert(`{{${variable}}}`)}
            className="rounded px-1.5 py-0.5 font-mono text-[11px] font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
          >
            {`{{${variable}}}`}
          </button>
        ))}
      </div>
    </div>
  );
}
