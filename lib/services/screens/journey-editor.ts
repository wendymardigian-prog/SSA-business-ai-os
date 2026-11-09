// @plantilla-quitar(servicios)
/**
 * El editor del Camino del cliente (F32): operaciones puras sobre la plantilla. Cada una devuelve una plantilla
 * NUEVA (nunca cambia la que recibe) y conserva las claves: una fase o un paso nunca cambia de clave al moverse o
 * renombrarse (los servicios que ya existen y los workflows los reconocen por su clave).
 *
 * El componente solo compone estas funciones; guardar manda la plantilla entera con su `rev`.
 */
import {
  newJourneyKey,
  validateJourneyTemplate,
  type JourneyContext,
  type JourneyItem,
  type JourneyPhase,
  type JourneyTemplate,
} from "../journey-template";
import type { ItemKind } from "../availability";

const clone = (t: JourneyTemplate): JourneyTemplate => ({ ...t, phases: t.phases.map((ph) => ({ ...ph, items: [...ph.items] })) });

function uniqueKey(t: JourneyTemplate, prefix: "ph" | "it", random: () => number): string {
  const used = new Set<string>([...t.phases.map((p) => p.key), ...t.phases.flatMap((p) => p.items.map((i) => i.key))]);
  for (let i = 0; i < 50; i++) {
    const k = newJourneyKey(prefix, random);
    if (!used.has(k)) return k;
  }
  throw new Error("no pude armar una clave nueva");
}

const clampIndex = (i: number, len: number) => Math.max(0, Math.min(len, i));

export function addPhase(t: JourneyTemplate, name: string, random: () => number = Math.random): { template: JourneyTemplate; key: string } {
  const next = clone(t);
  const key = uniqueKey(next, "ph", random);
  next.phases.push({ key, name: name.trim() || "Nueva fase", advance: "auto", items: [] });
  return { template: next, key };
}

export function updatePhase(t: JourneyTemplate, key: string, patch: Partial<Omit<JourneyPhase, "key" | "items">>): JourneyTemplate {
  const next = clone(t);
  next.phases = next.phases.map((ph) => (ph.key === key ? { ...ph, ...patch, key: ph.key, items: ph.items } : ph));
  return next;
}

/** Borra una fase y sus pasos. Los plazos de otros pasos que dependían de ellos se quitan (y se avisa). */
export function removePhase(t: JourneyTemplate, key: string): { template: JourneyTemplate; clearedDue: string[] } {
  const gone = new Set(t.phases.find((p) => p.key === key)?.items.map((i) => i.key) ?? []);
  const next = clone(t);
  next.phases = next.phases.filter((ph) => ph.key !== key);
  return clearDanglingDue(next, gone);
}

/** Mueve una fase a la posición `to` (0 = primera). */
export function movePhase(t: JourneyTemplate, key: string, to: number): JourneyTemplate {
  const from = t.phases.findIndex((p) => p.key === key);
  if (from < 0) return t;
  const next = clone(t);
  const [ph] = next.phases.splice(from, 1);
  next.phases.splice(clampIndex(to, next.phases.length), 0, ph);
  return next;
}

export function addItem(
  t: JourneyTemplate,
  phaseKey: string,
  kind: ItemKind,
  name: string,
  random: () => number = Math.random,
): { template: JourneyTemplate; key: string } {
  const next = clone(t);
  const key = uniqueKey(next, "it", random);
  const ph = next.phases.find((p) => p.key === phaseKey);
  if (!ph) return { template: t, key: "" };
  ph.items.push({ key, kind, name: name.trim() || "Nuevo paso", required: true });
  return { template: next, key };
}

export function updateItem(t: JourneyTemplate, key: string, patch: Partial<Omit<JourneyItem, "key">>): JourneyTemplate {
  const next = clone(t);
  for (const ph of next.phases) ph.items = ph.items.map((it) => (it.key === key ? { ...it, ...patch, key: it.key } : it));
  return next;
}

export function removeItem(t: JourneyTemplate, key: string): { template: JourneyTemplate; clearedDue: string[] } {
  const next = clone(t);
  for (const ph of next.phases) ph.items = ph.items.filter((it) => it.key !== key);
  return clearDanglingDue(next, new Set([key]));
}

/** Mueve un paso a la fase `toPhase`, en la posición `to` de esa fase. */
export function moveItem(t: JourneyTemplate, key: string, toPhase: string, to: number): JourneyTemplate {
  const next = clone(t);
  let moved: JourneyItem | undefined;
  for (const ph of next.phases) {
    const i = ph.items.findIndex((it) => it.key === key);
    if (i >= 0) [moved] = ph.items.splice(i, 1);
  }
  const dest = next.phases.find((p) => p.key === toPhase);
  if (!moved || !dest) return t;
  dest.items.splice(clampIndex(to, dest.items.length), 0, moved);
  return next;
}

/** Subir o bajar un lugar (los botones y Alt+↑/↓, la alternativa a arrastrar). Un paso cruza a la fase vecina. */
export function nudgeItem(t: JourneyTemplate, key: string, delta: -1 | 1): JourneyTemplate {
  const pi = t.phases.findIndex((p) => p.items.some((it) => it.key === key));
  if (pi < 0) return t;
  const ii = t.phases[pi].items.findIndex((it) => it.key === key);
  const target = ii + delta;
  if (target >= 0 && target < t.phases[pi].items.length) return moveItem(t, key, t.phases[pi].key, target);
  const neighbor = t.phases[pi + delta];
  if (!neighbor) return t;
  return moveItem(t, key, neighbor.key, delta === 1 ? 0 : neighbor.items.length);
}

export function nudgePhase(t: JourneyTemplate, key: string, delta: -1 | 1): JourneyTemplate {
  const i = t.phases.findIndex((p) => p.key === key);
  if (i < 0 || i + delta < 0 || i + delta >= t.phases.length) return t;
  return movePhase(t, key, i + delta);
}

function clearDanglingDue(t: JourneyTemplate, gone: Set<string>): { template: JourneyTemplate; clearedDue: string[] } {
  const cleared: string[] = [];
  for (const ph of t.phases) {
    ph.items = ph.items.map((it) => {
      if (it.due_rule?.from === "item_completed" && it.due_rule.item_key && gone.has(it.due_rule.item_key)) {
        cleared.push(it.name);
        return { ...it, due_rule: null };
      }
      return it;
    });
  }
  return { template: t, clearedDue: cleared };
}

/** «Semáforo si se vence» del paso (F24) como formulario: dos campos opcionales. */
export interface ItemLightForm {
  yellow: string;
  red: string;
}
export function itemLightForm(item: JourneyItem): ItemLightForm {
  return {
    yellow: item.light?.yellow_after_days == null ? "" : String(item.light.yellow_after_days),
    red: item.light?.red_after_days == null ? "" : String(item.light.red_after_days),
  };
}
export function toItemLight(f: ItemLightForm): JourneyItem["light"] {
  const parse = (v: string) => (v.trim() === "" ? null : Number(v.trim()));
  const yellow = parse(f.yellow);
  const red = parse(f.red);
  if (yellow === null && red === null) return null;
  return { yellow_after_days: yellow, red_after_days: red };
}

/** El semáforo del paso solo se ofrece si el paso tiene plazo o se repite. */
export function itemLightAvailable(item: JourneyItem): boolean {
  return item.due_rule != null || item.recurrence != null;
}

/** Los problemas antes de guardar: los mismos textos que va a dar la base (gemela). */
export function journeyEditorIssues(t: JourneyTemplate, ctx: JourneyContext = {}): string[] {
  return validateJourneyTemplate(t, ctx);
}

/** Los pasos anteriores a uno (para «Plazo: N días después de completar…»). */
export function itemsBefore(t: JourneyTemplate, key: string): JourneyItem[] {
  const out: JourneyItem[] = [];
  for (const ph of t.phases) {
    for (const it of ph.items) {
      if (it.key === key) return out;
      out.push(it);
    }
  }
  return out;
}

/** «4 fases · 17 pasos · 84 días» o «Sin camino». */
export function journeySummaryText(t: JourneyTemplate | null | undefined): string {
  const phases = t?.phases ?? [];
  if (phases.length === 0) return "Sin camino";
  const items = phases.reduce((n, ph) => n + ph.items.length, 0);
  const days = phases.every((ph) => Number.isInteger(ph.duration_days)) ? phases.reduce((n, ph) => n + (ph.duration_days as number), 0) : null;
  const parts = [`${phases.length} ${phases.length === 1 ? "fase" : "fases"}`, `${items} ${items === 1 ? "paso" : "pasos"}`];
  if (days !== null) parts.push(`${days} ${days === 1 ? "día" : "días"}`);
  return parts.join(" · ");
}
