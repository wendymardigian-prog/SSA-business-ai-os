"use server";

import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { accountLabel } from "@/lib/inbox/accounts";
import type { EditorGroup, EditorGroupMessage, EditorPollStep, EditorResult } from "@/lib/whatsapp-groups/editor-types";

/**
 * Lo que el editor de automatizaciones necesita de los grupos de WhatsApp: los grupos activados, sus mensajes y
 * encuestas recientes (para «A qué mensaje: los elegidos») y los pasos «Enviar encuesta» de las automatizaciones
 * (para «las que manda un paso»).
 *
 * Piden `flows.edit`. Los grupos y los pasos se leen con el cliente de servicio filtrando por el workspace de la
 * sesion, despues del permiso: quien arma una automatizacion elige entre los grupos del negocio aunque su bandeja no
 * los muestre. Los MENSAJES (su texto) se leen con la sesion: solo los de grupos que la persona ve.
 */

const NO_PERMISSION = "No tenés permiso para editar automatizaciones.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECENT = 40;
const LABEL_MAX = 120;

async function guard() {
  const ctx = await getPermissionAction("flows.edit");
  if (!ctx) return null;
  return { ctx, db: await createServiceClient() };
}

const clip = (text: string) => (text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX)}…` : text);

export async function listGroupsForFlowEditor(): Promise<EditorResult<{ groups: EditorGroup[] }>> {
  const g = await guard();
  if (!g) return { ok: false, error: NO_PERMISSION };
  const [{ data: groups }, { data: channels }] = await Promise.all([
    g.db.from("whatsapp_groups").select("id, channel_id, subject, in_inbox, save_contacts, left_at, kind, parent_group_jid, community_subject").eq("workspace_id", g.ctx.workspace.id).is("left_at", null),
    g.db.from("channels").select("id, platform, username, display_name").eq("workspace_id", g.ctx.workspace.id),
  ]);
  const byId = new Map((channels ?? []).map((c) => [c.id, c]));
  return {
    ok: true,
    groups: (groups ?? [])
      .filter((row) => row.in_inbox || row.save_contacts)
      .map((row) => {
        const channel = byId.get(row.channel_id);
        return {
          id: row.id,
          subject: row.subject,
          channelLabel: channel ? accountLabel(channel) : "WhatsApp",
          inInbox: row.in_inbox,
          saveContacts: row.save_contacts,
          kind: row.kind,
          communitySubject: row.parent_group_jid ? (row.community_subject ?? "Comunidad") : null,
        };
      })
      .sort((a, b) => a.subject.localeCompare(b.subject, "es", { sensitivity: "base" })),
  };
}

/** Los mensajes recientes de esos grupos (o solo las encuestas), y tambien los que ya estaban elegidos. */
export async function listGroupMessagesForFlowEditor(
  groupIds: string[],
  kind: "messages" | "polls",
  selectedIds: string[] = [],
): Promise<EditorResult<{ messages: EditorGroupMessage[] }>> {
  const g = await guard();
  if (!g) return { ok: false, error: NO_PERMISSION };
  const groups = (groupIds ?? []).filter((id) => UUID.test(id)).slice(0, 50);
  const selected = (selectedIds ?? []).filter((id) => UUID.test(id)).slice(0, 50);

  // Los TEXTOS se leen con la sesion: la RLS (`can_see_whatsapp_group`) decide de que grupos los ve. Quien arma
  // automatizaciones sin ver esa cuenta en la bandeja elige el grupo, pero no lee sus mensajes.
  let query = g.ctx.supabase
    .from("whatsapp_group_messages")
    .select("id, group_id, direction, text, poll, created_at")
    .eq("workspace_id", g.ctx.workspace.id)
    .eq("status", "sent")
    .order("created_at", { ascending: false })
    .limit(RECENT);
  if (groups.length > 0) query = query.in("group_id", groups);
  query = kind === "polls" ? query.not("poll", "is", null) : query.eq("direction", "outbound");
  const { data: recent } = await query;

  const rows = [...(recent ?? [])];
  const missing = selected.filter((id) => !rows.some((r) => r.id === id));
  if (missing.length > 0) {
    const { data: extra } = await g.ctx.supabase
      .from("whatsapp_group_messages")
      .select("id, group_id, direction, text, poll, created_at")
      .eq("workspace_id", g.ctx.workspace.id)
      .in("id", missing);
    rows.push(...(extra ?? []));
  }

  return {
    ok: true,
    messages: rows.map((row) => {
      const poll = row.poll && typeof row.poll === "object" ? (row.poll as { name?: unknown; options?: unknown }) : null;
      const options = poll && Array.isArray(poll.options) ? poll.options.filter((o): o is string => typeof o === "string") : null;
      const label = poll ? `📊 ${String(poll.name ?? "")}` : (row.text ?? "").trim() || "(adjunto)";
      return { id: row.id, groupId: row.group_id, label: clip(label), fromBusiness: row.direction === "outbound", options, createdAt: row.created_at };
    }),
  };
}

/** Los pasos «Enviar encuesta» de las automatizaciones del negocio (lo publicado y el borrador). */
export async function listPollStepsForFlowEditor(): Promise<EditorResult<{ steps: EditorPollStep[] }>> {
  const g = await guard();
  if (!g) return { ok: false, error: NO_PERMISSION };
  const { data: flows } = await g.db.from("flows").select("id, name, nodes, draft_nodes").eq("workspace_id", g.ctx.workspace.id);
  const steps: EditorPollStep[] = [];
  for (const flow of flows ?? []) {
    const seen = new Set<string>();
    for (const list of [flow.draft_nodes, flow.nodes]) {
      if (!Array.isArray(list)) continue;
      for (const node of list as Array<{ id?: unknown; type?: unknown; data?: Record<string, unknown> }>) {
        const isPoll = node?.type === "send_poll" || (node?.type === "action" && node.data?.actionType === "send_poll");
        if (!isPoll || typeof node.id !== "string" || seen.has(node.id)) continue;
        seen.add(node.id);
        steps.push({
          flowId: flow.id,
          flowName: flow.name,
          nodeId: node.id,
          question: typeof node.data?.question === "string" ? node.data.question : "",
          options: Array.isArray(node.data?.options) ? (node.data.options as unknown[]).filter((o): o is string => typeof o === "string" && o.trim() !== "") : [],
        });
      }
    }
  }
  return { ok: true, steps };
}
