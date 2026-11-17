// @plantilla-quitar(proyectos)
/**
 * Copiar prompt (F234), puro. La base da las partes (`portal_builder_prompt_parts`): las instrucciones del paso, los
 * datos del proyecto y la última versión de cada documento que el paso usa; el panel lee esos textos del bucket y los
 * pasa acá. Copiar no gasta créditos ni escribe nada.
 *
 * Variables que se reemplazan en las instrucciones:
 *   {{proyecto}}            nombre, tipo, descripción y cliente.
 *   {{<clave del paso>}}    el documento de ese paso (por ejemplo {{brief}}); si falta, «[Todavía no lo pegaste]».
 *   {{rango_presupuesto}}   los rangos por tamaño que cargó el equipo.
 *   {{montos}}              lo vendido y el precio de cada fase.
 *   {{datos}}               los datos propios de todos los pasos.
 *   {{parte}} · {{modo}}    la parte elegida (requerimientos) y el modo de construir.
 *   {{requerimientos}}      los requerimientos de la parte elegida.
 * Un documento que el paso usa y que las instrucciones no nombran va al final, con su título.
 */

export const MISSING_DOC = "[Todavía no lo pegaste]";
export const PROMPT_WARN_CHARS = 150_000;
/** Una transcripción de más de ~2 horas se corta (≈ 18.000 palabras ≈ 120.000 caracteres). */
export const DOC_MAX_CHARS = 120_000;

export interface PromptParts {
  step: { key: string; name: string };
  template: { text: string; version: number };
  project: { kind: string; title: string; description: string | null; client: Record<string, unknown> | null; status: string | null; sold_cents: number | null; phases: Array<{ key: string; name: string; price_cents?: number | null }> };
  fields: Record<string, Record<string, unknown> | null>;
  roadmap: { mode?: string; stages?: Array<{ key: string; name: string; phases?: Array<{ key: string; name: string }> }> } | null;
  unit: string | null;
  budget_ranges: Array<{ size: string; min_cents: number; max_cents: number }>;
  documents: Array<{ step: string; name: string | null; version: { n: number; path: string } | null }>;
  requirements: { n: number; path: string } | null;
}

export interface BuiltPrompt {
  text: string;
  version: number;
  used: string[];
  missing: string[];
  chars: number;
  tooLong: boolean;
  truncated: string[];
}

const KIND = { real: "real", practice: "de práctica", challenge: "del reto" } as Record<string, string>;
const SIZE = { small: "chico", medium: "mediano", large: "grande" } as Record<string, string>;
const MODE = { block: "por bloque", phase: "por fase", stage: "por etapa entera" } as Record<string, string>;
const money = (c: number) => `US$${(c / 100).toLocaleString("es-AR", { maximumFractionDigits: c % 100 ? 2 : 0 })}`;

function projectBlock(p: PromptParts["project"]): string {
  const lines = [`Proyecto ${KIND[p.kind] ?? p.kind}: ${p.title}`];
  if (p.description) lines.push(p.description);
  const c = p.client ?? {};
  const client = ["company", "person", "email", "phone"].map((k) => c[k]).filter((x) => typeof x === "string" && x.trim());
  if (client.length) lines.push(`Cliente: ${client.join(" · ")}`);
  return lines.join("\n");
}

function unitName(parts: PromptParts): string {
  if (!parts.unit) return "";
  for (const st of parts.roadmap?.stages ?? []) {
    if (st.key === parts.unit) return `Etapa «${st.name}»`;
    for (const ph of st.phases ?? []) if (ph.key === parts.unit) return `Fase «${ph.name}» (etapa «${st.name}»)`;
  }
  return parts.unit;
}

export function buildPrompt(parts: PromptParts, texts: Record<string, string>): BuiltPrompt {
  const used: string[] = [];
  const missing: string[] = [];
  const truncated: string[] = [];
  const docText = (key: string, name: string, path: string | null | undefined, n: number | null) => {
    if (!path || texts[path] === undefined) {
      if (!missing.includes(name)) missing.push(name);
      return MISSING_DOC;
    }
    if (!used.includes(`${name} v${n}`)) used.push(`${name} v${n}`);
    const t = texts[path];
    if (t.length > DOC_MAX_CHARS) {
      if (!truncated.includes(name)) truncated.push(name);
      return `${t.slice(0, DOC_MAX_CHARS)}\n[Cortado: el documento era muy largo]`;
    }
    return t;
  };
  const docs = new Map(parts.documents.map((d) => [d.step, d]));
  const referenced = new Set<string>();
  const vars: Record<string, () => string> = {
    proyecto: () => projectBlock(parts.project),
    rango_presupuesto: () =>
      parts.budget_ranges.length ? parts.budget_ranges.map((r) => `${SIZE[r.size] ?? r.size}: de ${money(r.min_cents)} a ${money(r.max_cents)}`).join("\n") : "[El programa todavía no cargó los rangos]",
    montos: () => {
      const lines = [];
      if (typeof parts.project.sold_cents === "number") lines.push(`Total: ${money(parts.project.sold_cents)}`);
      for (const ph of parts.project.phases ?? []) lines.push(`${ph.name}: ${typeof ph.price_cents === "number" ? money(ph.price_cents) : "sin precio"}`);
      return lines.join("\n") || "[Sin montos]";
    },
    datos: () =>
      Object.entries(parts.fields)
        .flatMap(([step, f]) => Object.entries(f ?? {}).filter(([, v]) => v !== null && v !== "").map(([k, v]) => `${step}.${k}: ${String(v)}`))
        .join("\n") || "[Sin datos]",
    parte: () => unitName(parts) || "[Elegí una parte]",
    modo: () => MODE[parts.roadmap?.mode ?? ""] ?? "[Elegí el modo de construir]",
    requerimientos: () => docText("requerimientos", "requerimientos de la parte", parts.requirements?.path, parts.requirements?.n ?? null),
  };
  let text = parts.template.text.replace(/\{\{\s*([a-z0-9_]{1,40})\s*\}\}/g, (m, key: string) => {
    if (vars[key]) return vars[key]();
    const d = docs.get(key);
    if (d) {
      referenced.add(key);
      return docText(key, d.name ?? key, d.version?.path, d.version?.n ?? null);
    }
    return m;
  });
  const rest = parts.documents.filter((d) => !referenced.has(d.step));
  if (rest.length) {
    text += "\n\n---\nDocumentos anteriores:";
    for (const d of rest) text += `\n\n## ${d.name ?? d.step}${d.version ? ` (versión ${d.version.n})` : ""}\n${docText(d.step, d.name ?? d.step, d.version?.path, d.version?.n ?? null)}`;
  }
  return { text, version: parts.template.version, used, missing, chars: text.length, tooLong: text.length > PROMPT_WARN_CHARS, truncated };
}
