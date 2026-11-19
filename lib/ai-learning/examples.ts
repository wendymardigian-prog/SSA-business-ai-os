/**
 * Ejemplos automáticos en el prompt. Puro: lo usan el runner y los tests.
 *
 * El agente lleva los últimos aprobados SIN editar de ese canal y tipo, y las ediciones más instructivas como
 * «propuesto → final». «Más instructiva» = la que cambió una parte apreciable del texto sin reescribirlo entero
 * (entre el 15 % y el 80 % de las palabras), y entre ellas, las más recientes primero. Un rechazo no es un ejemplo.
 *
 * Apagados por defecto (respuesta prevista P-81: los ejemplos llevan textos de otros clientes; falta confirmar
 * el criterio). Viajan como DATOS envueltos, nunca como instrucciones.
 */

export interface OutcomeForExamples {
  outcome: "approved" | "approved_edited" | "rejected";
  proposedText: string | null;
  finalText: string | null;
  decidedAt: string;
  channelId: string | null;
  kind: string;
}

export interface PickedExamples {
  approved: string[];
  edits: Array<{ proposed: string; final: string }>;
}

const MAX_EXAMPLE_CHARS = 600;

function words(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Qué parte de las palabras cambió entre dos textos (0 = igual, 1 = todo distinto). Puro. */
export function editRatio(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (wa.length === 0 && wb.length === 0) return 0;
  // LCS de palabras (los textos son cortos: mensajes).
  const dp: number[] = new Array(wb.length + 1).fill(0);
  for (let i = 1; i <= wa.length; i++) {
    let prev = 0;
    for (let j = 1; j <= wb.length; j++) {
      const tmp = dp[j];
      dp[j] = wa[i - 1] === wb[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  const lcs = dp[wb.length];
  return 1 - (2 * lcs) / (wa.length + wb.length);
}

export function pickExamples(
  outcomes: readonly OutcomeForExamples[],
  opts: { channelId: string | null; kind: string; approved: number; edits: number },
): PickedExamples {
  const sameScope = outcomes
    .filter((o) => o.kind === opts.kind && (opts.channelId === null || o.channelId === opts.channelId))
    .slice()
    .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
  const approved = sameScope
    .filter((o) => o.outcome === "approved" && o.proposedText && o.proposedText.trim())
    .slice(0, Math.max(0, opts.approved))
    .map((o) => o.proposedText!.trim().slice(0, MAX_EXAMPLE_CHARS));
  const edits = sameScope
    .filter((o) => o.outcome === "approved_edited" && o.proposedText?.trim() && o.finalText?.trim())
    .map((o) => ({ o, r: editRatio(o.proposedText!, o.finalText!) }))
    .filter(({ r }) => r >= 0.15 && r <= 0.8)
    .slice(0, Math.max(0, opts.edits))
    .map(({ o }) => ({ proposed: o.proposedText!.trim().slice(0, MAX_EXAMPLE_CHARS), final: o.finalText!.trim().slice(0, MAX_EXAMPLE_CHARS) }));
  return { approved, edits };
}

/** El texto de los ejemplos (sin envolver: lo envuelve quien arma el prompt). Vacío si no hay ninguno. */
export function examplesText(picked: PickedExamples): string {
  if (picked.approved.length === 0 && picked.edits.length === 0) return "";
  const parts: string[] = [];
  if (picked.approved.length > 0) {
    parts.push("Respuestas que el equipo aprobó tal cual:");
    picked.approved.forEach((t, i) => parts.push(`${i + 1}. ${t}`));
  }
  if (picked.edits.length > 0) {
    parts.push("Respuestas que el equipo corrigió (propuesto → final):");
    picked.edits.forEach((e, i) => parts.push(`${i + 1}. «${e.proposed}» → «${e.final}»`));
  }
  return parts.join("\n");
}
