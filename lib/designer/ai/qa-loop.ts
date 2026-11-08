/**
 * El ciclo de la revisión automática (F36): medir, detectar, corregir, volver a medir.
 *
 *   1. mide el diseño con el servicio de render (si está) y detecta los 5 problemas;
 *   2. lo más común, poco contraste sobre una foto, se arregla subiendo la capa
 *      de color con la luminancia medida (sin llamar a la IA);
 *   3. lo que queda va a UNA pasada de corrección de la IA, con la imagen
 *      renderizada y la lista de problemas;
 *   4. se repite como mucho una vez más: NUNCA más de `MAX_CORRECTION_PASSES`
 *      (2) pasadas, aunque el problema siga igual.
 *
 * Lo que queda sin resolver se devuelve para avisarlo. Sin servicio de render
 * se hacen solo los chequeos que no lo necesitan y se anota por qué.
 *
 * Nunca lanza: una corrección que falla corta el ciclo y avisa, pero el diseño
 * que ya estaba se conserva.
 */

import type { DesignDoc } from "../doc/schema";
import type { FormatKey } from "../formats";
import type { DesignStyle } from "../styles";
import { unavailableNotice, type MeasureFn, type MeasureOutcome } from "./measure";
import { fixOverlays, issuePages, MAX_CORRECTION_PASSES, qaIssues, type QaIssue } from "./qa";

export interface CorrectionRequest {
  doc: DesignDoc;
  issues: QaIssue[];
  /** Las páginas con problemas (0-based): el alcance de la corrección. */
  pages: number[];
  /** Los PNG renderizados de TODAS las páginas (vacío si no hay servicio de render). */
  images: Uint8Array[];
}

export type CorrectionResult = { ok: true; doc: DesignDoc } | { ok: false; reason?: string };

export interface QaLoopDeps {
  format: FormatKey;
  style?: DesignStyle;
  /** `null`: no hay servicio de render (solo se hacen los chequeos que no lo necesitan). */
  measure: MeasureFn | null;
  correct: (request: CorrectionRequest) => Promise<CorrectionResult>;
}

export interface QaLoopResult {
  doc: DesignDoc;
  /** Lo que quedó sin resolver. */
  issues: QaIssue[];
  /** Avisos de lo que no se pudo revisar. */
  unchecked: string[];
  /** Cuántas veces se llamó a la IA para corregir. */
  corrections: number;
}

export async function runQaLoop(initial: DesignDoc, deps: QaLoopDeps): Promise<QaLoopResult> {
  let doc = initial;
  let corrections = 0;
  let rounds = 0;
  const unchecked: string[] = [];

  const take = async (current: DesignDoc): Promise<{ outcome: MeasureOutcome | null; issues: QaIssue[] }> => {
    const outcome = deps.measure ? await deps.measure(current) : null;
    const measure = outcome?.status === "ok" ? outcome.measure : null;
    if (!measure) {
      const note = unavailableNotice(outcome?.status === "unavailable" ? outcome.reason : "not_configured");
      if (note && !unchecked.includes(note)) unchecked.push(note);
    }
    return { outcome, issues: qaIssues(measure, current, deps.format, deps.style) };
  };

  let { outcome, issues } = await take(doc);

  while (issues.length > 0 && rounds < MAX_CORRECTION_PASSES) {
    rounds++;
    let changed = false;
    const measure = outcome?.status === "ok" ? outcome.measure : null;

    if (measure) {
      const fixed = fixOverlays(doc, issues, measure, deps.format);
      if (fixed.fixedPages.length > 0) {
        doc = fixed.doc;
        changed = true;
        issues = issues.filter((i) => !(i.kind === "contrast" && fixed.fixedPages.includes(i.page)));
      }
    }

    if (issues.length > 0) {
      corrections++;
      try {
        const images = outcome?.status === "ok" ? outcome.images : [];
        const result = await deps.correct({ doc, issues, pages: issuePages(issues), images });
        if (result.ok) {
          doc = result.doc;
          changed = true;
        } else {
          unchecked.push(result.reason ?? "No pude hacer la corrección automática de los problemas que encontré.");
          break;
        }
      } catch (error) {
        console.error("[designer-ai] la corrección automática falló:", error instanceof Error ? error.name : "error");
        unchecked.push("No pude hacer la corrección automática de los problemas que encontré.");
        break;
      }
    }

    if (!changed) break;
    ({ outcome, issues } = await take(doc));
  }

  return { doc, issues, unchecked, corrections };
}
