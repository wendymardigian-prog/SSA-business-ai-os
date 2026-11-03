/**
 * Inbox backfill from Zernio.
 *
 * The local `conversations` table is otherwise populated only by inbound
 * webhooks, so conversations that predate webhook registration never appear
 * in the Inbox (#12). This module imports one page of Zernio's inbox
 * conversations at a time; the paging, the retries and the repeat passes live
 * in the queue job (lib/jobs/handlers/inbox-import.ts) and its pure state
 * (lib/inbox-import/state.ts). There is no cap: the old one (4 pages x 50)
 * left every conversation past the 200 most recent out of the Inbox forever.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Zernio } from "./zernio-client";
import { messagePreview } from "@/lib/message-preview";
import { fallbackContactName, isPlaceholderName } from "@/lib/contacts/anonymous";

export interface BackfillChannel {
  id: string;
  late_account_id: string;
  platform: string;
}

/** Una conversacion que ya esta en la base, con el nombre que tiene hoy su contacto. */
interface KnownConversation {
  contactId: string | null;
  displayName: string | null;
}

/** Conversation item shape returned by Zernio's listInboxConversations. */
interface ZernioInboxConversation {
  id?: string;
  participantId?: string;
  participantName?: string;
  participantPicture?: string | null;
  /**
   * El @usuario de la persona. Zernio lo manda cuando Instagram lo expone (o
   * sea, cuando la persona ya escribio). Faltaba en esta interfaz, y como el
   * backfill no lo pasaba, ningun contacto importado quedaba con su usuario
   * aunque el dato estuviera ahi.
   */
  participantUsername?: string | null;
  lastMessage?: string;
  updatedTime?: string;
  status?: "active" | "archived";
  unreadCount?: number | null;
}

/**
 * Encuentra o crea el contacto detras de un remitente.
 *
 * La decision vive en la funcion find_or_link_contact de la base (migracion
 * 00025), que ademas del mapeo conocido en `contact_channels` busca al mismo
 * lead por telefono, email o username de la misma plataforma y lo vincula en
 * vez de duplicarlo. Es la misma funcion que llaman los receptores de webhooks,
 * asi que un contacto creado por el webhook y uno creado por el backfill son
 * siempre el mismo.
 *
 * Devuelve null si no se pudo resolver; `existed` dice si el remitente ya era
 * conocido. Con `stampExisting: false` no se toca `last_interaction_at` de un
 * contacto existente: el llamador lo sella cuando confirma la interaccion.
 */
export async function upsertContactForSender({
  supabase,
  channel,
  senderId,
  senderName,
  senderPicture,
  senderUsername,
  senderPhone,
  senderEmail,
  interactionAt,
  stampExisting = true,
}: {
  supabase: SupabaseClient;
  channel: { id: string; workspace_id: string };
  senderId: string;
  senderName: string;
  senderPicture: string | null;
  senderUsername?: string | null;
  senderPhone?: string | null;
  senderEmail?: string | null;
  interactionAt: string;
  stampExisting?: boolean;
}): Promise<{ contactId: string; existed: boolean } | null> {
  const { data, error } = await supabase.rpc("find_or_link_contact", {
    p_channel_id: channel.id,
    p_sender_id: senderId,
    p_display_name: senderName,
    p_username: senderUsername ?? null,
    p_avatar_url: senderPicture,
    p_phone: senderPhone ?? null,
    p_email: senderEmail ?? null,
    p_interaction_at: interactionAt,
    p_stamp_existing: stampExisting,
  });

  if (error || !data?.contact_id) {
    console.error("[inbox-sync] no pude resolver el contacto:", error?.message);
    return null;
  }

  return { contactId: data.contact_id, existed: Boolean(data.existed) };
}

/**
 * Una pagina de conversaciones de Zernio, importada (00267).
 *
 * Insert-only: una conversacion ya conocida (por `late_conversation_id`) se
 * saltea, y una persona que ya tiene su fila en `(channel_id, contact_id)` con
 * otro id de Zernio queda como esta (la mantiene el webhook: no se pisan su id,
 * su estado, su ultimo mensaje ni sus no leidos). Por eso tambien es inofensivo
 * volver a recorrer todo: lo que ya esta no se toca ni se cuenta.
 *
 * No atrapa los errores de Zernio: el SDK lanza ante cualquier respuesta que no
 * sea 2xx, y quien llama (el trabajo de la cola) decide si espera o corta. Lee
 * `meta.failedAccounts`, donde Zernio avisa que esa cuenta fallo de su lado: una
 * lista vacia con ese aviso no es "no hay conversaciones".
 *
 * Nada de lo que importa dispara automatizaciones, el agente ni las reglas de
 * asignacion: es historia, no un mensaje nuevo.
 */
export async function importInboxPage({
  service,
  zernio,
  workspaceId,
  channel,
  phase,
  cursor,
  pageSize,
}: {
  /**
   * Con el de servicio: corre en la cola, sin sesion, y find_or_link_contact
   * quedo restringida al service role. Quien encolo la importacion ya valido
   * el permiso (channels.manage) y saco el workspace de la sesion.
   */
  service: SupabaseClient;
  zernio: Zernio;
  workspaceId: string;
  channel: BackfillChannel;
  phase: "active" | "archived";
  cursor: string | null;
  pageSize: number;
}): Promise<{
  received: number;
  imported: number;
  hasMore: boolean;
  nextCursor: string | null;
  /** El motivo, si Zernio dijo que esta cuenta fallo de su lado. */
  accountFailure: string | null;
}> {
  const res = await zernio.messages.listInboxConversations({
    query: {
      accountId: channel.late_account_id,
      limit: pageSize,
      sortOrder: "desc",
      status: phase,
      ...(cursor ? { cursor } : {}),
    },
  });

  const body = res.data as
    | {
        data?: ZernioInboxConversation[];
        pagination?: { hasMore?: boolean; nextCursor?: string | null };
        meta?: { failedAccounts?: Array<{ accountId?: string; error?: string; code?: string }> };
      }
    | undefined;

  const failed = (body?.meta?.failedAccounts ?? []).find(
    (f) => !f.accountId || f.accountId === channel.late_account_id,
  );
  if (failed) {
    return {
      received: 0,
      imported: 0,
      hasMore: false,
      nextCursor: null,
      accountFailure: failed.error || failed.code || "Zernio no pudo leer esta cuenta",
    };
  }

  const conversations = (body?.data ?? []).filter((c) => c.id && c.participantId);

  // Solo los ids de ESTA pagina: con miles de conversaciones, cargar todos los
  // conocidos al empezar seria pesado y quedaria viejo entre vuelta y vuelta.
  const ids = conversations.map((c) => c.id!);
  const known = new Map<string, KnownConversation>();
  if (ids.length > 0) {
    const { data: rows, error } = await service
      .from("conversations")
      .select("late_conversation_id, contact_id, contacts(display_name)")
      .eq("channel_id", channel.id)
      .in("late_conversation_id", ids);
    if (error) throw new Error(`no pude leer las conversaciones conocidas: ${error.message}`);
    for (const row of (rows ?? []) as unknown as Array<{
      late_conversation_id: string | null;
      contact_id?: string | null;
      contacts?: { display_name: string | null } | null;
    }>) {
      if (!row.late_conversation_id) continue;
      known.set(row.late_conversation_id, {
        contactId: row.contact_id ?? null,
        displayName: row.contacts?.display_name ?? null,
      });
    }
  }

  let imported = 0;
  // Una persona puede tener varias conversaciones en Zernio y la tabla admite
  // una por persona y canal: con sortOrder desc, la primera que aparece es la
  // mas reciente y las demas se saltean (el indice unico las descartaria igual,
  // pero asi no se resuelve el contacto de balde). Entre paginas lo cuida ese
  // mismo indice.
  const seenParticipants = new Set<string>();
  for (const conv of conversations) {
    if (seenParticipants.has(conv.participantId!)) continue;
    seenParticipants.add(conv.participantId!);
    if (known.has(conv.id!)) {
      await completeKnownContactName({ service, workspaceId, channel, conv, current: known.get(conv.id!)! });
      continue;
    }
    if (await importConversation({ service, workspaceId, channel, conv })) imported++;
  }

  const pagination = body?.pagination;
  return {
    received: (body?.data ?? []).length,
    imported,
    hasMore: Boolean(pagination?.hasMore && pagination?.nextCursor),
    nextCursor: pagination?.nextCursor ?? null,
    accountFailure: null,
  };
}

/**
 * Una conversacion que ya esta cuyo contacto quedo con un relleno como nombre
 * (el id de Instagram, "@usuario") recibe lo que Zernio trae ahora: Zernio
 * completa el perfil cuando la persona interactua, y la importacion vuelve a
 * pasar a las 24 horas y a los 7 dias.
 *
 * - Con un nombre de verdad: por la regla de siempre (`find_or_link_contact`),
 *   que solo pisa un relleno y completa usuario y foto. No sella la fecha.
 * - Con solo el @usuario y un id como nombre: "@usuario", condicionado a que el
 *   nombre siga siendo ese id (la base no cambia un relleno por otro).
 *
 * Nunca toca la conversacion, y un fallo no frena la importacion.
 */
async function completeKnownContactName({
  service,
  workspaceId,
  channel,
  conv,
  current,
}: {
  service: SupabaseClient;
  workspaceId: string;
  channel: BackfillChannel;
  conv: ZernioInboxConversation;
  current: KnownConversation;
}): Promise<void> {
  if (!isPlaceholderName(current.displayName)) return;
  const name = (conv.participantName ?? "").trim();
  try {
    if (name && !isPlaceholderName(name)) {
      await upsertContactForSender({
        supabase: service,
        channel: { id: channel.id, workspace_id: workspaceId },
        senderId: conv.participantId!,
        senderName: name,
        senderPicture: conv.participantPicture || null,
        senderUsername: conv.participantUsername || null,
        interactionAt: conv.updatedTime ?? new Date().toISOString(),
        stampExisting: false,
      });
      return;
    }
    const handle = fallbackContactName(null, conv.participantUsername, "");
    const currentName = (current.displayName ?? "").trim();
    if (!handle || !current.contactId || currentName !== conv.participantId) return;
    const { error } = await service
      .from("contacts")
      .update({ display_name: handle })
      .eq("id", current.contactId)
      .eq("display_name", current.displayName!);
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error(`[inbox-sync] no pude completar el nombre de la conversacion ${conv.id}:`, err);
  }
}

async function importConversation({
  service,
  workspaceId,
  channel,
  conv,
}: {
  service: SupabaseClient;
  workspaceId: string;
  channel: BackfillChannel;
  conv: ZernioInboxConversation;
}): Promise<boolean> {
  const interactionAt = conv.updatedTime ?? new Date().toISOString();
  const contact = await upsertContactForSender({
    supabase: service,
    channel: { id: channel.id, workspace_id: workspaceId },
    senderId: conv.participantId!,
    senderName: fallbackContactName(conv.participantName, conv.participantUsername, conv.participantId!),
    senderPicture: conv.participantPicture || null,
    senderUsername: conv.participantUsername || null,
    interactionAt,
    stampExisting: false,
  });

  if (!contact) {
    console.error(`[inbox-sync] failed to create contact for conversation ${conv.id}`);
    return false;
  }

  // ignoreDuplicates: an existing (channel_id, contact_id) row is owned by the
  // webhook (possibly under a different late_conversation_id) and must stay
  // untouched; the conflict then returns no rows, so it is not counted as
  // imported either.
  const { data: insertedRows, error } = await service
    .from("conversations")
    .upsert(
      {
        workspace_id: workspaceId,
        channel_id: channel.id,
        contact_id: contact.contactId,
        platform: channel.platform,
        late_conversation_id: conv.id,
        status: conv.status === "archived" ? "closed" : "open",
        last_message_at: conv.updatedTime ?? null,
        last_message_preview: messagePreview(conv.lastMessage),
        unread_count: conv.unreadCount ?? 0,
      },
      { onConflict: "channel_id,contact_id", ignoreDuplicates: true }
    )
    .select("id");

  if (error) {
    console.error(`[inbox-sync] failed to upsert conversation ${conv.id}:`, error);
    return false;
  }

  const inserted = (insertedRows ?? []).length > 0;

  // Stamp the existing contact only after the conversation row was actually
  // inserted; a webhook-owned duplicate is not a new interaction.
  if (inserted && contact.existed) {
    await service
      .from("contacts")
      .update({ last_interaction_at: interactionAt })
      .eq("id", contact.contactId);
  }

  return inserted;
}
