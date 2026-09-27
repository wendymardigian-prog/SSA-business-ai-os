import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { AgentToolContext, AgentToolDefinition } from "./types";
import type { AgentConfig } from "../config";
import { stripLinks } from "../output-guardrails";

/**
 * generar_link_whatsapp: arma el link de WhatsApp de Wendy con un mensaje
 * preescrito, para pasarle un lead calificado. NO escribe la url en el mensaje:
 * devuelve un marcador ({{LINK_WHATSAPP}}) que el modelo pone en su texto, y el
 * runner lo reemplaza por el link real antes de enviar o guardar el borrador.
 *
 * Sin numero configurado, la herramienta no existe para el modelo (isAvailable)
 * y la pantalla explica que falta (mismo patron que la lista blanca de tags).
 *
 * El registro del pase (audit_log 'whatsapp_handoff') NO lo hace esta
 * herramienta: lo hace el runner/aprobacion cuando el mensaje con el link sale
 * de verdad (lib/agent/whatsapp-handoff.ts). El criterio es el texto enviado.
 */

type Db = SupabaseClient<Database>;

/** Placeholder que el modelo escribe y el runner reemplaza. */
export const WHATSAPP_MARKER = "{{LINK_WHATSAPP}}";
/** Clave en la memoria del turno. */
export const WHATSAPP_MEMO_KEY = "whatsapp_link";

export interface WhatsappLinkMemo {
  link: string;
  textoPreescrito: string;
}

/** Quita +, espacios, guiones y parentesis; deja solo digitos. */
export function normalizePhone(raw: string): string {
  return (raw ?? "").replace(/[^\d]/g, "");
}

const configSchema = z.object({
  numero: z
    .string()
    .default("")
    .transform(normalizePhone)
    // Vacio es valido para poder guardar sin numero; isAvailable la esconde.
    // Con numero: 8 a 15 digitos, sin empezar en 0.
    .refine((v) => v === "" || /^[1-9]\d{7,14}$/.test(v), "El numero va en formato internacional sin +: entre 8 y 15 digitos, sin empezar en 0."),
  plantilla_default: z.string().trim().min(1).max(200).default("Hola Wendy, te escribo desde Instagram."),
  max_caracteres: z.number().int().min(40).max(300).default(180),
});

type Config = z.infer<typeof configSchema>;

const inputSchema = z
  .object({
    contexto: z.string().max(400).optional().describe("Una linea, en castellano normal, con lo que conto el lead."),
    nombre: z.string().max(80).optional().describe("El nombre del lead, si lo sabes."),
  })
  .strict();

function configOf(agent: AgentConfig): Config {
  const parsed = configSchema.safeParse(agent.toolsConfig["generar_link_whatsapp"] ?? {});
  return parsed.success ? parsed.data : configSchema.parse({});
}

const CONTROL = /[\p{Cc}​-‍﻿⁠]/gu;

/** Limpia el texto para el link: sin controles, sin links, espacios colapsados. */
export function sanitizeForLink(text: string): string {
  return stripLinks(text)
    .replace(CONTROL, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Recorta en borde de palabra antes de codificar. Nunca parte un escape. */
export function cutForLink(text: string, max: number): string {
  if (text.length <= max) return text;
  const window = text.slice(0, max + 1);
  const space = window.lastIndexOf(" ");
  const cut = space > 0 ? space : max;
  return text.slice(0, cut).trim();
}

const PLACEHOLDER_NAMES = new Set(["instagram user", "usuario de instagram", "usuario", "user"]);

function usableName(nombre: string | undefined, isAnonymous: boolean): string | null {
  if (isAnonymous) return null;
  const n = (nombre ?? "").trim();
  if (!n) return null;
  if (PLACEHOLDER_NAMES.has(n.toLowerCase())) return null;
  return n;
}

/** Arma el link a partir de un texto ya saneado y recortado. */
export function buildWhatsappLink(numero: string, texto: string): string {
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

/**
 * Arma el texto preescrito (sin codificar): saludo + nombre + contexto, o la
 * plantilla por defecto si no hay contexto. Saneado y recortado a max.
 */
export function composePrewrittenText(
  args: { nombre: string | null; contexto: string | undefined; plantillaDefault: string; max: number },
): string {
  const contexto = sanitizeForLink(args.contexto ?? "");
  let base: string;
  if (!contexto) {
    base = args.plantillaDefault;
  } else if (args.nombre) {
    base = `Hola Wendy, soy ${sanitizeForLink(args.nombre)}. ${contexto}`;
  } else {
    base = `Hola Wendy. ${contexto}`;
  }
  base = sanitizeForLink(base);
  base = cutForLink(base, args.max);
  // Margen extra: si al codificar (emojis, ~12 chars c/u) se pasa de 1.800, se
  // recorta de nuevo por palabras. Asi el link nunca supera el recorte de 2.000
  // del log de pasos, que es de donde se relee para reusar.
  while (base && encodeURIComponent(base).length > 1_800) {
    base = cutForLink(base, Math.floor(base.length * 0.8));
  }
  return base;
}

/**
 * Busca un link de WhatsApp generado en un run anterior de la misma
 * conversacion, para reusarlo (el system prompt prohibe repetirlo, pero si el
 * modelo insiste, que sea el mismo link y no uno nuevo).
 */
export async function findWhatsappLinkInConversation(
  supabase: Db,
  conversationId: string,
): Promise<WhatsappLinkMemo | null> {
  const { data: runs } = await supabase
    .from("agent_runs")
    .select("id")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(50);
  const runIds = (runs ?? []).map((r) => (r as { id: string }).id);
  if (runIds.length === 0) return null;

  const { data: steps } = await supabase
    .from("agent_run_steps")
    .select("output, created_at")
    .in("run_id", runIds)
    .eq("kind", "tool_call")
    .eq("name", "generar_link_whatsapp")
    .is("error", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const output = (steps ?? [])[0]?.output as { link?: unknown; texto_preescrito?: unknown } | null | undefined;
  if (output && typeof output.link === "string") {
    return { link: output.link, textoPreescrito: typeof output.texto_preescrito === "string" ? output.texto_preescrito : "" };
  }
  return null;
}

/** El link (y texto) que genero la herramienta en un run puntual, o null. */
export async function findWhatsappLinkForRun(supabase: Db, runId: string | null): Promise<WhatsappLinkMemo | null> {
  if (!runId) return null;
  const { data: steps } = await supabase
    .from("agent_run_steps")
    .select("output, created_at")
    .eq("run_id", runId)
    .eq("kind", "tool_call")
    .eq("name", "generar_link_whatsapp")
    .is("error", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const output = (steps ?? [])[0]?.output as { link?: unknown; texto_preescrito?: unknown } | null | undefined;
  if (output && typeof output.link === "string") {
    return { link: output.link, textoPreescrito: typeof output.texto_preescrito === "string" ? output.texto_preescrito : "" };
  }
  return null;
}

async function isAnonymousContact(supabase: Db, contactId: string | null): Promise<boolean> {
  if (!contactId) return false;
  const { data } = await supabase.from("contacts").select("is_anonymous").eq("id", contactId).maybeSingle();
  return Boolean((data as { is_anonymous?: boolean } | null)?.is_anonymous);
}

export const whatsappLinkTool: AgentToolDefinition<z.infer<typeof inputSchema>, Config> = {
  name: "generar_link_whatsapp",
  label: "Pasar el lead a WhatsApp",
  description:
    "Genera el link de WhatsApp de Wendy con un mensaje preescrito, para pasarle un lead calificado que quiere avanzar. En tu mensaje al lead escribí exactamente el marcador {{LINK_WHATSAPP}} donde va el link, nunca la URL: el sistema lo reemplaza por el link real. Usala una sola vez por conversación; no repitas el link.",
  inputSchema,
  configSchema,
  configFields: [
    {
      key: "numero",
      label: "Número de WhatsApp de destino",
      hint: "Formato internacional sin +, sin espacios ni guiones. Ej: 50670814873.",
      kind: "text",
      inputMode: "tel",
      requiredForTool: true,
      emptyMessage:
        "Falta el número de WhatsApp de destino (formato internacional, sin +). Sin número, la herramienta no existe para el agente.",
    },
    {
      key: "plantilla_default",
      label: "Mensaje por defecto",
      hint: "Se usa cuando el agente no aporta contexto de la conversación.",
      kind: "text",
      maxLength: 200,
    },
    {
      key: "max_caracteres",
      label: "Largo máximo del mensaje preescrito",
      hint: "Antes de codificar. Entre 40 y 300.",
      kind: "number",
      min: 40,
      max: 300,
    },
  ],
  isAvailable: (agent) => configOf(agent).numero !== "",
  async execute({ input, config, ctx }: { input: z.infer<typeof inputSchema>; config: Config; ctx: AgentToolContext }) {
    if (!config.numero) {
      return {
        ok: false,
        forModel: "No hay un número de WhatsApp configurado. Seguí la conversación sin link y no inventes uno.",
      };
    }

    // Dedup en el turno: si ya se genero, mismo resultado, un solo paso. El
    // runner siempre pasa turn.memo; sin el (algun test) no persiste entre
    // llamadas, que es inofensivo.
    const memoMap = ctx.turn?.memo ?? new Map<string, unknown>();
    const memo = memoMap.get(WHATSAPP_MEMO_KEY) as WhatsappLinkMemo | undefined;
    if (memo) {
      return {
        ok: true,
        forModel: JSON.stringify({ marcador: WHATSAPP_MARKER, texto_preescrito: memo.textoPreescrito, link: memo.link }),
        stepAlreadyRecorded: true,
      };
    }

    // Reuso en la conversacion (run anterior).
    if (ctx.conversationId) {
      const previous = await findWhatsappLinkInConversation(ctx.supabase, ctx.conversationId);
      if (previous) {
        memoMap.set(WHATSAPP_MEMO_KEY, previous);
        return {
          ok: true,
          forModel: JSON.stringify({ marcador: WHATSAPP_MARKER, texto_preescrito: previous.textoPreescrito, link: previous.link }),
          detail: { texto_preescrito: previous.textoPreescrito, link: previous.link, reenvio: true },
        };
      }
    }

    const anon = await isAnonymousContact(ctx.supabase, ctx.contactId);
    const nombre = usableName(input.nombre, anon);
    const textoPreescrito = composePrewrittenText({
      nombre,
      contexto: input.contexto,
      plantillaDefault: config.plantilla_default,
      max: config.max_caracteres,
    });
    const link = buildWhatsappLink(config.numero, textoPreescrito);

    memoMap.set(WHATSAPP_MEMO_KEY, { link, textoPreescrito });
    return {
      ok: true,
      forModel: JSON.stringify({ marcador: WHATSAPP_MARKER, texto_preescrito: textoPreescrito, link }),
      detail: { texto_preescrito: textoPreescrito, link, reenvio: false },
    };
  },
};
