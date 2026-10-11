"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, ChevronDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { SALES_TYPES, activeWeight, uniqueKey, validateRubric, type Criterion, type Rubric, type SalesType } from "@/lib/calls/rubric";
import { inputClass } from "@/components/agents/fields";

/**
 * La rubrica del analisis (F19): criterios del closer y del lead, con la suma
 * de pesos siempre a la vista. No guarda: el padre decide cuando (junto con el
 * resto de la configuracion). Los pesos son del negocio: no hay una rubrica
 * "correcta" fija, solo una que tiene que sumar 100 en cada lado.
 */
export function RubricEditor({ value, onChange, readOnly }: { value: Rubric; onChange: (next: Rubric) => void; readOnly: boolean }) {
  const problems = validateRubric(value);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Column side="closer" title="Closer" list={value.closer} readOnly={readOnly} onChange={(closer) => onChange({ ...value, closer })} />
        <Column side="lead" title="Lead (creencias)" list={value.lead} readOnly={readOnly} onChange={(lead) => onChange({ ...value, lead })} />
      </div>
      {problems.length > 0 && (
        <ul role="alert" className="list-disc space-y-0.5 pl-5 text-xs text-amber-800 dark:text-amber-300">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Column({ side, title, list, readOnly, onChange }: { side: "closer" | "lead"; title: string; list: Criterion[]; readOnly: boolean; onChange: (next: Criterion[]) => void }) {
  const total = activeWeight(list);
  const ok = total === 100;
  const [open, setOpen] = useState<string | null>(null);

  const update = (clave: string, patch: Partial<Criterion>) => onChange(list.map((c) => (c.clave === clave ? { ...c, ...patch } : c)));
  const add = () => {
    const nombre = side === "closer" ? "Nuevo criterio" : "Nueva creencia";
    const clave = uniqueKey(nombre, list.map((c) => c.clave));
    onChange([...list, { clave, nombre, peso: 0, ...(side === "closer" ? { aplica_a: [...SALES_TYPES] } : {}), niveles: {} }]);
    setOpen(clave);
  };

  return (
    <section aria-label={`Rúbrica: ${title}`} className="rounded-xl border border-border">
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h4 className="text-xs font-semibold">{title}</h4>
        <span
          className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", ok ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300" : "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200")}
          role="status"
        >
          {ok ? "Suma 100 ✓" : `Suma ${total}: ${total < 100 ? `faltan ${Math.round((100 - total) * 100) / 100}` : `sobran ${Math.round((total - 100) * 100) / 100}`}`}
        </span>
      </header>
      <ul className="divide-y divide-border">
        {list.map((c) => {
          const expanded = open === c.clave;
          return (
            <li key={c.clave} className={cn("px-3 py-2", c.archivado && "opacity-60")}>
              <div className="flex items-center gap-2">
                <input
                  aria-label={`Nombre del criterio ${c.nombre}`}
                  value={c.nombre}
                  disabled={readOnly}
                  onChange={(e) => update(c.clave, { nombre: e.target.value })}
                  className={cn(inputClass, "min-w-0 flex-1 py-1.5")}
                />
                <input
                  aria-label={`Peso de ${c.nombre}`}
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={c.peso}
                  disabled={readOnly || c.archivado}
                  onChange={(e) => update(c.clave, { peso: Number(e.target.value) || 0 })}
                  className={cn(inputClass, "w-20 py-1.5 text-right")}
                />
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : c.clave)}
                  aria-expanded={expanded}
                  aria-label={`Detalles de ${c.nombre}`}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"
                >
                  <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} aria-hidden />
                </button>
              </div>
              {expanded && (
                <div className="mt-3 space-y-3 text-xs">
                  {side === "closer" && (
                    <fieldset disabled={readOnly || c.archivado}>
                      <legend className="font-semibold">Aplica a</legend>
                      <div className="mt-1 flex flex-wrap gap-3">
                        {SALES_TYPES.map((t) => {
                          const on = c.aplica_a?.includes(t) ?? false;
                          return (
                            <label key={t} className="flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => update(c.clave, { aplica_a: on ? (c.aplica_a ?? []).filter((x) => x !== t) : ([...(c.aplica_a ?? []), t] as SalesType[]) })}
                              />
                              {t}
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  )}
                  {(["1", "3", "5"] as const).map((n) => (
                    <label key={n} className="block">
                      <span className="font-semibold">
                        {side === "lead" ? ({ "1": "Débil (1)", "3": "Parcial (3)", "5": "Firme (5)" } as const)[n] : `Nivel ${n}`}
                      </span>
                      <textarea
                        value={c.niveles?.[n] ?? ""}
                        disabled={readOnly || c.archivado}
                        onChange={(e) => update(c.clave, { niveles: { ...c.niveles, [n]: e.target.value } })}
                        rows={2}
                        className={cn(inputClass, "mt-1 resize-y text-xs")}
                      />
                    </label>
                  ))}
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => update(c.clave, { archivado: !c.archivado })}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-medium hover:bg-accent"
                    >
                      {c.archivado ? <ArchiveRestore className="h-3.5 w-3.5" aria-hidden /> : <Archive className="h-3.5 w-3.5" aria-hidden />}
                      {c.archivado ? "Volver a activar" : "Archivar (deja de puntuar)"}
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {!readOnly && (
        <div className="border-t border-border px-3 py-2">
          <button type="button" onClick={add} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <Plus className="h-3.5 w-3.5" aria-hidden /> {side === "closer" ? "Agregar criterio" : "Agregar creencia"}
          </button>
        </div>
      )}
    </section>
  );
}
