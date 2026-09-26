import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { Zernio } from "@/lib/zernio-client";
import { createZernioClient } from "@/lib/zernio-client";
import { getZernioApiKey } from "@/lib/integrations/zernio-key";
import { rateLimitWaitMs, isZernioId, toMessageStatus, MAX_PAGES } from "@/lib/backfill-messages";
import { toInboxMessage } from "@/lib/zernio-message";
import { normalizeForGrouping } from "@/lib/text/normalize";
import { outboundMessageRow } from "@/lib/messages/outbound";

type Db = SupabaseClient<Database>;

/** Ventana para matchear un envío propio contra su eco por texto+tiempo. */
const OWN_SEND_MATCH_MS = 90_000;
const REFRESH_TIMEOUT_MS = 10_000;
const MAX_RATE_LIMIT_RETRIES = 3;
const DESC_LIMIT = 20;
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface RefreshResult {
  ok: boolean;
  inserted: number;
  error: string | null;
}

export interface RefreshArgs {
  conversationId: string;
  workspaceId: string;
  channelId: string;
  lateConversationId: string | null;
  /** Solo mira mensajes con created_at >= sinceIso (menos ruido, menos dedupe). */
  sinceIso: string;
  /** Run del turno actual: su propio envío nunca se marca external ni se duplica. */
  runId?: string | null;
}

/**
 * La función que el runner llama en los momentos 1 y 2 (F5). Inyectable en los
 * tests. El default resuelve el cliente de Zernio y refresca de verdad.
 */
export type RefreshFn = (supabase: Db, args: RefreshArgs) => Promise<RefreshResult>;

interface LocalRow {
  id: string;
  direction: string;
  text: string | null;
  created_at: string;
  platform_message_id: string | null;
  platform_native_message_id: string | null;
  sent_by_user_id: string | null;
  sent_by_agent_id: string | null;
  sent_by_flow_id: string | null;
  agent_run_id: string | null;
  status: string;
}

/**
 * Trae los ÚLTIMOS mensajes de la conversación desde Zernio (orden descendente)
 * y guarda los que faltan como `external`. Es la pieza que hace posible la
 * verificación antes de responder: Zernio no avisa por webhook lo que se manda
 * desde ManyChat o la app de Instagram (§10.1), sólo lo deja en el historial.
 *
 * Dedupe (por el hueco de espacios de ids del backfill):
 *  1. id igual en cualquiera de las dos columnas → ya está; rellena el id que falte.
 *  2. si no, un saliente PROPIO (con autor) con mismo texto normalizado y |Δt| ≤ 90 s
 *     → es el eco de un envío nuestro; rellena el id, nunca lo marca external.
 *  3. el envío propio de ESTE turno (agent_run_id = runId) nunca se toca.
 *  4. lo que no matchea se inserta como external (índice único descarta choques).
 *
 * Nunca lanza: el turno sigue aunque el refresco falle (best-effort). Timeout 10 s.
 */
export async function refreshConversationFromPlatform(
  supabase: Db,
  args: RefreshArgs,
  opts: { zernio?: Zernio; sleep?: (ms: number) => Promise<void> } = {},
): Promise<RefreshResult> {
  if (!args.lateConversationId) return { ok: false, inserted: 0, error: "sin late_conversation_id" };

  try {
    return await withTimeout(doRefresh(supabase, args, opts), REFRESH_TIMEOUT_MS);
  } catch (err) {
    return { ok: false, inserted: 0, error: err instanceof Error ? err.message : "refresco fallido" };
  }
}

async function doRefresh(
  supabase: Db,
  args: RefreshArgs,
  opts: { zernio?: Zernio; sleep?: (ms: number) => Promise<void> },
): Promise<RefreshResult> {
  const sleep = opts.sleep ?? defaultSleep;

  // Cuenta de Zernio del canal.
  const { data: channel } = await supabase
    .from("channels")
    .select("late_account_id")
    .eq("id", args.channelId)
    .maybeSingle();
  const accountId = (channel as { late_account_id?: string | null } | null)?.late_account_id;
  if (!accountId) return { ok: false, inserted: 0, error: "canal sin late_account_id" };

  let zernio = opts.zernio;
  if (!zernio) {
    const apiKey = await getZernioApiKey(args.workspaceId, { supabase });
    if (!apiKey) return { ok: false, inserted: 0, error: "sin API key de Zernio" };
    zernio = createZernioClient(apiKey);
  }

  // Últimos mensajes, orden descendente, una sola página.
  let raw: unknown[] = [];
  let retries = 0;
  for (;;) {
    try {
      const res = await zernio.messages.getInboxConversationMessages({
        path: { conversationId: args.lateConversationId },
        query: { accountId, limit: DESC_LIMIT, sortOrder: "desc" },
      });
      const body = (res?.data ?? {}) as { messages?: unknown[]; data?: unknown[] };
      raw = body.messages ?? body.data ?? [];
      break;
    } catch (err) {
      const wait = rateLimitWaitMs(err);
      if (wait !== null && retries < MAX_RATE_LIMIT_RETRIES) {
        retries++;
        await sleep(wait);
        continue;
      }
      return { ok: false, inserted: 0, error: err instanceof Error ? err.message : "error de red" };
    }
  }

  // Lo ya guardado en la ventana.
  const { data: localRows, error: readError } = await supabase
    .from("messages")
    .select(
      "id, direction, text, created_at, platform_message_id, platform_native_message_id, sent_by_user_id, sent_by_agent_id, sent_by_flow_id, agent_run_id, status",
    )
    .eq("conversation_id", args.conversationId)
    .gte("created_at", args.sinceIso);
  if (readError) return { ok: false, inserted: 0, error: readError.message };
  const local = (localRows ?? []) as LocalRow[];

  let inserted = 0;
  for (const item of raw) {
    const mapped = toInboxMessage(item, args.conversationId);
    const remoteId = mapped.platform_message_id;
    if (!remoteId) continue;

    // 1. Match por id en cualquiera de las dos columnas.
    const byId = local.find(
      (l) => l.platform_message_id === remoteId || l.platform_native_message_id === remoteId,
    );
    if (byId) {
      await backfillMissingId(supabase, byId, remoteId);
      continue;
    }

    // Sólo interesan los SALIENTES: son los que la verificación necesita ver.
    // Un entrante remoto que no tengamos vino de una desincronización rara y lo
    // trae el webhook/backfill; traerlo acá pediría enlazar contacto y no vale.
    if (mapped.direction !== "outbound") continue;

    // 2/3. Match de un envío propio por texto + Δt (incluye el de este turno).
    const own = local.find(
      (l) =>
        l.direction === "outbound" &&
        (l.sent_by_user_id || l.sent_by_agent_id || l.sent_by_flow_id || l.agent_run_id) &&
        normalizeForGrouping(l.text) === normalizeForGrouping(mapped.text) &&
        Math.abs(new Date(l.created_at).getTime() - new Date(mapped.created_at).getTime()) <= OWN_SEND_MATCH_MS,
    );
    if (own) {
      await backfillMissingId(supabase, own, remoteId);
      continue;
    }

    // 4. No matchea: es un saliente externo. Se inserta (el índice único
    // (conversation_id, platform_message_id) descarta un choque de ids).
    const { error: insertError } = await supabase.from("messages").insert(
      outboundMessageRow({
        conversationId: args.conversationId,
        workspaceId: args.workspaceId,
        origin: "external",
        text: mapped.text ?? "",
        status: toMessageStatus(isRecord(item) ? item.deliveryStatus : undefined),
        platformMessageId: remoteId,
        platformNativeMessageId: isZernioId(remoteId) ? null : remoteId,
        createdAt: mapped.created_at,
      }),
    );
    if (!insertError) inserted++;
    else if (insertError.code !== "23505") {
      console.error("[refresh] no pude guardar un saliente externo:", insertError.message);
    }
  }

  return { ok: true, inserted, error: null };
}

async function backfillMissingId(supabase: Db, local: LocalRow, remoteId: string): Promise<void> {
  const patch: Record<string, string> = {};
  if (!local.platform_message_id) patch.platform_message_id = remoteId;
  if (!local.platform_native_message_id && !isZernioId(remoteId)) patch.platform_native_message_id = remoteId;
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase.from("messages").update(patch).eq("id", local.id);
  if (error && error.code !== "23505") {
    console.error("[refresh] no pude rellenar el id del mensaje:", error.message);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout del refresco")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Default para TurnDeps.refresh: refresca de verdad contra Zernio. */
export const defaultRefresh: RefreshFn = (supabase, args) => refreshConversationFromPlatform(supabase, args);
