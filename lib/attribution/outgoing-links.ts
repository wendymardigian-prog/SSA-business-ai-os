/**
 * Los links de un mensaje que sale de un flujo, con atribución (Extra I, F39 y F40). SOLO servidor.
 *
 * Con «Agregar parámetros de atribución» encendido en el nodo, cada link del mensaje YA ADAPTADO a la plataforma (el texto,
 * los botones URL, los botones de un carrusel; en WhatsApp los botones ya bajaron a texto) sale con sus UTM
 * (`buildAttributedUrl`). Con «Registrar el clic» además, y si el flujo conoce al contacto, cada link sale como
 * `<APP_URL>/l/<token>`: una ruta del sistema que registra el clic y redirige al destino con sus UTM.
 *
 * Con el interruptor apagado (o sin la clave `attribution`), el mensaje vuelve EXACTAMENTE igual y no se lee nada: lo fija
 * la caracterización de `send-message`. NUNCA lanza: ante cualquier falla el link sale como estaba (o solo con UTM).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { appUrl } from "@/lib/app-url";
import type { Database } from "@/lib/types/database";
import { buildAttributedUrl, isChatLink, mapUrlsInText, type LinkAttributionContext } from "./link-params";
import { getOrCreateAttributionLinkSecret } from "./link-secret";
import { signTrackedLink } from "./tracked-link";

type Db = SupabaseClient<Database>;

export interface NodeAttribution {
  append: boolean;
  trackClicks: boolean;
}

export interface OutgoingButton {
  url?: string;
  [key: string]: unknown;
}

export interface OutgoingMessage {
  text: string;
  buttons?: OutgoingButton[];
  template?: { elements: Array<{ buttons?: OutgoingButton[]; [key: string]: unknown }>; [key: string]: unknown };
  replyMarkup?: { keyboard: Array<Array<{ url?: string; [key: string]: unknown }>>; [key: string]: unknown };
  [key: string]: unknown;
}

export interface OutgoingContext {
  workspaceId: string;
  contactId: string | null | undefined;
  flowId: string | null | undefined;
  platform: string | null | undefined;
  variables?: Record<string, unknown> | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lee la config del nodo; cualquier cosa rara es «apagado». */
export function readNodeAttribution(raw: unknown): NodeAttribution | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const a = raw as { append?: unknown; trackClicks?: unknown };
  if (a.append !== true) return null;
  return { append: true, trackClicks: a.trackClicks === true };
}

function collectUrls(message: OutgoingMessage): string[] {
  const found = new Set<string>();
  mapUrlsInText(message.text, (u) => (found.add(u), u));
  for (const b of message.buttons ?? []) if (typeof b.url === "string") found.add(b.url);
  for (const el of message.template?.elements ?? []) for (const b of el.buttons ?? []) if (typeof b.url === "string") found.add(b.url);
  for (const row of message.replyMarkup?.keyboard ?? []) for (const k of row) if (typeof k.url === "string") found.add(k.url);
  return [...found];
}

export async function attributeOutgoing(
  supabase: Db,
  context: OutgoingContext,
  rawAttribution: unknown,
  message: OutgoingMessage,
): Promise<OutgoingMessage> {
  const attribution = readNodeAttribution(rawAttribution);
  if (!attribution) return message;
  try {
    const urls = collectUrls(message);
    if (urls.length === 0) return message;

    let flowName: string | null = null;
    if (context.flowId && UUID.test(context.flowId)) {
      const { data } = await supabase.from("flows").select("name").eq("id", context.flowId).maybeSingle();
      flowName = (data as { name?: string | null } | null)?.name ?? null;
    }
    const content = context.variables?.content as { code?: unknown; content_post_id?: unknown; social_post_id?: unknown } | null | undefined;
    const uuidOrNull = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v : null);
    const ctx: LinkAttributionContext = {
      platform: context.platform,
      flowName,
      flowId: context.flowId,
      contentCode: typeof content?.code === "string" ? content.code : null,
    };

    const canTrack = attribution.trackClicks && !!context.contactId && UUID.test(context.contactId) && !!context.flowId && UUID.test(context.flowId) && UUID.test(context.workspaceId);
    let secret: string | null = null;
    const resolved = new Map<string, string>();
    for (const url of urls) {
      const withUtm = buildAttributedUrl(url, ctx);
      let final = withUtm;
      if (canTrack && /^https?:\/\//i.test(withUtm.trim()) && !isChatLink(withUtm.trim())) {
        try {
          secret ??= await getOrCreateAttributionLinkSecret(supabase, context.workspaceId);
          const token = signTrackedLink(
            { w: context.workspaceId, c: context.contactId!, u: withUtm.trim(), f: context.flowId!, p: uuidOrNull(content?.content_post_id), s: uuidOrNull(content?.social_post_id) },
            secret,
          );
          final = `${appUrl().replace(/\/$/, "")}/l/${token}`;
        } catch (e) {
          // Sin seguimiento: el link sale con sus UTM.
          console.error("[atribucion] no pude firmar el link con seguimiento:", e instanceof Error ? e.message : String(e));
        }
      }
      resolved.set(url, final);
    }
    const swap = (u: string) => resolved.get(u) ?? u;

    return {
      ...message,
      text: mapUrlsInText(message.text, swap),
      ...(message.buttons ? { buttons: message.buttons.map((b) => (typeof b.url === "string" ? { ...b, url: swap(b.url) } : b)) } : {}),
      ...(message.template
        ? { template: { ...message.template, elements: message.template.elements.map((el) => (el.buttons ? { ...el, buttons: el.buttons.map((b) => (typeof b.url === "string" ? { ...b, url: swap(b.url) } : b)) } : el)) } }
        : {}),
      ...(message.replyMarkup
        ? { replyMarkup: { ...message.replyMarkup, keyboard: message.replyMarkup.keyboard.map((row) => row.map((k) => (typeof k.url === "string" ? { ...k, url: swap(k.url) } : k))) } }
        : {}),
    };
  } catch (e) {
    console.error("[atribucion] fallo la atribución de los links del mensaje:", e instanceof Error ? e.message : String(e));
    return message;
  }
}
