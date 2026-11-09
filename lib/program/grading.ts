// @plantilla-quitar(servicios)
/**
 * La calificación de una actividad (F55, F56), pura. Gemela de `app_servicio.grading_passed(text, jsonb, jsonb)`
 * (00345); los casos de `grading.cases.json` corren contra las dos.
 */
export const GRADING_SCALES = ["pass", "stars", "n10", "n100", "words"] as const;
export type GradingScale = (typeof GRADING_SCALES)[number];
export const WORD_SCALE = ["muy_malo", "malo", "regular", "bueno", "muy_bueno", "excelente"] as const;
export const WORD_LABELS: Record<(typeof WORD_SCALE)[number], string> = {
  muy_malo: "Muy malo",
  malo: "Malo",
  regular: "Regular",
  bueno: "Bueno",
  muy_bueno: "Muy bueno",
  excelente: "Excelente",
};
export const SCALE_LABELS: Record<GradingScale, string> = { pass: "Aprobada / No aprobada", stars: "5 estrellas", n10: "Del 1 al 10", n100: "Del 1 al 100", words: "Escala de palabras" };
export const DEFAULT_PASS_AT: Record<Exclude<GradingScale, "pass">, number | string> = { stars: 3, n10: 6, n100: 70, words: "bueno" };

const RANGE: Record<"stars" | "n10" | "n100", [number, number]> = { stars: [1, 5], n10: [1, 10], n100: [1, 100] };

/** Si el valor está dentro de la escala. */
export function inScale(scale: string, value: unknown): boolean {
  if (scale === "pass") return value === "approved" || value === "not_approved";
  if (scale === "words") return typeof value === "string" && (WORD_SCALE as readonly string[]).includes(value);
  const r = RANGE[scale as keyof typeof RANGE];
  return !!r && typeof value === "number" && Number.isInteger(value) && value >= r[0] && value <= r[1];
}

/** Si aprueba. null = el valor no es de la escala (se rechaza). */
export function passedFor(scale: string, value: unknown, passAt: unknown): boolean | null {
  if (!inScale(scale, value)) return null;
  if (scale === "pass") return value === "approved";
  const at = passAt ?? DEFAULT_PASS_AT[scale as keyof typeof DEFAULT_PASS_AT];
  if (scale === "words") {
    const i = (WORD_SCALE as readonly string[]).indexOf(value as string);
    const j = (WORD_SCALE as readonly string[]).indexOf(typeof at === "string" ? at : "bueno");
    return i >= (j < 0 ? 3 : j);
  }
  return (value as number) >= (typeof at === "number" ? at : Number(DEFAULT_PASS_AT[scale as keyof typeof DEFAULT_PASS_AT]));
}

export interface GradingDef {
  enabled?: boolean;
  scale?: string;
  pass_at?: number | string | null;
}

export function gradingIssues(def: GradingDef): string[] {
  if (!def.enabled) return [];
  const p: string[] = [];
  if (!(GRADING_SCALES as readonly string[]).includes(def.scale ?? "")) return ["elegí la escala"];
  if (def.scale !== "pass" && def.pass_at !== undefined && def.pass_at !== null && !inScale(def.scale as string, def.pass_at)) p.push("«aprueba desde» tiene que ser un valor de la escala");
  return p;
}
