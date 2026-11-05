/**
 * Importar el historial de WhatsApp que Evolution tiene guardado.
 *
 * Lee la base del propio Evolution, sin pedirle nada a WhatsApp, y corre en la cola
 * por partes (`whatsapp_history_import`). Las reglas estan en `./import-state.ts` y
 * `./import-chat.ts`, que son puras. Aca solo se habla con la base y con Evolution.
 *
 * Lo importado es historia: no suma no leidos, no dispara automatizaciones, el
 * agente, las reglas de asignacion ni toques de atribucion, y no pisa una
 * conversacion que ya existe. Volver a importar no duplica nada (indice unico por
 * conversacion y `platform_message_id`).
 *
 * No lanza por un fallo de Evolution: la cola reintentaria a los 10 segundos encima
 * de la espera propia. Un error de la base si lanza, y la cola lo reintenta.
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { getEvolutionConfig } from "@/lib/evolution-config";
import {
  EvolutionError,
  findStoredChatMessagesPage,
  findStoredChats,
  type EvolutionConfig,
  type EvolutionStoredChat,
  type EvolutionStoredMessage,
} from "@/lib/evolution-client";
import { insertHistoricMessages, type HistoricMessageRow } from "@/lib/inbound";
import { upsertContactForSender } from "@/lib/inbox-sync";
import { scheduleJob } from "@/lib/scheduler";
import { withKnownLid } from "@/lib/whatsapp-known-lid";
import { resolveWhatsappSender } from "@/lib/whatsapp-sender";
import { importedConversationStatus, planChatImport, type ChatImportPlan } from "./import-chat";
import {
  afterBatch,
  afterImportFailure,
  canStartWhatsappImport,
  describeEvolutionFailure,
  newWhatsappImportState,
  parseWhatsappImportState,
  type BatchResult,
  type NextStep,
  type WhatsappImportState,
} from "./import-state";

type Db = SupabaseClient<Database>;

export const WHATSAPP_HISTORY_IMPORT_JOB = "whatsapp_history_import";

/** Tope de chats que se leen: el mismo de la revision. */
export const IMPORT_CHAT_LIMIT = 5000;
/** Por vuelta: el que se cumpla primero. Asi una vuelta no tarda minutos. */
export const CHATS_PER_STEP = 25;
export const STEP_BUDGET_MS = 60_000;
/** Mensajes por pedido a Evolution, y pedidos por chat (20.000 mensajes por chat). */
export const MESSAGES_PAGE_SIZE = 200;
export const MAX_PAGES_PER_CHAT = 100;
const ROWS_PER_INSERT = 200;
const IDS_PER_LOOKUP = 200;

/**
 * Los eventos que nacen de crear o completar un contacto. Una importacion no dispara
 * automatizaciones, igual que la de contactos por CSV.
 */
const IMPORT_SUPPRESSED_EVENTS = ["contact_created", "assignment_changed"];

const SUPPRESS_MARGIN_MS = 60_000;

export interface WhatsappImportPayload {
  workspaceId: string;
  channelId: string;
  runId: string;
  step: number;
}

/** Lo que se puede reemplazar en los tests. */
export interface WhatsappImportDeps {
  now?: () => Date;
  getConfig?: (service: Db, workspaceId: string) => Promise<EvolutionConfig | null>;
  findChats?: typeof findStoredChats;
  findMessages?: typeof findStoredChatMessagesPage;
  schedule?: typeof scheduleJob;
  newRunId?: () => string;
}

interface ChannelRow {
  id: string;
  workspace_id: string;
  platform: string;
  provider: string;
  is_active: boolean;
  evolution_instance: string | null;
  inbox_import: unknown;
}

async function loadChannel(service: Db, workspaceId: string, channelId: string): Promise<ChannelRow | null> {
  const { data, error } = await service
    .from("channels")
    .select("id, workspace_id, platform, provider, is_active, evolution_instance, inbox_import")
    .eq("id", channelId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`no pude leer el canal ${channelId}: ${error.message}`);
  return (data as ChannelRow | null) ?? null;
}

function stepKey(channelId: string, runId: string, step: number): string {
  return `${WHATSAPP_HISTORY_IMPORT_JOB}:${channelId}:${runId}:${step}`;
}

export type StartWhatsappImportResult =
  | { started: true; runId: string }
  | { started: false; reason: "not_found" | "not_evolution" | "inactive" | "running" | "queue" };

/** Arma una corrida y encola su primera vuelta. El workspace sale de la sesion de quien llama. */
export async function startWhatsappImport(
  service: Db,
  target: { workspaceId: string; channelId: string },
  deps: WhatsappImportDeps = {},
): Promise<StartWhatsappImportResult> {
  const now = (deps.now ?? (() => new Date()))();
  const channel = await loadChannel(service, target.workspaceId, target.channelId);
  if (!channel) return { started: false, reason: "not_found" };
  if (channel.provider !== "evolution" || !channel.evolution_instance) return { started: false, reason: "not_evolution" };
  if (!channel.is_active) return { started: false, reason: "inactive" };
  if (!canStartWhatsappImport(parseWhatsappImportState(channel.inbox_import), now)) {
    return { started: false, reason: "running" };
  }

  const runId = (deps.newRunId ?? randomUUID)();
  const state = newWhatsappImportState(runId, now);
  await writeState(service, channel.id, state);

  try {
    await (deps.schedule ?? scheduleJob)(
      service,
      WHATSAPP_HISTORY_IMPORT_JOB,
      { workspaceId: channel.workspace_id, channelId: channel.id, runId, step: 0 } satisfies WhatsappImportPayload,
      now,
      stepKey(channel.id, runId, 0),
    );
  } catch (err) {
    console.error(`[whatsapp-import] no pude encolar la importacion del canal ${channel.id}:`, errorText(err));
    await writeState(service, channel.id, {
      ...state,
      status: "partial",
      finished_at: now.toISOString(),
      last_error: "No pude poner la importación en la cola. Probá de nuevo en un rato.",
    });
    return { started: false, reason: "queue" };
  }
  return { started: true, runId };
}

export type WhatsappImportOutcome = "channel_gone" | "superseded" | "continued" | "waiting" | "finished";

/** Una vuelta del trabajo: unos chats, el avance guardado y la vuelta siguiente en la cola. */
export async function runWhatsappImportStep(
  service: Db,
  payload: WhatsappImportPayload,
  deps: WhatsappImportDeps = {},
): Promise<WhatsappImportOutcome> {
  const clock = deps.now ?? (() => new Date());
  const channel = await loadChannel(service, payload.workspaceId, payload.channelId);
  if (!channel || !channel.is_active || channel.provider !== "evolution" || !channel.evolution_instance) {
    return "channel_gone";
  }

  const loaded = parseWhatsappImportState(channel.inbox_import);
  // Otra corrida la reemplazo, otra vuelta ya avanzo este paso, o ya termino.
  if (!loaded || loaded.run_id !== payload.runId || loaded.step !== payload.step || loaded.status !== "running") {
    return "superseded";
  }

  let state: WhatsappImportState;
  let next: NextStep;
  const config = await (deps.getConfig ?? getEvolutionConfig)(service, channel.workspace_id);
  if (!config) {
    ({ state, next } = afterImportFailure(
      loaded,
      emptyBatch(loaded),
      { temporary: false, message: "Falta la configuración de Evolution en Integraciones." },
      clock(),
    ));
  } else {
    ({ state, next } = await importBatch(service, channel, config, loaded, deps, clock));
  }

  const advanced: WhatsappImportState = { ...state, step: loaded.step + 1 };
  if (!(await writeStateIfCurrent(service, channel.id, advanced, loaded))) return "superseded";

  if (next.kind === "finished") {
    console.log(
      `[whatsapp-import] canal ${channel.id}: ${advanced.status}, ${advanced.conversations} conversaciones nuevas, ${advanced.messages} mensajes`,
    );
    return "finished";
  }

  await (deps.schedule ?? scheduleJob)(
    service,
    WHATSAPP_HISTORY_IMPORT_JOB,
    {
      workspaceId: channel.workspace_id,
      channelId: channel.id,
      runId: advanced.run_id,
      step: advanced.step,
    } satisfies WhatsappImportPayload,
    next.kind === "wait" ? next.runAt : clock(),
    stepKey(channel.id, advanced.run_id, advanced.step),
  );
  return next.kind === "wait" ? "waiting" : "continued";
}

function emptyBatch(state: WhatsappImportState): BatchResult {
  return { lastChat: null, total: state.total, scanned: 0, conversations: 0, messages: 0, failed: 0, hasMore: true, truncated: false };
}

/**
 * Los chats en orden por su id, nunca por fecha: un chat que recibe un mensaje nuevo
 * no cambia de lugar, asi que ninguno queda atras del cursor sin haberse mirado.
 */
export function chatsToImport(chats: EvolutionStoredChat[]): EvolutionStoredChat[] {
  return chats
    .filter((chat) => resolveWhatsappSender({ remoteJid: chat.remoteJid ?? null }) !== null)
    .sort((a, b) => (a.remoteJid! < b.remoteJid! ? -1 : a.remoteJid! > b.remoteJid! ? 1 : 0));
}

async function importBatch(
  service: Db,
  channel: ChannelRow,
  config: EvolutionConfig,
  state: WhatsappImportState,
  deps: WhatsappImportDeps,
  clock: () => Date,
): Promise<{ state: WhatsappImportState; next: NextStep }> {
  const instance = channel.evolution_instance!;
  const batch = emptyBatch(state);
  try {
    const stored = await (deps.findChats ?? findStoredChats)(config, instance, IMPORT_CHAT_LIMIT);
    const people = chatsToImport(stored);
    batch.total = people.length;
    batch.truncated = stored.length >= IMPORT_CHAT_LIMIT;
    const pending = people.filter((chat) => state.cursor === null || chat.remoteJid! > state.cursor);

    const startedAt = clock().getTime();
    let done = 0;
    for (const chat of pending) {
      if (done >= CHATS_PER_STEP || clock().getTime() - startedAt > STEP_BUDGET_MS) break;
      const { records, truncated } = await readChatMessages(config, instance, chat.remoteJid!, deps);
      const plan = planChatImport(chat, records);
      if (plan) {
        const saved = await saveChat(service, channel, plan, clock());
        if (!saved) batch.failed += 1;
        else {
          batch.conversations += saved.createdConversation ? 1 : 0;
          batch.messages += saved.messages;
          if (truncated) batch.failed += 1;
        }
      }
      batch.scanned += 1;
      batch.lastChat = chat.remoteJid!;
      done += 1;
    }
    batch.hasMore = done < pending.length;
    return afterBatch(state, batch, clock());
  } catch (err) {
    // Un error de la base no se arregla como uno de Evolution: que lo reintente la cola.
    if (!(err instanceof EvolutionError)) throw err;
    console.error(`[whatsapp-import] canal ${channel.id}: Evolution fallo (${err.status ?? "sin codigo"}): ${err.message}`);
    return afterImportFailure(state, batch, describeEvolutionFailure(err.status), clock());
  }
}

/** Todos los mensajes guardados de un chat, hasta el tope. */
async function readChatMessages(
  config: EvolutionConfig,
  instance: string,
  remoteJid: string,
  deps: WhatsappImportDeps,
): Promise<{ records: EvolutionStoredMessage[]; truncated: boolean }> {
  const find = deps.findMessages ?? findStoredChatMessagesPage;
  const records: EvolutionStoredMessage[] = [];
  let page = 1;
  for (;;) {
    const result = await find(config, instance, remoteJid, page, MESSAGES_PAGE_SIZE);
    records.push(...result.records);
    if (page >= result.pages || result.records.length === 0) return { records, truncated: false };
    if (page >= MAX_PAGES_PER_CHAT) return { records, truncated: true };
    page += 1;
  }
}

/** Contacto, conversacion y mensajes de un chat. null si no se pudo resolver el contacto. */
async function saveChat(
  service: Db,
  channel: ChannelRow,
  plan: ChatImportPlan,
  now: Date,
): Promise<{ createdConversation: boolean; messages: number } | null> {
  const db = service as unknown as SupabaseClient;
  const sender = await withKnownLid(db, channel, plan.sender);
  // Con un margen: la fecha del evento la pone la base, y su reloj no es este.
  const startedAt = new Date(now.getTime() - SUPPRESS_MARGIN_MS).toISOString();
  const contact = await upsertContactForSender({
    supabase: db,
    channel,
    senderId: sender.id,
    senderName: plan.name,
    senderUsername: sender.phone,
    senderPicture: null,
    senderPhone: sender.phone,
    interactionAt: plan.lastAt,
    // Un contacto que ya existia no "interactuo" ahora: esto es historia.
    stampExisting: false,
  });
  if (!contact) return null;

  await silenceContactSideEffects(service, contact, startedAt);

  const conversation = await findOrCreateConversation(service, channel, contact.contactId, plan, now);
  const known = await knownMessageIds(service, conversation.id, plan.messages.map((m) => m.platformMessageId));
  const rows: HistoricMessageRow[] = plan.messages
    .filter((m) => !known.has(m.platformMessageId))
    .map((m) => ({
      conversation_id: conversation.id,
      workspace_id: channel.workspace_id,
      direction: m.direction,
      text: m.text,
      platform_message_id: m.platformMessageId,
      attachments: m.attachments,
      status: "delivered",
      // Lo que salio del telefono, igual que el eco que escribe el receptor.
      origin: m.direction === "outbound" ? "external" : null,
      created_at: m.createdAt,
    }));

  let messages = 0;
  for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
    messages += await insertHistoricMessages(db, rows.slice(i, i + ROWS_PER_INSERT));
  }
  return { createdConversation: conversation.created, messages };
}

/**
 * Crear un contacto emite `contact_created` y puede encolar la asignacion automatica
 * de un vendedor. Para un chat viejo nada de eso corresponde. Nunca tumba la importacion.
 */
async function silenceContactSideEffects(
  service: Db,
  contact: { contactId: string; existed: boolean },
  since: string,
): Promise<void> {
  try {
    await service
      .from("automation_events")
      .update({ processed_at: new Date().toISOString(), error: "importación de historial (no dispara automatizaciones)" } as never)
      .eq("contact_id", contact.contactId)
      .in("event_type", IMPORT_SUPPRESSED_EVENTS)
      .is("processed_at", null)
      .gte("created_at", since);
    if (!contact.existed) {
      await service
        .from("scheduled_jobs")
        .update({ status: "cancelled" } as never)
        .eq("type", "sales_contact_eval")
        .eq("status", "pending")
        .eq("payload->>contact_id", contact.contactId);
    }
  } catch (err) {
    console.error("[whatsapp-import] no pude apagar los eventos de la importacion:", errorText(err));
  }
}

async function findOrCreateConversation(
  service: Db,
  channel: ChannelRow,
  contactId: string,
  plan: ChatImportPlan,
  now: Date,
): Promise<{ id: string; created: boolean }> {
  const find = async () => {
    const { data, error } = await service
      .from("conversations")
      .select("id")
      .eq("channel_id", channel.id)
      .eq("contact_id", contactId)
      .maybeSingle();
    if (error) throw new Error(`no pude leer la conversacion: ${error.message}`);
    return data;
  };

  // Una que ya existe es del receptor: no se le toca el estado, el responsable ni los no leidos.
  const existing = await find();
  if (existing) return { id: existing.id, created: false };

  const { data, error } = await service
    .from("conversations")
    .insert({
      workspace_id: channel.workspace_id,
      channel_id: channel.id,
      contact_id: contactId,
      platform: channel.platform,
      status: importedConversationStatus(plan.lastAt, now),
      last_message_at: plan.lastAt,
      last_message_preview: plan.preview,
      unread_count: 0,
    } as never)
    .select("id")
    .single();
  if (data) return { id: (data as { id: string }).id, created: true };

  // La persona escribio justo ahora y el receptor la creo primero.
  if (error?.code === "23505") {
    const winner = await find();
    if (winner) return { id: winner.id, created: false };
  }
  throw new Error(`no pude crear la conversacion: ${error?.message ?? "sin detalle"}`);
}

async function knownMessageIds(service: Db, conversationId: string, ids: string[]): Promise<Set<string>> {
  const known = new Set<string>();
  for (let i = 0; i < ids.length; i += IDS_PER_LOOKUP) {
    const { data, error } = await service
      .from("messages")
      .select("platform_message_id")
      .eq("conversation_id", conversationId)
      .in("platform_message_id", ids.slice(i, i + IDS_PER_LOOKUP));
    if (error) throw new Error(`no pude leer los mensajes que ya estan: ${error.message}`);
    for (const row of data ?? []) {
      if (row.platform_message_id) known.add(row.platform_message_id);
    }
  }
  return known;
}

async function writeState(service: Db, channelId: string, state: WhatsappImportState): Promise<void> {
  const { error } = await service
    .from("channels")
    .update({ inbox_import: state as unknown as Json })
    .eq("id", channelId);
  if (error) throw new Error(`no pude guardar el avance de la importacion: ${error.message}`);
}

/** Guarda el avance solo si nadie lo cambio: dos vueltas no arman dos cadenas para el mismo canal. */
async function writeStateIfCurrent(
  service: Db,
  channelId: string,
  state: WhatsappImportState,
  expected: WhatsappImportState,
): Promise<boolean> {
  const { data, error } = await service
    .from("channels")
    .update({ inbox_import: state as unknown as Json })
    .eq("id", channelId)
    .eq("inbox_import->>run_id", expected.run_id)
    .eq("inbox_import->>step", String(expected.step))
    .select("id");
  if (error) throw new Error(`no pude guardar el avance de la importacion: ${error.message}`);
  return (data ?? []).length > 0;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
