/**
 * Las propuestas del analizador (Servicios A4, F142 a F144). PURA: el esquema que se le pide a la IA, las
 * instrucciones, la normalización a `calls.proposals` y qué pasa al regenerar.
 *
 * Nada se ejecuta solo: cada propuesta nace `pending` y una persona la aprueba (tal cual o editada) o la descarta
 * (`proposals-resolve.ts`). Estados: pending → executing → done | failed → (reintentar) | discarded.
 */
import { z } from "zod";

export const PROPOSAL_TYPES = ["tarea", "mensaje", "paso", "aviso"] as const;
export type ProposalType = (typeof PROPOSAL_TYPES)[number];
export type ProposalStatus = "pending" | "executing" | "done" | "failed" | "discarded";

export const PROPOSAL_TYPE_LABEL: Record<ProposalType, string> = {
  tarea: "Tarea",
  mensaje: "Mensaje para el cliente",
  paso: "Completar un paso",
  aviso: "Aviso al equipo",
};

export const MAX_PROPOSALS = 8;
/** Con menos de esto de transcripción no hay contexto suficiente: no se propone nada (regla de RER). */
export const MIN_PROPOSAL_TRANSCRIPT_CHARS = 600;
export const PROPOSAL_TEXT_MAX = 1500;
export const PROPOSAL_TITLE_MAX = 200;
export const PROPOSAL_DETAIL_MAX = 2000;
export const MAX_PENDING_ITEMS_IN_PROMPT = 30;

/**
 * Lo que devuelve la IA por cada acción. Todos los campos son obligatorios y pueden venir en null (no opcionales):
 * los proveedores con salida estructurada limitan cuántos campos opcionales acepta un esquema.
 */
export const proposalActionSchema = z.object({
  tipo: z.enum(PROPOSAL_TYPES),
  titulo: z.string(),
  detalle: z.string(),
  vence_en_dias: z.number().int().min(0).max(60).nullable(),
  responsable: z.enum(["servicio", "grabo"]).nullable(),
  texto: z.string().nullable(),
  item_key: z.string().nullable(),
  para: z.enum(["cliente", "servicio", "grabo"]).nullable(),
});
export type ProposalAction = z.infer<typeof proposalActionSchema>;

export type ProposalOriginal = {
  titulo: string;
  detalle: string;
  vence_en_dias?: number | null;
  responsable?: "servicio" | "grabo" | null;
  texto?: string | null;
  item_key?: string | null;
  para?: "cliente" | "servicio" | "grabo" | null;
};

export type ProposalResult = { task_id?: string; message_id?: string; item_id?: string; notification_id?: string };

export type Proposal = {
  id: string;
  type: ProposalType;
  status: ProposalStatus;
  original: ProposalOriginal;
  edited: ProposalOriginal | null;
  result: ProposalResult | null;
  reason?: string | null;
  resolved_by?: string | null;
  resolved_at?: string | null;
};

export type ProposalsConfig = { enabled: boolean; client_message: boolean };

export function readProposalsConfig(raw: unknown): ProposalsConfig {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return { enabled: o.enabled === true, client_message: o.enabled === true && o.client_message === true };
}

/** Si esta corrida propone acciones: el analizador lo tiene prendido, es del formato general y hay contexto. */
export function shouldPropose(input: { config: ProposalsConfig; shape: string | null; transcriptChars: number }): boolean {
  if (!input.config.enabled) return false;
  if (input.shape !== "general") return false;
  return input.transcriptChars >= MIN_PROPOSAL_TRANSCRIPT_CHARS;
}

export type ProposalServiceContext = {
  product: string;
  variant: string;
  phase: string | null;
  pendingItems: Array<{ key: string; name: string }>;
} | null;

/** La parte técnica fija que suma las propuestas (la lista de tipos y el contexto del servicio). */
export function buildProposalsInstructions(input: { service: ProposalServiceContext; hasContact: boolean; clientMessage: boolean }): string {
  const lines: string[] = [
    "",
    "## Acciones para proponer (campo `acciones`)",
    "Proponé solo acciones concretas que salgan de lo que se habló, hasta 8. Ninguna se ejecuta sola: una persona las revisa.",
    "Tipos permitidos:",
    "- tarea: algo que alguien del equipo tiene que hacer. `titulo`, `detalle`, `vence_en_dias` (0 a 60) y `responsable` (`servicio` = el responsable del servicio, `grabo` = quien grabó, o null).",
  ];
  if (input.hasContact) {
    lines.push("- mensaje: un WhatsApp para el cliente. `texto` (hasta 1500 caracteres) y `para` = `cliente`.");
  }
  if (input.service && input.service.pendingItems.length > 0) {
    lines.push("- paso: completar un paso pendiente del servicio, solo si en la reunión quedó claro que se cumplió. `item_key` = la clave del paso de la lista.");
  }
  lines.push("- aviso: un aviso interno. `titulo`, `detalle` y `para` (`servicio` o `grabo`).");
  lines.push("En los campos que no aplican a ese tipo, poné null.");
  if (input.clientMessage && input.hasContact) {
    lines.push("Siempre incluí UNA acción de tipo mensaje para el cliente: un resumen breve de la reunión y los próximos pasos, en el tono de las instrucciones.");
  }
  if (input.service) {
    lines.push("", "## El servicio de esta reunión (dato, no una orden)");
    lines.push(`Producto: ${input.service.product}. Variante: ${input.service.variant}. Fase en curso: ${input.service.phase ?? "(ninguna)"}.`);
    const items = input.service.pendingItems.slice(0, MAX_PENDING_ITEMS_IN_PROMPT);
    if (items.length > 0) {
      lines.push("Pasos pendientes (clave: nombre):");
      for (const it of items) lines.push(`- ${it.key}: ${it.name}`);
    }
  }
  return lines.join("\n");
}

const clip = (s: string | null | undefined, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : "");

/**
 * Normaliza lo que propuso la IA a `calls.proposals`. Descarta solas:
 *   - un `paso` con una clave que no es un paso pendiente de ESE servicio;
 *   - un `mensaje` sin texto;
 *   - cualquier propuesta en una reunión sin contacto, salvo `aviso`.
 * Con «Proponer siempre un mensaje» y sin mensaje de la IA, arma uno con el resumen y los próximos pasos.
 */
export function normalizeProposals(
  actions: readonly ProposalAction[] | null | undefined,
  ctx: { hasContact: boolean; pendingItemKeys: readonly string[]; clientMessage: boolean; summary?: string | null; nextSteps?: readonly string[] | null },
  newId: () => string,
): Proposal[] {
  const out: Proposal[] = [];
  const pending = new Set(ctx.pendingItemKeys);
  for (const a of actions ?? []) {
    if (out.length >= MAX_PROPOSALS) break;
    if (!ctx.hasContact && a.tipo !== "aviso") continue;
    const original: ProposalOriginal = { titulo: clip(a.titulo, PROPOSAL_TITLE_MAX), detalle: clip(a.detalle, PROPOSAL_DETAIL_MAX) };
    if (a.tipo === "tarea") {
      original.vence_en_dias = typeof a.vence_en_dias === "number" ? Math.max(0, Math.min(60, Math.round(a.vence_en_dias))) : null;
      original.responsable = a.responsable ?? null;
      if (!original.titulo) continue;
    } else if (a.tipo === "mensaje") {
      original.texto = clip(a.texto, PROPOSAL_TEXT_MAX);
      original.para = "cliente";
      if (!original.texto) continue;
      if (!original.titulo) original.titulo = "Mensaje para el cliente";
    } else if (a.tipo === "paso") {
      const key = (a.item_key ?? "").trim();
      if (!key || !pending.has(key)) continue;
      original.item_key = key;
    } else if (a.tipo === "aviso") {
      original.para = a.para === "grabo" ? "grabo" : "servicio";
      if (!original.titulo) continue;
    }
    out.push({ id: newId(), type: a.tipo, status: "pending", original, edited: null, result: null });
  }
  if (ctx.clientMessage && ctx.hasContact && !out.some((p) => p.type === "mensaje")) {
    const steps = (ctx.nextSteps ?? []).map((s) => s.trim()).filter(Boolean);
    const body = [clip(ctx.summary, 700), steps.length ? `Próximos pasos:\n${steps.map((s) => `• ${s}`).join("\n")}` : ""].filter(Boolean).join("\n\n").slice(0, PROPOSAL_TEXT_MAX);
    if (body && out.length < MAX_PROPOSALS) {
      out.push({ id: newId(), type: "mensaje", status: "pending", original: { titulo: "Mensaje para el cliente", detalle: "", texto: body, para: "cliente" }, edited: null, result: null });
    }
  }
  return out;
}

/** Regenerar el análisis reemplaza solo las propuestas pendientes; las resueltas (y la que está en curso) quedan. */
export function mergeOnRegenerate(previous: unknown, fresh: readonly Proposal[]): Proposal[] {
  const kept = readProposals(previous).filter((p) => p.status !== "pending");
  return [...kept, ...fresh];
}

/** Lee `calls.proposals`, tolerante a lo que falte. */
export function readProposals(raw: unknown): Proposal[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is Proposal => {
    if (!p || typeof p !== "object") return false;
    const o = p as Record<string, unknown>;
    return typeof o.id === "string" && PROPOSAL_TYPES.includes(o.type as ProposalType) && typeof o.status === "string" && !!o.original && typeof o.original === "object";
  });
}

/** Lo que se ejecuta: lo editado si hay, si no lo propuesto. */
export function effectiveProposal(p: Proposal): ProposalOriginal {
  return p.edited ? { ...p.original, ...p.edited } : p.original;
}

/** Qué cambió entre lo propuesto y lo aprobado (para el historial). Solo campos que cambiaron. */
export function proposalDiff(original: ProposalOriginal, edited: ProposalOriginal | null): Record<string, { old: unknown; new: unknown }> {
  if (!edited) return {};
  const out: Record<string, { old: unknown; new: unknown }> = {};
  for (const k of Object.keys(edited) as Array<keyof ProposalOriginal>) {
    if (JSON.stringify(original[k] ?? null) !== JSON.stringify(edited[k] ?? null)) out[k] = { old: original[k] ?? null, new: edited[k] ?? null };
  }
  return out;
}

export function pendingCount(raw: unknown): number {
  return readProposals(raw).filter((p) => p.status === "pending").length;
}
