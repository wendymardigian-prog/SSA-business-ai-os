/**
 * Fusionar lo que hizo la IA con lo que tocó la persona mientras tanto (F31).
 *
 * La IA trabaja sobre la versión en la que se le pidió (`base`) y tarda unos
 * segundos. En ese rato la persona puede haber seguido editando (`mine`). Para
 * no pisar nada se fusiona POR ELEMENTO, con tres documentos:
 *
 *   base  lo que vio la IA cuando se le pidió;
 *   mine  lo que hay ahora (con los cambios manuales);
 *   ai    base con el parche de la IA ya aplicado.
 *
 * Regla por elemento (y por fondo, nombre y alto de una página):
 *   - solo cambió la IA            → queda lo de la IA;
 *   - solo cambió la persona       → queda lo de la persona;
 *   - cambiaron los dos de forma distinta → GANA LA PERSONA, y se avisa;
 *   - lo que la IA quitó se quita, salvo que la persona lo haya tocado;
 *   - lo que la IA agregó se agrega; lo que la persona agregó o quitó se respeta.
 *
 * El orden (de páginas y de capas) sigue al de la persona si ella lo movió; si
 * no, al de la IA. Módulo puro.
 */

import type { DesignDoc, DesignElement, DesignPage } from "../doc/schema";

export interface MergeResult {
  doc: DesignDoc;
  /** Elementos (por id) donde la persona y la IA cambiaron lo mismo y se quedó lo de la persona. */
  keptManual: string[];
  /** Lo mismo para fondos y nombres de página: «fondo de la página 2». */
  keptManualPages: string[];
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Ids en el orden de `list`, solo los que están en `keep`. */
const filtered = (list: readonly string[], keep: ReadonlySet<string>): string[] => list.filter((id) => keep.has(id));

/**
 * El orden resultante de una lista de ids: si la persona reordenó (respecto de
 * la base), el suyo; si no, el de la IA. Lo que no está en el esqueleto se
 * inserta detrás de su antecesor en la lista de donde viene.
 */
export function mergeOrder(base: readonly string[], mine: readonly string[], ai: readonly string[], final: ReadonlySet<string>): string[] {
  const commonMine = new Set(mine);
  const commonAi = new Set(ai);
  const baseInMine = filtered(base, commonMine);
  const mineChanged = !same(baseInMine, filtered(mine, new Set(base)));
  const baseInAi = filtered(base, commonAi);
  const aiChanged = !same(baseInAi, filtered(ai, new Set(base)));
  const skeleton = filtered(mineChanged || !aiChanged ? mine : ai, final);
  const inSkeleton = new Set(skeleton);
  const result = [...skeleton];
  const insertFrom = (source: readonly string[], id: string) => {
    const at = source.indexOf(id);
    for (let i = at - 1; i >= 0; i--) {
      const pos = result.indexOf(source[i]);
      if (pos >= 0) {
        result.splice(pos + 1, 0, id);
        return;
      }
    }
    result.unshift(id);
  };
  // Primero lo que agregó la IA (en su orden), después lo que agregó la persona.
  for (const id of ai) {
    if (final.has(id) && !inSkeleton.has(id) && !commonMine.has(id)) {
      insertFrom(ai, id);
      inSkeleton.add(id);
    }
  }
  for (const id of mine) {
    if (final.has(id) && !inSkeleton.has(id)) {
      insertFrom(mine, id);
      inSkeleton.add(id);
    }
  }
  // Lo que queda (en la base y en `final` pero en ninguna lista del esqueleto) va al final.
  for (const id of final) if (!inSkeleton.has(id)) result.push(id);
  return result;
}

function pick<T>(base: T | undefined, mine: T | undefined, ai: T | undefined): { value: T | undefined; conflict: boolean } {
  const mineChanged = !same(base, mine);
  const aiChanged = !same(base, ai);
  if (!mineChanged) return { value: ai, conflict: false };
  if (!aiChanged || same(mine, ai)) return { value: mine, conflict: false };
  return { value: mine, conflict: true };
}

function mergeElements(base: DesignPage, mine: DesignPage, ai: DesignPage, keptManual: string[]): DesignElement[] {
  const b = new Map(base.elements.map((e) => [e.id, e]));
  const m = new Map(mine.elements.map((e) => [e.id, e]));
  const a = new Map(ai.elements.map((e) => [e.id, e]));
  const result = new Map<string, DesignElement>();

  for (const id of new Set([...b.keys(), ...m.keys(), ...a.keys()])) {
    const be = b.get(id);
    const me = m.get(id);
    const ae = a.get(id);
    if (!be) {
      // Nuevo: lo que agregó la IA o la persona (si el mismo id, la persona).
      const chosen = me ?? ae;
      if (chosen) result.set(id, chosen);
      continue;
    }
    if (!me) continue; // la persona lo quitó: queda quitado
    if (!ae) {
      // La IA lo quitó: se quita, salvo que la persona lo haya tocado.
      if (same(be, me)) continue;
      result.set(id, me);
      keptManual.push(id);
      continue;
    }
    const picked = pick(be, me, ae);
    result.set(id, picked.value as DesignElement);
    if (picked.conflict) keptManual.push(id);
  }

  const order = mergeOrder(
    base.elements.map((e) => e.id),
    mine.elements.map((e) => e.id),
    ai.elements.map((e) => e.id),
    new Set(result.keys()),
  );
  return order.map((id) => result.get(id) as DesignElement);
}

function mergePage(base: DesignPage, mine: DesignPage, ai: DesignPage, keptManual: string[], keptManualPages: string[], index: number): DesignPage {
  const background = pick(base.background, mine.background, ai.background);
  const name = pick(base.name, mine.name, ai.name);
  const height = pick(base.height, mine.height, ai.height);
  if (background.conflict) keptManualPages.push(`fondo de la página ${index + 1}`);
  const out: DesignPage = {
    id: mine.id,
    background: background.value as DesignPage["background"],
    elements: mergeElements(base, mine, ai, keptManual),
  };
  if (name.value !== undefined) out.name = name.value;
  if (height.value !== undefined) out.height = height.value;
  return out;
}

/** Fusiona el resultado de la IA (`ai`) con los cambios de la persona (`mine`) sobre la versión pedida (`base`). */
export function mergeAiPatch(base: DesignDoc, mine: DesignDoc, ai: DesignDoc): MergeResult {
  const keptManual: string[] = [];
  const keptManualPages: string[] = [];
  const b = new Map(base.pages.map((p) => [p.id, p]));
  const m = new Map(mine.pages.map((p) => [p.id, p]));
  const a = new Map(ai.pages.map((p) => [p.id, p]));
  const result = new Map<string, DesignPage>();

  for (const id of new Set([...b.keys(), ...m.keys(), ...a.keys()])) {
    const bp = b.get(id);
    const mp = m.get(id);
    const ap = a.get(id);
    if (!bp) {
      const chosen = mp ?? ap;
      if (chosen) result.set(id, chosen);
      continue;
    }
    if (!mp) continue; // la persona quitó la página
    if (!ap) {
      // La IA quitó la página: se quita, salvo que la persona la haya tocado.
      if (same(bp, mp)) continue;
      result.set(id, mp);
      keptManualPages.push(`página ${mine.pages.findIndex((p) => p.id === id) + 1}`);
      continue;
    }
    const index = mine.pages.findIndex((p) => p.id === id);
    result.set(id, mergePage(bp, mp, ap, keptManual, keptManualPages, index));
  }

  const order = mergeOrder(
    base.pages.map((p) => p.id),
    mine.pages.map((p) => p.id),
    ai.pages.map((p) => p.id),
    new Set(result.keys()),
  );
  const pages = order.map((id) => result.get(id) as DesignPage);
  const style = pick(base.style, mine.style, ai.style);
  const doc: DesignDoc = { v: 1, format: mine.format, pages: pages.length ? pages : mine.pages };
  if (style.value !== undefined) doc.style = style.value;
  return { doc, keptManual: [...new Set(keptManual)], keptManualPages: [...new Set(keptManualPages)] };
}

/** El aviso para la persona cuando se conservaron sus cambios; `null` si no hubo conflicto. */
export function keptManualNotice(result: Pick<MergeResult, "keptManual" | "keptManualPages">): string | null {
  const count = result.keptManual.length + result.keptManualPages.length;
  if (count === 0) return null;
  return count === 1
    ? "Dejé tu cambio manual en un elemento que la IA también había cambiado."
    : `Dejé tus cambios manuales en ${count} elementos que la IA también había cambiado.`;
}
