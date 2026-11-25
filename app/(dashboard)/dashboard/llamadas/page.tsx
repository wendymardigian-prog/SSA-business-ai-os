import { CallsList, type CallListRow } from "@/components/calls/calls-list";
import { callDisplayLabel, categoryGroups, legacyCallTypeFor, readCategorySnapshot } from "@/lib/calls/catalog";
import { cardParticipants } from "@/lib/calls/participants";
import { TEAM_AREA_KEY } from "@/lib/calls/area-analyzers";
import { resolveBrand } from "@/lib/brand";
import { listCategories, toCategoryRow } from "@/lib/scheduling/data/event-types";
import { getPermissionContext } from "@/lib/auth/guards";
import { redirect } from "next/navigation";
import { applyCallFilters, CALL_LIST_COLUMNS, CALL_LIST_SERVICE_COLUMNS, callScopeLabel, cleanCallTitle, PAGE_SIZE, parseCallFilters } from "@/lib/calls/list";
import { pickConnection, shouldNudgeToConnect } from "@/lib/fathom/connection-state";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { listSecretNames, SECRET_NAMES } from "@/lib/vault";
import type { CallAnalysisStatus } from "@/lib/types/database";
import { loadCallsPortalState } from "@/lib/program/calls-portal"; // @plantilla-quitar(servicios)
import { isModuleEnabled } from "@/lib/services/module"; // @plantilla-quitar(servicios)
import { loadServiceCategoryIds, loadServiceLabels } from "@/lib/calls/service-labels"; // @plantilla-quitar(servicios)

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

  // Lo que no depende de nada se pide junto: antes eran viajes en serie a la base.
  const service = await createServiceClient();
  const [timeZone, members, categoryRows] = await Promise.all([resolveViewerTimezone(workspace.timezone), getWorkspaceMembers(workspace.id), listCategories(supabase, workspace.id)]);
  const categories = categoryRows.map(toCategoryRow);
  // El área Equipo (por su clave fija) es la de las reuniones internas.
  const teamAreaId = categories.find((c) => c.system_key === TEAM_AREA_KEY && !c.parent_id && !c.archived_at)?.id ?? null;
  // Servicios A4 (F136): con el módulo prendido, el servicio de cada reunión, su filtro y «por revisar».
  let servicesOn = false;
  servicesOn = isModuleEnabled(workspace as { services_enabled?: boolean | null }); // @plantilla-quitar(servicios)
  const filters = parseCallFilters(sp, { closerIds: members.map((m) => m.userId), servicesOn });
  let serviceCats: { areaId: string | null; classId: string | null } = { areaId: null, classId: null };
  if (servicesOn && filters.servicio === "sin") serviceCats = await loadServiceCategoryIds(supabase, workspace.id); // @plantilla-quitar(servicios)

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
  const base = supabase.from("calls").select(`${CALL_LIST_COLUMNS}, manual_summary:summary->manual${servicesOn ? CALL_LIST_SERVICE_COLUMNS : ""}`, { count: "exact" }).eq("workspace_id", workspace.id);
  const mainQuery = applyCallFilters(base, filters, { timeZone, searchContactIds, serviceAreaId: serviceCats.areaId, classTypeId: serviceCats.classId, teamAreaId })
    .order("recorded_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  // La lista y todo lo que no depende de ella, a la vez. Para los estados vacios y el aviso de "conecta tu Fathom".
  const [{ data, count, error }, { count: anyCall }, { data: workspaceConnections }, secretNames, { data: mine }, { data: outcomes }, { count: pendingCount }, { count: unclassifiedCount }] = await Promise.all([
    mainQuery,
    supabase.from("calls").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).is("archived_at", null),
    service.from("oauth_connections").select("status").eq("workspace_id", workspace.id).eq("provider", "fathom").neq("status", "revoked"),
    listSecretNames(service, workspace.id),
    supabase.from("oauth_connections").select("id, status, account_label, last_synced_at, last_error, sync_last_error").eq("workspace_id", workspace.id).eq("provider", "fathom").eq("user_id", user.id),
    supabase.from("calls").select("outcome").eq("workspace_id", workspace.id).not("outcome", "is", null).limit(1000),
    // Las pendientes de analisis que esta persona ve (la RLS decide), para "Analizar pendientes".
    ctx.can("calls.edit")
      ? supabase.from("calls").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("analysis_status", "pending").is("archived_at", null)
      : Promise.resolve({ count: 0 }),
    supabase.from("calls").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).is("archived_at", null).is("area_id", null).eq("no_show", false),
  ]);

  const raw = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const contactIds = [...new Set(raw.map((r) => r.contact_id as string | null).filter((x): x is string => !!x))];
  const serviceIds = servicesOn ? raw.map((r) => r.service_id as string | null).filter((x): x is string => Boolean(x)) : [];
  if (servicesOn && filters.servicio && filters.servicio !== "review" && filters.servicio !== "sin") serviceIds.push(filters.servicio);

  // Lo que depende de las filas de la lista, a la vez: los contactos y lo que sigue.
  const [{ data: contacts }, reviewCount, contactFilterName] = await Promise.all([
    contactIds.length
      ? supabase.from("contacts").select("id, display_name, email, avatar_url").in("id", contactIds)
      : Promise.resolve({ data: [] as Array<{ id: string; display_name: string | null; email: string | null; avatar_url: string | null }> }),
    // «N reuniones por revisar» (las que esta persona ve: la RLS decide).
    servicesOn
      ? supabase.from("calls").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("service_link", "review").is("archived_at", null).then((r) => r.count ?? 0)
      : Promise.resolve(0),
    // Si la lista viene filtrada por un contacto, su nombre (solo si quien mira lo ve).
    filters.contacto
      ? supabase.from("contacts").select("display_name, email").eq("id", filters.contacto).eq("workspace_id", workspace.id).is("deleted_at", null).maybeSingle().then((r) => r.data?.display_name || r.data?.email || null)
      : Promise.resolve(null as string | null),
  ]);
  let serviceLabels = new Map<string, { label: string }>();
  if (servicesOn) serviceLabels = await loadServiceLabels(service, workspace.id, serviceIds); // @plantilla-quitar(servicios)
  const portal = await loadCallsPortalState(ctx, raw.map((r) => r.id as string)); // @plantilla-quitar(servicios)
  const contactById = new Map((contacts ?? []).map((c) => [c.id, c]));
  const memberName = new Map(members.map((m) => [m.userId, m.name]));
  const brandName = resolveBrand(workspace as Parameters<typeof resolveBrand>[0]).name;

  const rows: CallListRow[] = raw.map((r) => {
    const contact = r.contact_id ? contactById.get(r.contact_id as string) ?? null : null;
    const contactName = contact ? contact.display_name || contact.email || "Sin nombre" : null;
    return {
      id: r.id as string,
      title: cleanCallTitle(r.title as string, brandName),
      recordedAt: r.recorded_at as string,
      durationSeconds: (r.duration_seconds as number | null) ?? null,
      closerName: r.recorded_by_user_id ? memberName.get(r.recorded_by_user_id as string) ?? (r.recorded_by_email as string | null) : (r.recorded_by_email as string | null),
      contactId: (r.contact_id as string | null) ?? null,
      contactName,
      callType: legacyCallTypeFor(readCategorySnapshot(r.category_snapshot), categories, r.no_show === true),
      categoryLabel: callDisplayLabel(r.category_snapshot, r.no_show === true),
      categoryId: (r.category_id as string | null) ?? null,
      participants: cardParticipants({
        hostUserId: (r.recorded_by_user_id as string | null) ?? null,
        hostEmail: (r.recorded_by_email as string | null) ?? null,
        attendees: r.attendees,
        contact: contact ? { name: contactName as string, email: contact.email, avatarUrl: contact.avatar_url } : null,
        members,
      }),
      classificationSource: (r.classification_source as string | null) ?? null,
      classificationRule: (r.classification_rule as string | null) ?? null,
      classificationConfidence: r.classification_confidence === null || r.classification_confidence === undefined ? null : Number(r.classification_confidence),
      status: r.analysis_status as CallAnalysisStatus,
      outcome: (r.outcome as string | null) ?? null,
      closerScore: (r.closer_score as number | null) ?? null,
      leadScore: (r.lead_score as number | null) ?? null,
      leadQualification: (r.lead_qualification as string | null) ?? null,
      hasOpenAlerts: r.has_open_alerts === true,
      hasBooking: !!r.booking_id,
      source: r.source as string,
      serviceId: (r.service_id as string | null | undefined) ?? null,
      serviceLink: (r.service_link as string | null | undefined) ?? null,
      serviceLabel: r.service_id ? serviceLabels.get(r.service_id as string)?.label ?? null : null,
      manual: r.manual_summary !== null && r.manual_summary !== undefined && r.analysis_status !== "done",
    };
  });

  const hasApp = secretNames.includes(SECRET_NAMES.fathomClientId) && secretNames.includes(SECRET_NAMES.fathomClientSecret);
  const myConnection = pickConnection(mine ?? []);
  const hasLiveConnection = !!myConnection && (myConnection.status === "active" || myConnection.status === "attention");

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
      canDelete={ctx.can("calls.delete")}
      contactFilterName={contactFilterName}
      canConfigure={ctx.can("calls.configure")}
      pendingCount={pendingCount ?? 0}
      scopeLabel={callScopeLabel(ctx.scope("calls"), ctx.role)}
      hasAnyCall={(anyCall ?? 0) > 0}
      workspaceHasConnections={(workspaceConnections ?? []).length > 0}
      hasApp={hasApp}
      categoryGroups={categoryGroups(categories)}
      unclassifiedCount={unclassifiedCount ?? 0}
      hasLiveConnection={hasLiveConnection}
      nudgeConnect={shouldNudgeToConnect({ hasLiveConnection, hasApp })}
      portal={portal} // @plantilla-quitar(servicios)
      services={servicesOn ? { on: true, reviewCount, filterLabel: filters.servicio ? serviceLabels.get(filters.servicio)?.label ?? null : null } : null}
    />
  );
}
