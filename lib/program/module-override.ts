// @plantilla-quitar(servicios)
/**
 * Abrir, cerrar o programar un módulo para UNA persona desde la ficha del servicio (00503), puro.
 *
 * - `moduleTargetOptions`: qué se puede elegir en «Se abre al completar algo» para la regla propia de un módulo. Son
 *   las mismas opciones que el editor del programa (`unlockTargetOptions`), con el módulo raíz de cada clase para no
 *   ofrecer «al completar» el propio módulo ni algo que cuelga de él.
 * - `overrideRuleFromForm`: lo que se guarda a partir del formulario de «Programar…».
 */
import type { PickerVariant } from "@/lib/services/service-picker";
import type { ProgramRow } from "./tree";
import { unlockTargetOptions, type UnlockTargetOption } from "./unlock-targets";
import { OVERRIDE_RULE_TYPES, type UnlockRule } from "./unlock";

export interface ModuleTargetOptions {
  journey: UnlockTargetOption[];
  program: Array<UnlockTargetOption & { moduleId: string | null }>;
}

export function moduleTargetOptions(rows: readonly ProgramRow[], variants: readonly PickerVariant[]): ModuleTargetOptions {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const rootOf = (id: string): string | null => {
    let cur = byId.get(id);
    for (let i = 0; cur && i < 20; i++) {
      if (cur.kind === "module") return cur.id;
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return null;
  };
  const all = unlockTargetOptions({ rows, variants, selfId: "" });
  return { journey: all.journey, program: all.program.map((o) => ({ ...o, moduleId: rootOf(o.id) })) };
}

/** Las opciones para un módulo: sin él ni lo que cuelga de él. */
export function targetsForModule(options: ModuleTargetOptions, moduleId: string): { journey: UnlockTargetOption[]; program: UnlockTargetOption[] } {
  return { journey: options.journey, program: options.program.filter((o) => o.moduleId !== moduleId) };
}

export interface OverrideForm {
  type: string;
  date: string;
  days: string;
  target: string;
  display: string;
  text: string;
}

/** La regla propia que sale del formulario (la valida `unlockRuleProblems` y, después, la base). */
export function overrideRuleFromForm(f: OverrideForm): UnlockRule {
  const rule: UnlockRule = { type: (OVERRIDE_RULE_TYPES as readonly string[]).includes(f.type) ? f.type : "" };
  if (f.type === "fixed_date") rule.date = f.date || null;
  if (f.type === "days_after_start") rule.days = f.days.trim() === "" ? null : Number(f.days);
  if (f.type === "after_complete") {
    const i = f.target.indexOf(":");
    if (i > 0) Object.assign(rule, { target: f.target.slice(0, i), id: f.target.slice(i + 1) });
  }
  if (["locked", "coming_soon", "hidden"].includes(f.display)) rule.display = f.display as UnlockRule["display"];
  const text = f.text.trim();
  const comingSoon = f.display === "coming_soon" || (f.type === "fixed_date" && !f.display);
  if (text && f.display !== "hidden") {
    if (comingSoon) rule.coming_soon_text = text;
    else rule.locked_text = text;
  }
  return rule;
}

/** El formulario de «Programar…» con la regla propia que ya tiene (o vacío). */
export function overrideFormOf(rule: UnlockRule | null | undefined): OverrideForm {
  const r = rule ?? {};
  return {
    type: r.type && (OVERRIDE_RULE_TYPES as readonly string[]).includes(r.type) ? r.type : "fixed_date",
    date: r.date ?? "",
    days: typeof r.days === "number" ? String(r.days) : "",
    target: r.type === "after_complete" && r.id ? `${r.target ?? "journey_item"}:${r.id}` : "",
    display: r.display ?? "",
    text: (r.display === "coming_soon" ? r.coming_soon_text : r.locked_text) ?? r.locked_text ?? r.coming_soon_text ?? "",
  };
}
