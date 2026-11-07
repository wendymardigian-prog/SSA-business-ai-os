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
import { loadPublicBaseUrl } from "@/lib/public-url";
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
  /**
   * El paso que manda el mensaje y la ejecucion: con «Registrar el clic», cada link sale con su paso y su clave (`t` el
   * texto, `b0`… los botones) para que el lienzo cuente los clics por boton. Sin paso, el link firma igual que siempre.
   */
  nodeId?: string | null;
  sessionId?: string | null;
  /** Un paso con varios mensajes: el segundo en adelante antepone `m1-`, `m2-`… a la clave de cada link. */
  linkPrefix?: string | null;
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
    let base: string | null = null;
    const nodeId = context.nodeId && /^[A-Za-z0-9_-]{1,64}$/.test(context.nodeId) ? context.nodeId : null;
    const sessionId = context.sessionId && UUID.test(context.sessionId) ? context.sessionId : null;
    const resolved = new Map<string, string>();
    /** El link final de una URL. `key` dice cual de los links del paso es (solo cuenta si hay paso). */
    const prefix = context.linkPrefix && /^[A-Za-z0-9_-]{1,16}$/.test(context.linkPrefix) ? context.linkPrefix : "";
    const resolve = async (url: string, rawKey: string): Promise<string> => {
      const key = `${prefix}${rawKey}`;
      const cacheKey = nodeId ? `${key}|${url}` : url;
      const cached = resolved.get(cacheKey);
      if (cached !== undefined) return cached;
      const withUtm = buildAttributedUrl(url, ctx);
      let final = withUtm;
      if (canTrack && /^https?:\/\//i.test(withUtm.trim()) && !isChatLink(withUtm.trim())) {
        try {
          secret ??= await getOrCreateAttributionLinkSecret(supabase, context.workspaceId);
          const token = signTrackedLink(
            {
              w: context.workspaceId,
              c: context.contactId!,
              u: withUtm.trim(),
              f: context.flowId!,
              p: uuidOrNull(content?.content_post_id),
              s: uuidOrNull(content?.social_post_id),
              ...(nodeId ? { n: nodeId, b: key, r: sessionId } : {}),
            },
            secret,
          );
          // El lead toca el link: con el dominio del negocio (o el principal).
          base ??= await loadPublicBaseUrl(supabase, context.workspaceId);
          final = `${base.replace(/\/$/, "")}/l/${token}`;
        } catch (e) {
          // Sin seguimiento: el link sale con sus UTM.
          console.error("[atribucion] no pude firmar el link con seguimiento:", e instanceof Error ? e.message : String(e));
        }
      }
      resolved.set(cacheKey, final);
      return final;
    };

    // El texto primero (todas sus URLs con la clave `t`), despues cada boton con la suya.
    const textUrls: string[] = [];
    mapUrlsInText(message.text, (u) => (textUrls.push(u), u));
    const textMap = new Map<string, string>();
    for (const url of textUrls) textMap.set(url, await resolve(url, "t"));

    const mapButtons = async <T extends { url?: unknown }>(list: T[], prefix: string): Promise<T[]> => {
      const out: T[] = [];
      for (const [i, b] of list.entries()) out.push(typeof b.url === "string" ? { ...b, url: await resolve(b.url, `${prefix}${i}`) } : b);
      return out;
    };
    const buttons = message.buttons ? await mapButtons(message.buttons, "b") : undefined;
    const template = message.template
      ? {
          ...message.template,
          elements: await Promise.all(
            message.template.elements.map(async (el, e) => (el.buttons ? { ...el, buttons: await mapButtons(el.buttons, `c${e}-`) } : el)),
          ),
        }
      : undefined;
    const replyMarkup = message.replyMarkup
      ? {
          ...message.replyMarkup,
          keyboard: await Promise.all(message.replyMarkup.keyboard.map((row, r) => mapButtons(row, `k${r}-`))),
        }
      : undefined;

    return {
      ...message,
      text: mapUrlsInText(message.text, (u) => textMap.get(u) ?? u),
      ...(buttons ? { buttons } : {}),
      ...(template ? { template } : {}),
      ...(replyMarkup ? { replyMarkup } : {}),
    };
  } catch (e) {
    console.error("[atribucion] fallo la atribución de los links del mensaje:", e instanceof Error ? e.message : String(e));
    return message;
  }
}
