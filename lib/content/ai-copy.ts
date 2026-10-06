/**
 * Generar el guion y los captions con IA (F29).
 *
 * Es un pedido simple, no un agente: una llamada con salida estructurada. La
 * interfaz (`generateCopy(input) → output`) esta pensada para que el agente
 * de redaccion de la etapa 3 la reemplace sin tocar a quien la usa.
 *
 * Tres cosas que no son negociables y viven aca:
 *   1. La salida se valida con Zod. Un modelo que devuelve algo raro no puede
 *      escribir cualquier cosa en la pieza.
 *   2. Los limites de cada red entran en el pedido. Pedir un caption de
 *      Threads sin decir que son 500 caracteres es pedirlo para tirarlo.
 *   3. La voz de marca del workspace va adelante. Sin eso el guion suena a
 *      modelo generico, que es justo lo que no sirve.
 *
 * El armado del pedido y la validacion son puros y se prueban sin proveedor.
 */

import { z } from "zod";
import { PLATFORM_LIMITS } from "./limits";

/** La voz de marca, de `workspaces.content_copy_settings`. */
export interface BrandVoice {
  voice?: string;
  audience?: string;
  examples?: string[];
  avoid?: string;
}

export interface CopyRequest {
  /** De donde salio la pieza. */
  idea?: {
    title?: string | null;
    /** El texto unico de la idea (F90). */
    content?: string | null;
    reference?: string | null;
  } | null;
  title: string;
  format?: string | null;
  /** Las redes para las que hay que escribir caption. */
  platforms: string[];
  brand?: BrandVoice | null;
  /** El guion que ya hay escrito, cuando se pide regenerar. */
  existingScript?: string | null;
}

/** Lo que el modelo tiene que devolver. */
export const copyOutputSchema = z.object({
  /** El guion completo, de principio a fin: el ultimo parrafo es el cierre. */
  script: z.string().trim().min(1, "El guion no puede estar vacio"),
  /** Indicaciones para quien graba. */
  recording_notes: z.string(),
  caption_base: z.string(),
  /** Un caption por red pedida. */
  captions: z.record(z.string(), z.string()),
  youtube_title: z.string().optional().nullable(),
});

export type CopyOutput = z.infer<typeof copyOutputSchema>;

export const SYSTEM_PROMPT = [
  "Sos quien escribe el contenido de este negocio.",
  "Escribis en español rioplatense (vos/tenes), directo y sin relleno.",
  "No usas emojis salvo que la voz de marca los pida, ni frases de manual de marketing.",
  "Devolves SOLO lo que se te pide, en el formato indicado.",
].join(" ");

/** El pedido, en texto. Se arma aca para poder leerlo y testearlo. */
export function buildPrompt(request: CopyRequest): string {
  const parts: string[] = [];

  if (request.brand?.voice) {
    parts.push(`Voz de marca:\n${request.brand.voice}`);
  }
  if (request.brand?.audience) {
    parts.push(`A quien le habla:\n${request.brand.audience}`);
  }
  if (request.brand?.examples?.length) {
    // Los ejemplos hacen mas por el tono que cualquier adjetivo.
    parts.push(
      `Asi suena cuando esta bien:\n${request.brand.examples.map((e) => `- ${e}`).join("\n")}`,
    );
  }
  if (request.brand?.avoid) {
    parts.push(`Que evitar:\n${request.brand.avoid}`);
  }

  parts.push(`Titulo de la pieza: ${request.title}`);
  if (request.format) parts.push(`Formato: ${request.format}`);

  if (request.idea) {
    const idea = [
      request.idea.content && request.idea.content,
      request.idea.reference && `Referencia: ${request.idea.reference}`,
    ].filter(Boolean);
    if (idea.length > 0) parts.push(`La idea de origen:\n${idea.join("\n")}`);
  }

  if (request.existingScript?.trim()) {
    parts.push(
      `Ya hay un guion escrito. Reescribilo mejorandolo, sin perder lo que ya funciona:\n${request.existingScript.trim()}`,
    );
  }

  // Los limites reales de cada red: pedir un caption que no entra es pedirlo
  // para tirarlo.
  const limits = request.platforms
    .map((platform) => {
      const limit = PLATFORM_LIMITS[platform];
      return limit ? `- ${platform}: hasta ${limit.textMax} caracteres` : null;
    })
    .filter(Boolean);

  if (limits.length > 0) {
    parts.push(`Captions, uno por red, respetando su limite:\n${limits.join("\n")}`);
  }

  if (request.platforms.includes("youtube")) {
    parts.push(
      `Ademas un titulo para YouTube de hasta ${PLATFORM_LIMITS.youtube.titleMax} caracteres.`,
    );
  }

  parts.push(
    [
      "Devolve:",
      "- script: el guion completo para leer frente a camara. Arranca con la frase que frena el scroll y el ULTIMO parrafo es el cierre: como termina y que pide.",
      "- recording_notes: indicaciones para grabar (tono, planos, que mostrar). No sale publicado.",
      "- caption_base: el caption que sirve para cualquier red.",
      "- captions: uno por red, adaptado a su largo.",
    ].join("\n"),
  );

  return parts.join("\n\n");
}

export type CopyValidation =
  | { ok: true; output: CopyOutput; warnings: string[] }
  | { ok: false; error: string };

/**
 * Valida lo que devolvio el modelo.
 *
 * Los captions que se pasan del limite se recortan y se avisa, en vez de
 * rechazar toda la generacion: el guion, que es lo caro, ya esta bien, y
 * volver a pedirlo cuesta plata.
 */
export function validateCopyOutput(raw: unknown, platforms: string[]): CopyValidation {
  const parsed = copyOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "La IA devolvio algo que no puedo usar",
    };
  }

  const output = parsed.data;
  const warnings: string[] = [];
  const captions: Record<string, string> = {};

  for (const platform of platforms) {
    const limit = PLATFORM_LIMITS[platform]?.textMax;
    const caption = output.captions[platform] ?? output.caption_base;

    if (!caption) {
      warnings.push(`No escribio un caption para ${platform}: queda el base.`);
      continue;
    }
    if (limit && caption.length > limit) {
      captions[platform] = caption.slice(0, limit);
      warnings.push(`El caption de ${platform} era mas largo que su limite y se recorto.`);
    } else {
      captions[platform] = caption;
    }
  }

  const titleLimit = PLATFORM_LIMITS.youtube.titleMax ?? 100;
  let youtubeTitle = output.youtube_title ?? null;
  if (youtubeTitle && youtubeTitle.length > titleLimit) {
    youtubeTitle = youtubeTitle.slice(0, titleLimit);
    warnings.push("El titulo de YouTube se recorto.");
  }

  return { ok: true, output: { ...output, captions, youtube_title: youtubeTitle }, warnings };
}

/**
 * Como queda la pieza despues de generar.
 *
 * `copy_source` pasa a `ai`, y a `mixed` si ya habia algo escrito a mano: eso
 * es lo que despues permite decir "esto lo escribio la IA y nadie lo reviso".
 */
export function applyGeneratedCopy(params: {
  output: CopyOutput;
  platforms: string[];
  previousCopySource: "manual" | "ai" | "mixed";
  /** Si ya habia un guion escrito (a mano o por la IA antes). */
  hadManualCopy: boolean;
  networks: Array<{ platform: string; caption?: string | null; youtube_title?: string | null }>;
}): {
  script: string;
  recording_notes: string;
  caption: string;
  networks: Array<{ platform: string; caption?: string | null; youtube_title?: string | null }>;
  copy_source: "ai" | "mixed";
  ai_unreviewed: true;
} {
  return {
    script: params.output.script,
    recording_notes: params.output.recording_notes,
    caption: params.output.caption_base,
    networks: params.networks.map((network) => {
      const generated = params.output.captions[network.platform];
      return {
        ...network,
        // Solo se escribe el caption propio de la red si la IA escribio uno
        // distinto del base: si no, la red sigue usando el base (null).
        caption:
          generated && generated !== params.output.caption_base ? generated : network.caption ?? null,
        youtube_title:
          network.platform === "youtube"
            ? params.output.youtube_title ?? network.youtube_title ?? null
            : network.youtube_title,
      };
    }),
    copy_source: params.hadManualCopy ? "mixed" : "ai",
    ai_unreviewed: true,
  };
}

/** Si hay que pedir confirmacion antes de pisar lo escrito. */
export function needsConfirmation(existing: { script?: string | null } | null | undefined): boolean {
  return Boolean(existing?.script?.trim());
}
