/**
 * Lo que decide el copywriter, sin hablar con nadie (E3, E4).
 *
 * El agente arma su contexto de forma DETERMINISTA y despues hace una sola
 * llamada. Eso es a proposito: que elija los cinco posts que mas
 * funcionaron, o que proponga una palabra clave que dispara una
 * automatizacion que existe de verdad, no puede depender de que el modelo se
 * acuerde. Se le da masticado.
 *
 * Todo puro y testeado: sin base, sin red, sin proveedor.
 */

import type { BrandVoice, CopyOutput, CopyRequest } from "./ai-copy";

// ── Configuracion (E3) ────────────────────────────────────────────────────

export interface Guardrails {
  /** Frases que no se pueden usar. */
  bannedPhrases: string[];
  /** Promesas que no se pueden hacer. */
  bannedClaims: string[];
  /** Largo maximo del caption base, en caracteres. */
  maxLength: number | null;
}

export interface CopywriterConfig {
  /** Las instrucciones y la voz, de `agents.system_prompt`. */
  instructions: string;
  brand: BrandVoice;
  guardrails: Guardrails;
  knowledgeTags: string[];
  /** Producir el copy solo al aprobar una idea. Apagado por defecto. */
  autoOnApprove: boolean;
}

export const EMPTY_GUARDRAILS: Guardrails = {
  bannedPhrases: [],
  bannedClaims: [],
  maxLength: null,
};

const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "") : [];

/**
 * La configuracion del agente, con respaldo en lo que ya habia.
 *
 * `workspaces.content_copy_settings` es de donde salia la voz de marca antes
 * de que existiera el agente. Se sigue leyendo y no se borra: quien ya la
 * habia cargado no tiene que volver a escribirla.
 */
export function readCopywriterConfig(
  agent: { system_prompt?: string | null; config?: unknown; knowledge_tags?: string[] | null } | null,
  workspaceSettings: unknown,
): CopywriterConfig {
  const config = (agent?.config ?? {}) as {
    brand?: BrandVoice;
    guardrails?: Partial<Guardrails>;
    auto_on_approve?: boolean;
  };
  const fallback = (workspaceSettings ?? {}) as BrandVoice;

  const brand: BrandVoice = {
    voice: config.brand?.voice ?? fallback.voice,
    audience: config.brand?.audience ?? fallback.audience,
    examples: config.brand?.examples ?? fallback.examples,
    avoid: config.brand?.avoid ?? fallback.avoid,
  };

  return {
    instructions: (agent?.system_prompt ?? "").trim(),
    brand,
    guardrails: {
      bannedPhrases: asStrings(config.guardrails?.bannedPhrases),
      bannedClaims: asStrings(config.guardrails?.bannedClaims),
      maxLength:
        typeof config.guardrails?.maxLength === "number" && config.guardrails.maxLength > 0
          ? config.guardrails.maxLength
          : null,
    },
    knowledgeTags: agent?.knowledge_tags ?? [],
    autoOnApprove: config.auto_on_approve === true,
  };
}

// ── Que posts le sirven de ejemplo (E4) ───────────────────────────────────

export const TOP_POSTS = 5;
export const TOP_POSTS_WINDOW_DAYS = 90;

export interface PastPost {
  platform: string;
  format: string | null;
  caption: string | null;
  /** Engagement comparable a 7 dias (`social_posts.engagement_d7`). */
  engagement: number | null;
  publishedAt: string | null;
}

/**
 * Los que mas funcionaron de esa red y ese formato.
 *
 * A 7 dias y no el total: un post de hace tres meses tuvo tres meses para
 * juntar likes, y compararlo con uno de la semana pasada premiaria a los
 * viejos. Es la misma medida que usa el dashboard.
 *
 * Mismo formato porque un Reel y un carrusel no se escriben igual: darle de
 * ejemplo lo que funciono en otro formato lo empuja en la direccion
 * equivocada.
 */
export function pickTopPosts(
  posts: PastPost[],
  filter: { platform: string; format?: string | null; now?: Date },
): PastPost[] {
  const now = filter.now ?? new Date();
  const since = now.getTime() - TOP_POSTS_WINDOW_DAYS * 24 * 60 * 60_000;

  return posts
    .filter((p) => p.platform === filter.platform)
    .filter((p) => !filter.format || p.format === filter.format)
    .filter((p) => (p.caption ?? "").trim() !== "")
    .filter((p) => p.engagement !== null && p.engagement > 0)
    .filter((p) => {
      if (!p.publishedAt) return false;
      const at = new Date(p.publishedAt).getTime();
      return !Number.isNaN(at) && at >= since;
    })
    .sort((a, b) => (b.engagement ?? 0) - (a.engagement ?? 0))
    .slice(0, TOP_POSTS);
}

// ── Que palabras clave puede ofrecer (E4) ─────────────────────────────────

export interface OfferableKeyword {
  keyword: string;
  flowName: string;
}

/**
 * Las palabras que disparan algo de verdad.
 *
 * Sin esto el modelo inventa un "escribime SISTEMA" que no responde nadie, y
 * la persona se entera cuando el lead ya escribio y no le contesto nada.
 */
export function offerableKeywords(
  rules: Array<{
    type: string;
    isActive: boolean;
    channelIds: string[];
    keywords: Array<{ value: string }>;
    flowName: string;
  }>,
  platform: string,
  channelId: string | null,
): OfferableKeyword[] {
  // Los comentarios disparan `comment_keyword`; los mensajes, `keyword`.
  const wanted = ["comment_keyword", "keyword"];
  const out: OfferableKeyword[] = [];
  const seen = new Set<string>();

  for (const rule of rules) {
    if (!rule.isActive || !wanted.includes(rule.type)) continue;
    // Sin canales declarados vale para todos.
    if (rule.channelIds.length > 0 && (!channelId || !rule.channelIds.includes(channelId))) continue;

    for (const { value } of rule.keywords) {
      const keyword = value.trim();
      if (!keyword || seen.has(keyword.toLowerCase())) continue;
      seen.add(keyword.toLowerCase());
      out.push({ keyword, flowName: rule.flowName });
    }
  }

  void platform;
  return out;
}

// ── El pedido al modelo (E4) ──────────────────────────────────────────────

export interface CopywriterContext {
  request: CopyRequest;
  config: CopywriterConfig;
  /** Ejemplos de lo que funciono, por red. */
  topPosts: Array<{ platform: string; caption: string; engagement: number | null }>;
  keywords: OfferableKeyword[];
  /** Fragmentos de la base de conocimiento de sus etiquetas. */
  knowledge: Array<{ title: string; text: string }>;
  /** Lo que la persona pidio al regenerar ("mas corto, mas directo"). */
  instructions?: string | null;
}

/** Lo que se le suma al prompt de F29, en orden de importancia. */
export function buildCopywriterPrompt(context: CopywriterContext): string {
  const parts: string[] = [];

  if (context.config.instructions) {
    parts.push(`INSTRUCCIONES DE LA MARCA\n${context.config.instructions}`);
  }

  const { bannedPhrases, bannedClaims, maxLength } = context.config.guardrails;
  if (bannedPhrases.length || bannedClaims.length || maxLength) {
    const limites: string[] = [];
    if (bannedPhrases.length) limites.push(`No uses estas frases: ${bannedPhrases.join("; ")}.`);
    if (bannedClaims.length) limites.push(`No prometas esto: ${bannedClaims.join("; ")}.`);
    if (maxLength) limites.push(`El caption base no puede pasar de ${maxLength} caracteres.`);
    parts.push(`LIMITES\n${limites.join("\n")}`);
  }

  if (context.knowledge.length) {
    parts.push(
      "LO QUE SABEMOS DEL NEGOCIO\n" +
        context.knowledge.map((k) => `- ${k.title}: ${k.text}`).join("\n"),
    );
  }

  if (context.topPosts.length) {
    parts.push(
      "LO QUE MEJOR FUNCIONO (mismo formato y red, ultimos 90 dias)\n" +
        context.topPosts.map((p) => `- [${p.platform}] ${p.caption}`).join("\n"),
    );
  }

  if (context.keywords.length) {
    parts.push(
      "PALABRAS CLAVE QUE DISPARAN UNA AUTOMATIZACION DE VERDAD\n" +
        context.keywords.map((k) => `- ${k.keyword} -> ${k.flowName}`).join("\n") +
        "\nUsa UNA de estas en el CTA. No inventes otra: una palabra que no dispara nada deja al lead sin respuesta.",
    );
  } else {
    parts.push(
      "NO HAY NINGUNA AUTOMATIZACION ACTIVA POR PALABRA CLAVE.\n" +
        "El CTA tiene que pedir algo que una persona pueda atender a mano.",
    );
  }

  if (context.instructions?.trim()) {
    parts.push(`LO QUE PIDIO QUIEN ESTA ESCRIBIENDO\n${context.instructions.trim()}`);
  }

  return parts.join("\n\n");
}

// ── Que se revisa al recibir la respuesta (E3) ────────────────────────────

/**
 * Lo que la salida incumple, si algo.
 *
 * Son advertencias y no un rechazo: el copy queda igual en el borrador con
 * el aviso al lado. Tirarlo obligaria a pagar otra llamada por una frase, y
 * la persona lo tiene delante para corregirlo en dos segundos.
 */
export function checkGuardrails(output: CopyOutput, guardrails: Guardrails): string[] {
  const avisos: string[] = [];
  const todo = [
    output.copy.hook,
    output.copy.body,
    output.copy.cta,
    output.caption_base,
    ...Object.values(output.captions ?? {}),
  ]
    .filter((t): t is string => typeof t === "string")
    .join("\n")
    .toLowerCase();

  for (const frase of guardrails.bannedPhrases) {
    if (todo.includes(frase.toLowerCase())) avisos.push(`Usa una frase prohibida: "${frase}".`);
  }
  for (const promesa of guardrails.bannedClaims) {
    if (todo.includes(promesa.toLowerCase())) avisos.push(`Promete algo que no se puede: "${promesa}".`);
  }
  if (guardrails.maxLength && output.caption_base.length > guardrails.maxLength) {
    avisos.push(
      `El caption base tiene ${output.caption_base.length} caracteres y el limite es ${guardrails.maxLength}.`,
    );
  }

  return avisos;
}
