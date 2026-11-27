"use server";

import { getWorkspace } from "@/lib/workspace";
import { getPermissionContext } from "@/lib/auth/guards";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { resolveDateRange } from "@/lib/dates";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { canUseInbox } from "@/lib/inbox/channel-access";
import { inboxListContext, paramsFromQuery, parseInboxListParams } from "@/lib/inbox/list-params";
import {
  INBOX_MAX_IDS,
  loadDraftConversationIds,
  loadInboxChunk,
  loadInboxRowsByIds,
  type InboxListQueryInput,
} from "@/lib/inbox/list-load";
import { parseCursor } from "@/lib/inbox/list-cursor";
import type { InboxMoreResult, InboxByIdsResult } from "@/lib/inbox/list-actions-types";

/**
 * La lista de la bandeja sin recargar la pagina (scroll infinito y tiempo real,
 * 27/11/2026).
 *
 * El navegador manda solo la parte de la URL con los filtros (`listQueryOf`) y,
 * segun el caso, un cursor o unos ids. Todo se vuelve a validar aca: el
 * workspace y la persona salen de la SESION, los filtros se leen con la misma
 * funcion que la pagina, y la consulta corre con el cliente del usuario (la RLS
 * decide que chats ve). Nunca se confia en un filtro ya armado por el navegador.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_QUERY_LENGTH = 4000;
const GENERIC_ERROR = "No pude traer los chats. Probá de nuevo en un momento.";

async function listInput(query: unknown): Promise<{ input: InboxListQueryInput; supabase: Awaited<ReturnType<typeof getWorkspace>>["supabase"] } | null> {
  if (typeof query !== "string" || query.length > MAX_QUERY_LENGTH) return null;
  const { workspace, supabase, user } = await getWorkspace();
  const access = await getPermissionContext();
  if (!canUseInbox(access.permissions)) return null;

  // Solo lo que hace falta para validar la URL: ids, nada mas.
  const [tagsRes, channelsRes, members, viewerTimezone] = await Promise.all([
    supabase.from("tags").select("id").eq("workspace_id", workspace.id),
    supabase.from("channels").select("id, platform").eq("workspace_id", workspace.id).eq("is_active", true),
    getWorkspaceMembers(workspace.id),
    resolveViewerTimezone(workspace.timezone),
  ]);
  const ctx = inboxListContext({
    channels: channelsRes.data ?? [],
    tagIds: (tagsRes.data ?? []).map((t) => t.id),
    memberIds: members.map((m) => m.userId),
    permissions: access.permissions,
  });
  const { filters, onlyGroups } = parseInboxListParams(paramsFromQuery(query), ctx);
  if (onlyGroups) return null;
  const range = resolveDateRange(filters.datePreset, filters.dateFrom, filters.dateTo, new Date(), viewerTimezone);
  return {
    supabase,
    input: { workspaceId: workspace.id, userId: user.id, filters, range, channelRestriction: ctx.channelRestriction },
  };
}

/** La tanda que sigue a `cursor`, con sus borradores. */
export async function loadMoreConversations(query: string, cursor: unknown): Promise<InboxMoreResult> {
  try {
    const parsed = parseCursor(cursor);
    if (!parsed) return { ok: false, error: GENERIC_ERROR };
    const ctx = await listInput(query);
    if (!ctx) return { ok: false, error: GENERIC_ERROR };
    const chunk = await loadInboxChunk(ctx.supabase, ctx.input, { cursor: parsed, withCount: false });
    if (chunk.error) {
      console.error("[inbox] cargar mas fallido:", chunk.error);
      return { ok: false, error: GENERIC_ERROR };
    }
    const draftConversationIds = await loadDraftConversationIds(ctx.supabase, chunk.rows.map((r) => r.id));
    return { ok: true, rows: chunk.rows, hasMore: chunk.hasMore, cursor: chunk.cursor, draftConversationIds };
  } catch (err) {
    console.error("[inbox] cargar mas fallido:", err instanceof Error ? err.message : "error desconocido");
    return { ok: false, error: GENERIC_ERROR };
  }
}

/**
 * De estos chats (los que cambiaron en vivo), cuales entran en la lista con los
 * filtros de la URL, como estan ahora, y cuales ya no.
 */
export async function loadConversationsByIds(query: string, ids: unknown): Promise<InboxByIdsResult> {
  try {
    if (!Array.isArray(ids)) return { ok: false, error: GENERIC_ERROR };
    const clean = [...new Set(ids.filter((id): id is string => typeof id === "string" && UUID.test(id)))].slice(0, INBOX_MAX_IDS);
    if (clean.length === 0) return { ok: true, rows: [], notMatching: [], draftConversationIds: [] };
    const ctx = await listInput(query);
    if (!ctx) return { ok: false, error: GENERIC_ERROR };
    const res = await loadInboxRowsByIds(ctx.supabase, ctx.input, clean);
    if (res.error) {
      console.error("[inbox] chats en vivo fallido:", res.error);
      return { ok: false, error: GENERIC_ERROR };
    }
    const draftConversationIds = await loadDraftConversationIds(ctx.supabase, res.rows.map((r) => r.id));
    return { ok: true, rows: res.rows, notMatching: res.notMatching, draftConversationIds };
  } catch (err) {
    console.error("[inbox] chats en vivo fallido:", err instanceof Error ? err.message : "error desconocido");
    return { ok: false, error: GENERIC_ERROR };
  }
}
