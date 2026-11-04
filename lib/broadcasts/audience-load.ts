/**
 * La audiencia de un broadcast contra la base: los MISMOS filtros que la lista
 * de Contactos (`prepareContactList` + `applyListClauses`), leídos con el
 * cliente de la PERSONA (la RLS decide qué contactos ve), y clasificados por
 * canal con `classifyRecipient`. Lo usan los conteos de la pantalla y la cola
 * al confirmar: el número que se ve es el que se manda.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { applyListClauses, contactListSelect } from "@/lib/contacts/list-query";
import { loadCustomFieldRefs, prepareContactList } from "@/lib/contacts/list-load";
import type { CustomFieldRef } from "@/lib/contacts/list-filters";
import { MENU_FILTER_PARAMS } from "@/lib/contacts/list-query";
import { firstParam, sanitizeSearch, type SearchParams } from "@/lib/url-params";
import {
  MAX_AUDIENCE,
  addToReach,
  classifyRecipient,
  emptyReach,
  type AudienceContact,
  type BroadcastChannelKind,
  type Classification,
  type ReachSummary,
} from "./audience";

type Client = SupabaseClient<Database>;

const PAGE = 1000;
const IN_CHUNK = 150;
const AUDIENCE_COLUMNS = "id, display_name, phone, whatsapp_phone, email, email_status, do_not_contact, is_subscribed";

/** Los parámetros de audiencia que se guardan: los filtros del menú de Contactos, la búsqueda y "anónimos". */
const AUDIENCE_PARAM_KEYS = new Set([...MENU_FILTER_PARAMS, "q", "anon"]);
const MAX_PARAM_VALUES = 50;
const MAX_PARAM_LENGTH = 200;

/** Limpia lo que llega del navegador: solo claves conocidas, textos y listas cortas. */
export function sanitizeAudienceParams(raw: unknown): Record<string, string | string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!AUDIENCE_PARAM_KEYS.has(key)) continue;
    const list = (Array.isArray(value) ? value : [value])
      .filter((v): v is string => typeof v === "string" && v.trim() !== "")
      .map((v) => v.slice(0, MAX_PARAM_LENGTH))
      .slice(0, MAX_PARAM_VALUES);
    if (list.length === 0) continue;
    out[key] = list.length === 1 ? list[0] : list;
  }
  return out;
}

/** Lo guardado (jsonb) como parámetros de URL. */
export function audienceParamsOf(json: Json | null | undefined): SearchParams {
  return sanitizeAudienceParams(json);
}

export interface AudienceRow extends AudienceContact {
  display_name: string | null;
}

export interface ResolvedRecipient {
  contactId: string;
  displayName: string | null;
  classification: Classification;
}

export interface ResolvedAudience {
  reach: ReachSummary;
  /** Todos los contactos (con `collect`), en orden de id. */
  recipients: ResolvedRecipient[];
  /** Los primeros, para "Ver a quiénes". */
  sample: ResolvedRecipient[];
  /** La audiencia pasaba el tope y se cortó. */
  truncated: boolean;
  customFields: CustomFieldRef[];
}

/**
 * Recorre la audiencia entera en tandas y la clasifica para el canal. Con
 * `collect: false` solo cuenta (y guarda una muestra).
 */
export async function resolveAudience(
  userClient: Client,
  service: Client,
  input: {
    workspaceId: string;
    params: SearchParams;
    channel: { id: string; kind: BroadcastChannelKind };
    includePhoneOnly: boolean;
    timeZone: string;
    collect: boolean;
    sampleSize?: number;
    now?: Date;
  },
): Promise<ResolvedAudience> {
  const customFields = await loadCustomFieldRefs(userClient, input.workspaceId);
  const search = sanitizeSearch(firstParam(input.params.q));
  const { plan } = await prepareContactList(userClient, input.workspaceId, input.params, customFields, search, {
    now: input.now ?? new Date(),
    timeZone: input.timeZone,
  });

  const reach = emptyReach();
  const recipients: ResolvedRecipient[] = [];
  const sample: ResolvedRecipient[] = [];
  const sampleSize = input.sampleSize ?? 50;
  let truncated = false;

  for (let from = 0; ; from += PAGE) {
    const base = userClient
      .from("contacts")
      .select(contactListSelect(AUDIENCE_COLUMNS, plan))
      .eq("workspace_id", input.workspaceId)
      .is("deleted_at", null);
    const { data, error } = await applyListClauses(base, plan.clauses)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`No pude leer la audiencia: ${error.message}`);
    const rows = (data ?? []) as unknown as AudienceRow[];
    if (rows.length === 0) break;

    const links = input.channel.kind === "whatsapp" ? await loadWhatsappLinks(service, input.channel.id, rows.map((r) => r.id)) : new Map<string, string>();

    for (const row of rows) {
      if (reach.total >= MAX_AUDIENCE) {
        truncated = true;
        break;
      }
      const classification = classifyRecipient(row, {
        kind: input.channel.kind,
        linkedSenderId: links.get(row.id) ?? null,
        includePhoneOnly: input.includePhoneOnly,
      });
      addToReach(reach, classification);
      const item = { contactId: row.id, displayName: row.display_name, classification };
      if (input.collect) recipients.push(item);
      if (sample.length < sampleSize) sample.push(item);
    }
    if (truncated || rows.length < PAGE) break;
  }

  return { reach, recipients, sample, truncated, customFields };
}

/** contacto → su id en este número de WhatsApp (teléfono o @lid), para los que ya escribieron. */
async function loadWhatsappLinks(service: Client, channelId: string, contactIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < contactIds.length; i += IN_CHUNK) {
    const { data, error } = await service
      .from("contact_channels")
      .select("contact_id, platform_sender_id")
      .eq("channel_id", channelId)
      .in("contact_id", contactIds.slice(i, i + IN_CHUNK));
    if (error) throw new Error(`No pude leer los vínculos de WhatsApp: ${error.message}`);
    for (const link of data ?? []) if (link.platform_sender_id) out.set(link.contact_id, link.platform_sender_id);
  }
  return out;
}

export interface RenderData {
  contact: { display_name: string | null; email: string | null; phone: string | null; whatsapp_phone: string | null };
  customValues: Record<string, string | null>;
}

/** Los datos que usan las variables del mensaje, para estos contactos (con el cliente de servicio, ya validados). */
export async function loadRenderData(
  service: Client,
  workspaceId: string,
  contactIds: string[],
  customFields: readonly CustomFieldRef[],
): Promise<Map<string, RenderData>> {
  const out = new Map<string, RenderData>();
  if (contactIds.length === 0) return out;
  const slugById = new Map(customFields.map((f) => [f.id, f.slug]));
  for (let i = 0; i < contactIds.length; i += IN_CHUNK) {
    const ids = contactIds.slice(i, i + IN_CHUNK);
    const [contacts, values] = await Promise.all([
      service.from("contacts").select("id, display_name, email, phone, whatsapp_phone").eq("workspace_id", workspaceId).in("id", ids),
      customFields.length > 0
        ? service.from("contact_custom_fields").select("contact_id, field_id, value").in("contact_id", ids)
        : Promise.resolve({ data: [] as { contact_id: string; field_id: string; value: string }[], error: null }),
    ]);
    if (contacts.error) throw new Error(`No pude leer los contactos: ${contacts.error.message}`);
    for (const c of contacts.data ?? []) {
      out.set(c.id, { contact: { display_name: c.display_name, email: c.email, phone: c.phone, whatsapp_phone: c.whatsapp_phone }, customValues: {} });
    }
    for (const v of values.data ?? []) {
      const slug = slugById.get(v.field_id);
      const entry = out.get(v.contact_id);
      if (slug && entry) entry.customValues[slug] = v.value;
    }
  }
  return out;
}
