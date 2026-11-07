/**
 * Aplica un parche de la IA sobre un documento (F32, F34).
 *
 * El parche son cambios por página (`pages[].ops`: add, update, remove,
 * reorder), más páginas nuevas y páginas quitadas. Esta función NO valida el
 * documento resultante (eso lo hace `parseDesignDoc` después de normalizar):
 * solo se asegura de que cada operación apunte a algo que existe.
 *
 * Reglas que acá son ley:
 *   - los índices de página del parche son los del documento ORIGINAL;
 *   - un `update` nunca cambia el `id` ni el `type` de un elemento;
 *   - «Agregá 2 láminas» agrega ANTES de la última si la última es el llamado
 *     a la acción (jamás empuja el cierre hacia el medio);
 *   - el máximo es de 20 páginas y una página web tiene una sola.
 *
 * Módulo puro. No modifica lo que recibe.
 */

import { MAX_PAGES } from "../formats";
import { newId, type DesignDoc, type DesignPage } from "../doc/schema";
import type { AiElement, AiPage, DesignPatch, PatchOp } from "./schema";

export type ApplyResult = { ok: true; doc: DesignDoc } | { ok: false; problems: string[] };

type Page = DesignPage;
type Element = DesignPage["elements"][number];

const CTA_WORDS =
  /\b(segu[ií]|sigu[eé]|segu[ií]me|guard[aá]|coment[aá]|escrib[ií]me|escrib[ií]nos|contact[aá]|reserv[aá]|agend[aá]|descarg[aá]|suscrib[ií]|inscrib[ií]|mand[aá]me|mand[aá]nos|link en (la )?bio|registrate|sumate|compart[ií]|escribinos|empez[aá]|quiero|dm)\b/i;
const CTA_NAME = /(cta|llamado|cierre|final)/i;

/** Si la última página es el llamado a la acción (por su nombre o por sus textos). */
export function lastPageIsCta(doc: DesignDoc): boolean {
  if (doc.pages.length < 2) return false;
  const last = doc.pages[doc.pages.length - 1];
  if (last.name && CTA_NAME.test(last.name)) return true;
  const text = last.elements.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join(" ");
  return CTA_WORDS.test(text);
}

/** Convierte un elemento de la IA en uno del documento (el id y los valores finales los termina `normalizeDoc`). */
function asElement(el: AiElement): Element {
  return { ...el, id: el.id ?? newId("el") } as Element;
}

function asPage(page: AiPage): Page {
  return {
    ...page,
    id: page.id ?? newId("pg"),
    elements: page.elements.map(asElement),
  } as Page;
}

function applyOps(page: Page, ops: readonly PatchOp[], problems: string[], where: string): void {
  for (const op of ops) {
    if (op.op === "add") {
      const el = asElement(op.element);
      if (page.elements.some((e) => e.id === el.id)) el.id = newId("el");
      const at = op.at === undefined ? page.elements.length : Math.min(Math.max(op.at, 0), page.elements.length);
      page.elements.splice(at, 0, el);
    } else if (op.op === "update") {
      const idx = page.elements.findIndex((e) => e.id === op.id);
      if (idx < 0) {
        problems.push(`${where}: no existe el elemento ${op.id}`);
        continue;
      }
      const { id: _id, type: _type, ...rest } = op.set;
      void _id;
      void _type;
      if (page.elements[idx].type === "html" && ("html" in rest || "css" in rest)) {
        problems.push(`${where}: el HTML cargado no se edita desde la IA`);
        continue;
      }
      page.elements[idx] = { ...page.elements[idx], ...rest } as Element;
    } else if (op.op === "remove") {
      const idx = page.elements.findIndex((e) => e.id === op.id);
      if (idx < 0) {
        problems.push(`${where}: no existe el elemento ${op.id} para quitarlo`);
        continue;
      }
      page.elements.splice(idx, 1);
    } else if (op.op === "reorder") {
      const byId = new Map(page.elements.map((e) => [e.id, e]));
      const missing = op.ids.filter((id) => !byId.has(id));
      if (missing.length) {
        problems.push(`${where}: el orden nombra elementos que no existen (${missing.slice(0, 3).join(", ")})`);
        continue;
      }
      const listed = op.ids.filter((id, i) => op.ids.indexOf(id) === i);
      const rest = page.elements.filter((e) => !listed.includes(e.id));
      page.elements = [...listed.map((id) => byId.get(id) as Element), ...rest];
    }
  }
}

/** Aplica el parche. Devuelve el documento nuevo o los problemas (nada se aplica a medias). */
export function applyPatch(doc: DesignDoc, patch: DesignPatch): ApplyResult {
  const problems: string[] = [];
  const work: Page[] = structuredClone(doc.pages);
  const original = [...work];

  const seen = new Set<number>();
  for (const entry of patch.pages) {
    const page = original[entry.index];
    const where = `Página ${entry.index + 1}`;
    if (!page) {
      problems.push(`${where}: no existe`);
      continue;
    }
    if (seen.has(entry.index)) {
      problems.push(`${where}: aparece dos veces en el parche`);
      continue;
    }
    seen.add(entry.index);
    if (entry.name !== undefined) page.name = entry.name;
    if (entry.background !== undefined) page.background = entry.background as Page["background"];
    if (entry.height !== undefined) page.height = entry.height;
    applyOps(page, entry.ops, problems, where);
  }

  const removed = new Set<number>();
  for (const index of patch.removePages ?? []) {
    if (!original[index]) problems.push(`Página ${index + 1}: no existe, no se puede quitar`);
    else removed.add(index);
  }
  if (removed.size >= original.length && !(patch.newPages?.length)) problems.push("No se pueden quitar todas las páginas");

  if (doc.format === "web" && (removed.size > 0 || (patch.newPages?.length ?? 0) > 0)) {
    problems.push("Una página web tiene una sola página: no se agregan ni se quitan");
  }

  let pages = work.filter((_, i) => !removed.has(i));
  if (problems.length === 0 && patch.newPages?.length) {
    const ctaLast = lastPageIsCta({ ...doc, pages: pages });
    // Cuántas páginas nuevas ya se pusieron detrás de cada ancla, para mantener su orden.
    const placed = new Map<Page, number>();
    for (const entry of patch.newPages) {
      const page = asPage(entry.page);
      const anchor = entry.after !== undefined && entry.after >= 0 && !removed.has(entry.after) ? original[entry.after] : undefined;
      let at: number;
      if (entry.after !== undefined && entry.after < 0) at = 0;
      else if (anchor) at = pages.indexOf(anchor) + 1 + (placed.get(anchor) ?? 0);
      else at = ctaLast ? pages.length - 1 : pages.length;
      // Nunca detrás del cierre: el llamado a la acción queda siempre de última.
      if (ctaLast && at > pages.length - 1) at = pages.length - 1;
      pages.splice(at, 0, page);
      if (anchor) placed.set(anchor, (placed.get(anchor) ?? 0) + 1);
    }
  }

  if (pages.length === 0) problems.push("El diseño necesita al menos una página");
  if (pages.length > MAX_PAGES) problems.push(`El diseño admite hasta ${MAX_PAGES} páginas`);
  if (problems.length) return { ok: false, problems: [...new Set(problems)] };
  return { ok: true, doc: { ...doc, pages } };
}

/** Los índices (en el documento nuevo) de las páginas que cambiaron o son nuevas. */
export function changedPageIndexes(before: DesignDoc, after: DesignDoc): number[] {
  const old = new Map(before.pages.map((p) => [p.id, JSON.stringify(p)]));
  const out: number[] = [];
  after.pages.forEach((page, i) => {
    if (old.get(page.id) !== JSON.stringify(page)) out.push(i);
  });
  return out;
}

/** Cuántas páginas se quitaron al pasar de un documento a otro. */
export function removedPageCount(before: DesignDoc, after: DesignDoc): number {
  const ids = new Set(after.pages.map((p) => p.id));
  return before.pages.filter((p) => !ids.has(p.id)).length;
}

const listPages = (pages: number[]): string => {
  const names = pages.map((p) => String(p + 1));
  if (names.length === 1) return `la página ${names[0]}`;
  return `las páginas ${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
};

/** «Cambió la página 3», «Agregó 2 páginas», «Cambió todas las páginas»: qué hizo la respuesta, en una línea. */
export function describeChange(before: DesignDoc, after: DesignDoc): string | null {
  const beforeIds = new Set(before.pages.map((p) => p.id));
  const added = after.pages.filter((p) => !beforeIds.has(p.id)).length;
  const removed = removedPageCount(before, after);
  const changed = changedPageIndexes(before, after).filter((i) => beforeIds.has(after.pages[i].id));
  const parts: string[] = [];
  if (added > 0) parts.push(added === 1 ? "Agregó 1 página" : `Agregó ${added} páginas`);
  if (removed > 0) parts.push(removed === 1 ? "Quitó 1 página" : `Quitó ${removed} páginas`);
  if (changed.length > 0) {
    const survivors = after.pages.filter((p) => beforeIds.has(p.id)).length;
    parts.push(changed.length === survivors && survivors > 1 ? "Cambió todas las páginas" : `Cambió ${listPages(changed)}`);
  }
  return parts.length ? parts.join(" · ") : null;
}
