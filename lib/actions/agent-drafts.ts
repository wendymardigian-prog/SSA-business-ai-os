"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isAdminRole } from "@/lib/auth/roles";
import { approveDraft, discardDraft, regenerateDraft, type DraftActionResult } from "@/lib/agent/drafts/actions";
import { draftOwner } from "@/lib/agent/drafts/queue-query";
import { LIVE_DRAFT_STATUSES } from "@/lib/agent/drafts/types";

/**
 * Las cuatro decisiones sobre un borrador, desde la cola o desde la
 * conversacion (Bloque 2c). La logica vive en lib/agent/drafts/actions.ts;
 * aca se resuelve la sesion y se revalida.
 *
 * Aprobar es operar, no configurar: Owner, Admin y un Member en las
 * conversaciones de su scope. La RLS es la que decide, no este archivo.
 */

async function session() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

const SESSION_EXPIRED: DraftActionResult = { ok: false, code: "unknown", error: "Tu sesión venció. Volvé a entrar." };

function revalidate() {
  revalidatePath("/dashboard/drafts");
  revalidatePath("/dashboard/inbox");
}

export async function sendDraftAction(
  draftId: string,
  options: { body?: string | null; confirmedDoNotContact?: boolean } = {},
): Promise<DraftActionResult> {
  const { supabase, user } = await session();
  if (!user) return SESSION_EXPIRED;
  const service = await createServiceClient();
  const result = await approveDraft({
    user: supabase,
    service,
    userId: user.id,
    draftId,
    body: typeof options.body === "string" ? options.body : null,
    confirmedDoNotContact: options.confirmedDoNotContact === true,
  });
  revalidate();
  return result;
}

export async function discardDraftAction(draftId: string, reason?: string | null): Promise<DraftActionResult> {
  const { supabase, user } = await session();
  if (!user) return SESSION_EXPIRED;
  const result = await discardDraft({ user: supabase, userId: user.id, draftId, reason });
  revalidate();
  return result;
}

export async function regenerateDraftAction(draftId: string, instruction?: string | null): Promise<DraftActionResult> {
  const { supabase, user } = await session();
  if (!user) return SESSION_EXPIRED;
  const service = await createServiceClient();
  const result = await regenerateDraft({ user: supabase, service, userId: user.id, draftId, instruction });
  revalidate();
  return result;
}

/**
 * El contador del menu. Coincide con la vista por defecto de la cola ("mios"):
 * los borradores vivos cuyo contacto es del usuario (setter; sin setter,
 * vendedor). Para Owner/Admin suma los sin asignar y el total del workspace,
 * asi un Owner sin contactos propios no ve "0" con doce esperando.
 */
export async function countPendingDrafts(
  workspaceId: string,
  role: string | null,
): Promise<{ mine: number; unassigned: number | null; total: number | null }> {
  const { supabase, user } = await session();
  if (!user) return { mine: 0, unassigned: null, total: null };
  const { data, error } = await supabase
    .from("agent_drafts")
    .select("id, contacts(setter_id, vendedor_id)")
    .eq("workspace_id", workspaceId)
    .in("status", LIVE_DRAFT_STATUSES)
    .limit(1000);
  if (error) {
    console.error("[drafts] no pude contar los borradores:", error.message);
    return { mine: 0, unassigned: null, total: null };
  }
  const rows = (data ?? []) as unknown as Array<{ contacts: { setter_id: string | null; vendedor_id: string | null } | null }>;
  const owners = rows.map((r) => draftOwner(r.contacts));
  const admin = isAdminRole(role);
  return {
    mine: owners.filter((o) => o === user.id).length,
    unassigned: admin ? owners.filter((o) => o === null).length : null,
    total: admin ? rows.length : null,
  };
}
