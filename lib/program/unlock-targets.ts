// @plantilla-quitar(servicios)
/**
 * Qué se puede elegir en «Se abre al completar algo» (regla `after_complete`, lib/program/unlock.ts), puro: un paso
 * del camino de las variantes del producto (se guarda su clave, `target: journey_item`) u otra clase o módulo del
 * programa (se guarda su id, `target: program_item`). En la lista nunca se ve una clave ni un id: el paso con su
 * nombre y las variantes que lo tienen, la clase con su módulo.
 */
import type { PickerVariant } from "@/lib/services/service-picker";
import type { ProgramRow } from "./tree";

export type UnlockTarget = "journey_item" | "program_item";

export interface UnlockTargetOption {
  /** `<target>:<id>`, el valor del `<select>`. */
  value: string;
  target: UnlockTarget;
  id: string;
  label: string;
}

export interface UnlockTargetOptions {
  journey: UnlockTargetOption[];
  program: UnlockTargetOption[];
}

const option = (target: UnlockTarget, id: string, label: string): UnlockTargetOption => ({ value: `${target}:${id}`, target, id, label });

export function unlockTargetOptions(input: { rows: readonly ProgramRow[]; variants: readonly PickerVariant[]; selfId: string }): UnlockTargetOptions {
  // Pasos: una opción por clave, aunque la tengan varias variantes (el desbloqueo mira la clave, sea de la variante que sea).
  const steps = new Map<string, { name: string; variants: string[] }>();
  for (const v of input.variants) {
    for (const ph of v.phases) {
      for (const st of ph.steps) {
        const cur = steps.get(st.key);
        if (cur) {
          if (!cur.variants.includes(v.name)) cur.variants.push(v.name);
        } else steps.set(st.key, { name: st.name, variants: [v.name] });
      }
    }
  }
  const journey = [...steps].map(([key, s]) => option("journey_item", key, `${s.name} · ${s.variants.join(", ")}`));

  // Clases y módulos: en el orden del árbol, sin el propio ni lo que cuelga de él (abrirse al completarse a sí mismo
  // o a un hijo no se cumple nunca), sin archivados.
  const live = input.rows.filter((r) => r.status !== "archived");
  const byId = new Map(live.map((r) => [r.id, r]));
  const children = new Map<string | null, ProgramRow[]>();
  for (const r of live) children.set(r.parent_id, [...(children.get(r.parent_id) ?? []), r]);
  const program: UnlockTargetOption[] = [];
  const walk = (parent: string | null, path: string[]) => {
    const kids = (children.get(parent) ?? []).slice().sort((a, b) => a.position - b.position || a.title.localeCompare(b.title, "es"));
    for (const r of kids) {
      if (r.id === input.selfId) continue;
      const here = [...path, r.title];
      program.push(option("program_item", r.id, here.join(" › ")));
      walk(r.id, here);
    }
  };
  walk(null, []);
  // Un ítem cuyo padre no está (dato raro) no se pierde: va al final con su título.
  for (const r of live) if (r.id !== input.selfId && r.parent_id && !byId.has(r.parent_id) && !program.some((o) => o.id === r.id)) program.push(option("program_item", r.id, r.title));
  return { journey, program };
}

/**
 * El valor guardado de una regla, para el `<select>`. Una regla vieja sin `target` se resuelve: si el id es de una
 * clase o un módulo del programa es `program_item`; si no, la clave de un paso del camino.
 */
export function targetValueOf(rule: { type?: unknown; id?: unknown; target?: unknown } | null | undefined, rows: readonly ProgramRow[]): string {
  if (!rule || rule.type !== "after_complete" || typeof rule.id !== "string" || !rule.id) return "";
  const target: UnlockTarget =
    rule.target === "journey_item" || rule.target === "program_item" ? rule.target : rows.some((r) => r.id === rule.id) ? "program_item" : "journey_item";
  return `${target}:${rule.id}`;
}

export function parseTargetValue(value: string): { target: UnlockTarget; id: string } | null {
  const i = value.indexOf(":");
  if (i < 0) return null;
  const target = value.slice(0, i);
  const id = value.slice(i + 1);
  if ((target !== "journey_item" && target !== "program_item") || !id) return null;
  return { target, id };
}

/** Si lo guardado ya no está en la lista (un paso que se sacó del camino, una clase archivada), cómo mostrarlo. */
export function staleTargetLabel(value: string, options: UnlockTargetOptions): string | null {
  if (!value) return null;
  if ([...options.journey, ...options.program].some((o) => o.value === value)) return null;
  const parsed = parseTargetValue(value);
  return parsed?.target === "program_item" ? "Una clase o un módulo que ya no existe · elegí otro" : "Un paso que ya no está en el camino · elegí otro";
}
