import { CallsList, type CallListRow } from "@/components/calls/calls-list";
import { getPermissionContext } from "@/lib/auth/guards";
import { redirect } from "next/navigation";
import { applyCallFilters, CALL_LIST_COLUMNS, PAGE_SIZE, parseCallFilters } from "@/lib/calls/list";
import { pickConnection, shouldNudgeToConnect } from "@/lib/fathom/connection-state";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { listSecretNames, SECRET_NAMES } from "@/lib/vault";
import type { CallAnalysisStatus } from "@/lib/types/database";

export const dynamic = "force-dynamic";

/**
 * Lista de llamadas (F12). Lee con el cliente del usuario: la RLS
 * (`can_see_call`) decide que ve cada quien; los filtros de la URL se aplican
 * EN LA CONSULTA, nunca en memoria, y un closer inventado en la URL se ignora.
 */
export default async function LlamadasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getPermissionContext();
  if (!ctx.can("calls.view")) redirect("/dashboard");
  const { workspace, user, supabase } = ctx;
  const sp = await searchParams;

  const timeZone = await resolveViewerTimezone(workspace.timezone);
  const members = await getWorkspaceMembers(workspace.id);
  const filters = parseCallFilters(sp, { closerIds: members.map((m) => m.userId) });

  // La busqueda mira el titulo y los contactos que coinciden (los que esta persona ve).
  let searchContactIds: string[] = [];
  if (filters.q) {
    const { data } = await supabase
      .from("contacts")
      .select("id")
      .eq("workspace_id", workspace.id)
      .is("deleted_at", null)
      .or(`display_name.ilike.%${filters.q}%,email.ilike.%${filters.q}%`)
      .limit(30);
    searchContactIds = (data ?? []).map((c) => c.id);
  }

  const from = (filters.pagina - 1) * PAGE_SIZE;
  const base = supabase.from("calls").select(CALL_LIST_COLUMNS, { count: "exact" }).eq("workspace_id", workspace.id);
  const { data, count, error } = await applyCallFilters(base, filters, { timeZone, searchContactIds })
    .order("recorded_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  const raw = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const contactIds = [...new Set(raw.map((r) => r.contact_id as string | null).filter((x): x is string => !!x))];
  const { data: contacts } = contactIds.length
    ? await supabase.from("contacts").select("id, display_name, email").in("id", contactIds)
    : { data: [] as Array<{ id: string; display_name: string | null; email: string | null }> };
  const contactName = new Map((contacts ?? []).map((c) => [c.id, c.display_name || c.email || "Sin nombre"]));
  const memberName = new Map(members.map((m) => [m.userId, m.name]));

  const rows: CallListRow[] = raw.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    recordedAt: r.recorded_at as string,
    durationSeconds: (r.duration_seconds as number | null) ?? null,
    closerName: r.recorded_by_user_id ? memberName.get(r.recorded_by_user_id as string) ?? (r.recorded_by_email as string | null) : (r.recorded_by_email as string | null),
    contactId: (r.contact_id as string | null) ?? null,
    contactName: r.contact_id ? contactName.get(r.contact_id as string) ?? null : null,
    callType: (r.call_type as string | null) ?? null,
    callTypeSource: (r.call_type_source as string | null) ?? null,
    callTypeRule: (r.call_type_rule as string | null) ?? null,
    callTypeConfidence: r.call_type_confidence === null || r.call_type_confidence === undefined ? null : Number(r.call_type_confidence),
    status: r.analysis_status as CallAnalysisStatus,
    outcome: (r.outcome as string | null) ?? null,
    closerScore: (r.closer_score as number | null) ?? null,
    leadScore: (r.lead_score as number | null) ?? null,
    leadQualification: (r.lead_qualification as string | null) ?? null,
    hasOpenAlerts: r.has_open_alerts === true,
    hasBooking: !!r.booking_id,
    source: r.source as string,
  }));

  // Para los estados vacios y el aviso de "conecta tu Fathom".
  const service = await createServiceClient();
  const [{ count: anyCall }, { data: workspaceConnections }, secretNames, { data: mine }, { data: me }, { data: outcomes }] = await Promise.all([
    supabase.from("calls").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).is("archived_at", null),
    service.from("oauth_connections").select("status").eq("workspace_id", workspace.id).eq("provider", "fathom").neq("status", "revoked"),
    listSecretNames(service, workspace.id),
    supabase.from("oauth_connections").select("id, status, account_label, last_synced_at, last_error, sync_last_error").eq("workspace_id", workspace.id).eq("provider", "fathom").eq("user_id", user.id),
    supabase.from("workspace_members").select("is_closer").eq("workspace_id", workspace.id).eq("user_id", user.id).maybeSingle(),
    supabase.from("calls").select("outcome").eq("workspace_id", workspace.id).not("outcome", "is", null).limit(1000),
  ]);

  const hasApp = secretNames.includes(SECRET_NAMES.fathomClientId) && secretNames.includes(SECRET_NAMES.fathomClientSecret);
  const myConnection = pickConnection(mine ?? []);
  const hasLiveConnection = !!myConnection && (myConnection.status === "active" || myConnection.status === "attention");
  const isCloser = me?.is_closer === true;

  return (
    <CallsList
      rows={rows}
      total={count ?? 0}
      page={filters.pagina}
      pageSize={PAGE_SIZE}
      filters={filters}
      loadError={!!error}
      closers={members.map((m) => ({ id: m.userId, name: m.name }))}
      outcomes={[...new Set((outcomes ?? []).map((o) => o.outcome as string))].sort()}
      currentUserId={user.id}
      workspaceId={workspace.id}
      canEdit={ctx.can("calls.edit")}
      scopeAll={ctx.scope("calls") === "all" || ctx.role === "owner" || ctx.role === "admin"}
      hasAnyCall={(anyCall ?? 0) > 0}
      workspaceHasConnections={(workspaceConnections ?? []).length > 0}
      hasApp={hasApp}
      hasLiveConnection={hasLiveConnection}
      nudgeConnect={shouldNudgeToConnect({ isCloser, hasLiveConnection, hasApp })}
    />
  );
}
