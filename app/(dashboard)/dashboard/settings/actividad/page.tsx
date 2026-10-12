import { ActivityScreen, type ActivityRow } from "@/components/settings/activity-screen";
import { requireWorkspaceAdmin } from "@/lib/auth/guards";
import { ACTIVITY_PAGE_SIZE, ACTOR_TYPES, applyAuditFilters, auditFilters } from "@/lib/audit-query";
import { HISTORY_COLUMNS } from "@/lib/audit-history";
import { isDateOnly } from "@/lib/sales/dates";
import { addDays } from "@/lib/sales/dates";
import { startOfDayUtc } from "@/lib/scheduling/time/tz";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import type { AuditActorType } from "@/lib/types/database";

export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined): string | null => {
  const raw = Array.isArray(v) ? v[0] : v;
  return raw && raw.trim() ? raw.trim().slice(0, 80) : null;
};

/**
 * Actividad (Ventas, F36): el `audit_log` de todo el workspace, para Owner y Admin (sin clave propia).
 * Usa la MISMA función de armado de consulta que `<Historial>` (`lib/audit-query.ts`). Los días del filtro
 * son los de la zona de quien mira.
 */
export default async function ActividadPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { workspace, supabase } = await requireWorkspaceAdmin();
  const sp = await searchParams;
  const timeZone = await resolveViewerTimezone((workspace as { timezone?: string }).timezone);
  const members = await getWorkspaceMembers(workspace.id);

  const actorRaw = one(sp.actor);
  const fromDay = one(sp.desde);
  const toDay = one(sp.hasta);
  const page = Math.max(1, Math.floor(Number(one(sp.pagina))) || 1);
  const filters = {
    entityType: one(sp.entidad),
    action: one(sp.accion),
    actorType: actorRaw && (ACTOR_TYPES as readonly string[]).includes(actorRaw) ? (actorRaw as AuditActorType) : null,
    performedBy: one(sp.persona),
    actorLabel: one(sp.q),
    fromIso: fromDay && isDateOnly(fromDay) ? startOfDayUtc(fromDay, timeZone).toISOString() : null,
    // «Hasta» incluye ese día entero: se corta al inicio del siguiente.
    toIso: toDay && isDateOnly(toDay) ? startOfDayUtc(addDays(toDay, 1), timeZone).toISOString() : null,
  };

  const from = (page - 1) * ACTIVITY_PAGE_SIZE;
  const { data, count, error } = await applyAuditFilters(
    supabase.from("audit_log").select(`${HISTORY_COLUMNS}, entity_type, entity_id`, { count: "exact" }).eq("workspace_id", workspace.id),
    auditFilters(filters),
  )
    .order("performed_at", { ascending: false })
    .range(from, from + ACTIVITY_PAGE_SIZE - 1);

  return (
    <ActivityScreen
      rows={(data ?? []) as unknown as ActivityRow[]}
      total={count ?? 0}
      page={page}
      pageSize={ACTIVITY_PAGE_SIZE}
      loadError={!!error}
      filters={{ entidad: filters.entityType ?? "", accion: filters.action ?? "", actor: filters.actorType ?? "", persona: filters.performedBy ?? "", q: filters.actorLabel ?? "", desde: fromDay ?? "", hasta: toDay ?? "" }}
      names={Object.fromEntries(members.map((m) => [m.userId, m.name]))}
      members={members.map((m) => ({ id: m.userId, name: m.name }))}
      timeZone={timeZone}
    />
  );
}
