// @plantilla-quitar(servicios)
/**
 * El editor del Camino del cliente (F32): operaciones puras sobre la plantilla. Cada una devuelve una plantilla
 * NUEVA (nunca cambia la que recibe) y conserva las claves: una fase o un paso nunca cambia de clave al moverse o
 * renombrarse (los servicios que ya existen y los workflows los reconocen por su clave).
 *
 * El componente solo compone estas funciones; guardar manda la plantilla entera con su `rev`.
 */
import {
  LINK_BUTTON_KINDS,
  SHOW_RESPONSE_KINDS,
  newJourneyKey,
  validateJourneyTemplate,
  type JourneyContext,
  type JourneyItem,
  type JourneyPhase,
  type JourneyTemplate,
} from "../journey-template";
import type { ItemKind } from "../availability";

const clone = (t: JourneyTemplate): JourneyTemplate => ({ ...t, phases: t.phases.map((ph) => ({ ...ph, items: [...ph.items] })) });

function uniqueKey(t: JourneyTemplate, prefix: "ph" | "it", random: () => number, extra: Set<string> = new Set()): string {
  const used = new Set<string>([...extra, ...t.phases.map((p) => p.key), ...t.phases.flatMap((p) => p.items.map((i) => i.key))]);
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
  ph.items.push({ key, kind, name: name.trim() || "Nuevo paso", required: true, ...(BUTTON_ON_BY_DEFAULT.includes(kind) ? { portal_button: true } : {}) });
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

/**
 * Duplicar (A4, F149). La copia va justo después del original, con claves NUEVAS (nunca reusa una: los servicios y
 * los workflows reconocen cada paso por su clave). Dentro de una fase copiada, el plazo y el bloqueo que apuntan a un
 * paso de esa misma fase apuntan a su copia. `keyMap` (original → copia) sirve para copiar los workflows.
 */
export function duplicateItem(t: JourneyTemplate, key: string, random: () => number = Math.random): { template: JourneyTemplate; key: string; keyMap: Record<string, string> } {
  const next = clone(t);
  for (const ph of next.phases) {
    const i = ph.items.findIndex((it) => it.key === key);
    if (i < 0) continue;
    const newKey = uniqueKey(next, "it", random);
    const orig = ph.items[i];
    ph.items.splice(i + 1, 0, { ...structuredClone(orig), key: newKey, name: copyName(orig.name) });
    return { template: next, key: newKey, keyMap: { [key]: newKey } };
  }
  return { template: t, key: "", keyMap: {} };
}

export function duplicatePhase(t: JourneyTemplate, key: string, random: () => number = Math.random): { template: JourneyTemplate; key: string; keyMap: Record<string, string> } {
  const idx = t.phases.findIndex((p) => p.key === key);
  if (idx < 0) return { template: t, key: "", keyMap: {} };
  const next = clone(t);
  const orig = next.phases[idx];
  const keyMap: Record<string, string> = {};
  const extra = new Set<string>();
  const newPhaseKey = uniqueKey(next, "ph", random, extra);
  extra.add(newPhaseKey);
  for (const it of orig.items) {
    keyMap[it.key] = uniqueKey(next, "it", random, extra);
    extra.add(keyMap[it.key]);
  }
  const remap = (k: string | null | undefined) => (k && keyMap[k]) || k;
  const items = orig.items.map((it) => {
    const copy: JourneyItem = { ...structuredClone(it), key: keyMap[it.key] };
    if (copy.due_rule?.from === "item_completed") copy.due_rule = { ...copy.due_rule, item_key: remap(copy.due_rule.item_key) ?? null };
    const ref = copy.ref as Record<string, unknown> | undefined;
    const lock = ref?.lock as { after_item_key?: string } | undefined;
    if (ref && lock?.after_item_key) copy.ref = { ...ref, lock: { after_item_key: remap(lock.after_item_key) } };
    return copy;
  });
  next.phases.splice(idx + 1, 0, { ...structuredClone({ ...orig, items: [] }), key: newPhaseKey, name: copyName(orig.name), items });
  return { template: next, key: newPhaseKey, keyMap };
}

function copyName(name: string): string {
  return `${name} (copia)`.slice(0, 120);
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
      let out = it;
      if (it.due_rule?.from === "item_completed" && it.due_rule.item_key && gone.has(it.due_rule.item_key)) {
        cleared.push(it.name);
        out = { ...out, due_rule: null };
      }
      // A4: «cuando se complete…» de un paso que ya no está deja de bloquear.
      const lock = (out.ref as Record<string, unknown> | undefined)?.lock as { after_item_key?: string } | undefined;
      if (lock?.after_item_key && gone.has(lock.after_item_key)) {
        const ref = { ...(out.ref as Record<string, unknown>) };
        delete ref.lock;
        if (!cleared.includes(out.name)) cleared.push(out.name);
        out = { ...out, ref };
      }
      return out;
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

// ── El boton del paso en el portal (F125) ──────────────────────────────────
/** En los pasos NUEVOS de estos tipos, «Mostrar el botón en el portal» arranca prendido (los guardados no cambian). */
export const BUTTON_ON_BY_DEFAULT: readonly ItemKind[] = ["form", "survey", "contract", "activity", "quiz", "booking"];

export interface ButtonEditorState {
  /** El interruptor: prendido solo si el cliente ve el paso. */
  on: boolean;
  /** Deshabilitado porque el cliente no ve el paso (con el motivo). */
  disabledReason: string | null;
  label: string;
  url: string;
  /** Este tipo de paso lleva un link pegado (las tareas y la casilla). */
  needsUrl: boolean;
  /** Este tipo de paso tiene «El cliente puede ver su respuesta». */
  hasShowResponse: boolean;
  showResponse: boolean;
}

export function buttonEditorState(item: JourneyItem): ButtonEditorState {
  const ref = (item.ref && typeof item.ref === "object" ? item.ref : {}) as Record<string, unknown>;
  const b = (ref.button && typeof ref.button === "object" ? ref.button : {}) as { label?: unknown; url?: unknown };
  const hidden = item.visible_to_client === false;
  return {
    on: item.portal_button === true && !hidden,
    disabledReason: hidden ? "Para mostrar el botón, el cliente tiene que ver el paso" : null,
    label: typeof b.label === "string" ? b.label : "",
    url: typeof b.url === "string" ? b.url : "",
    needsUrl: LINK_BUTTON_KINDS.includes(item.kind),
    hasShowResponse: SHOW_RESPONSE_KINDS.includes(item.kind),
    showResponse: ref.show_response !== false,
  };
}

/**
 * El cambio de `ref.button` desde el editor. El texto y el link se guardan aunque el boton este apagado (apagar y
 * prender no pierde nada); vacios, la clave se saca. Un `ref.button` sin nada se saca entero.
 */
export function withButton(item: JourneyItem, patch: { label?: string; url?: string }): Record<string, unknown> {
  const ref = { ...((item.ref && typeof item.ref === "object" ? item.ref : {}) as Record<string, unknown>) };
  const b = { ...((ref.button && typeof ref.button === "object" ? ref.button : {}) as Record<string, unknown>) };
  if (patch.label !== undefined) {
    const v = patch.label.replace(/[\r\n]+/g, " ");
    if (v) b.label = v;
    else delete b.label;
  }
  if (patch.url !== undefined) {
    const v = patch.url.trim();
    if (v) b.url = v;
    else delete b.url;
  }
  if (Object.keys(b).length) ref.button = b;
  else delete ref.button;
  return ref;
}

/** Apagar «Lo ve el cliente» apaga el boton (no se puede mostrar el boton de un paso que el cliente no ve). */
export function visibilityPatch(visible: boolean): Partial<JourneyItem> {
  return visible ? { visible_to_client: true } : { visible_to_client: false, portal_button: false };
}
