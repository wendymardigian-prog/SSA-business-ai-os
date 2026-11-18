/**
 * Las propuestas de contenido (idea y borrador) que todavía esperan en las grabaciones, para Contenido › Ideas.
 * Se aprueban en la reunión (ahí está la cita y quién decide); acá solo se listan con el link. Con la sesión: la RLS
 * de `calls` decide qué grabaciones ve cada persona. Nunca lanza: ante un problema, la lista vacía.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { PROPOSAL_TYPE_LABEL, effectiveProposal, readProposals } from "./proposals";

export interface PendingContentProposal {
  callId: string;
  callTitle: string;
  recordedAt: string;
  items: Array<{ id: string; typeLabel: string; title: string }>;
}

const MAX_CALLS = 30;

/** Las grabaciones con propuestas de contenido pendientes, de la más nueva a la más vieja. PURO. */
export function pendingContentFromCalls(rows: ReadonlyArray<{ id: string; title: string; recorded_at: string; proposals: unknown }>): PendingContentProposal[] {
  const out: PendingContentProposal[] = [];
  for (const r of rows) {
    const items = readProposals(r.proposals)
      .filter((p) => p.status === "pending" && (p.type === "idea" || p.type === "borrador"))
      .map((p) => ({ id: p.id, typeLabel: PROPOSAL_TYPE_LABEL[p.type], title: effectiveProposal(p).titulo }));
    if (items.length) out.push({ callId: r.id, callTitle: r.title, recordedAt: r.recorded_at, items });
  }
  return out.sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : a.callId.localeCompare(b.callId)));
}

export async function loadPendingContentProposals(supabase: SupabaseClient<Database>, workspaceId: string): Promise<PendingContentProposal[]> {
  try {
    const q = (type: "idea" | "borrador") =>
      supabase
        .from("calls")
        .select("id, title, recorded_at, proposals")
        .eq("workspace_id", workspaceId)
        .is("archived_at", null)
        .contains("proposals", [{ status: "pending", type }] as never)
        .order("recorded_at", { ascending: false })
        .limit(MAX_CALLS);
    const [ideas, drafts] = await Promise.all([q("idea"), q("borrador")]);
    const byId = new Map<string, { id: string; title: string; recorded_at: string; proposals: unknown }>();
    for (const r of [...(ideas.data ?? []), ...(drafts.data ?? [])] as Array<{ id: string; title: string; recorded_at: string; proposals: unknown }>) byId.set(r.id, r);
    return pendingContentFromCalls([...byId.values()]).slice(0, MAX_CALLS);
  } catch {
    return [];
  }
}
