import { requirePermission } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { STATUS_ROLES, parseStatusSettings, type StatusRole } from "@/lib/contacts/statuses";
import { QUALIFICATION_LEVELS, parseQualificationSettings } from "@/lib/contacts/qualification";
import { StatusesView } from "./statuses-view";

/**
 * Ajustes → Estados (pipeline de contactos, 00245).
 *
 * Pide `contact_statuses.manage` (Owner y Admin; un rol personalizado si se la
 * dan). Lee con el cliente de servicio DESPUÉS del guard y siempre filtrando
 * por el workspace de la sesión: la RLS de `workspaces` es de Admin, y la
 * cuenta de contactos por estado tiene que ver todos, no solo los que la RLS de
 * quien mira le deja ver.
 */
export default async function StatusesPage() {
  const { workspace } = await requirePermission("contact_statuses.manage");
  const service = await createServiceClient();

  const { data: row, error } = await service
    .from("workspaces")
    .select("contact_status_settings, qualification_settings")
    .eq("id", workspace.id)
    .maybeSingle();
  if (error) console.error("[estados] no pude leer los estados:", error.message);
  const saved = row as { contact_status_settings?: unknown; qualification_settings?: unknown } | null;
  const settings = parseStatusSettings(saved?.contact_status_settings);
  const qualification = parseQualificationSettings(saved?.qualification_settings);

  // Cuántos contactos (vivos) tienen cada estado: es lo que hay que saber antes de archivar uno.
  const usage: Record<StatusRole, Record<string, number>> = { setter: {}, closer: {} };
  const counts = await Promise.all(
    STATUS_ROLES.flatMap((role) =>
      settings[role].map(async (status) => {
        const column = role === "setter" ? "setter_status" : "closer_status";
        const { count, error: countError } = await service
          .from("contacts")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspace.id)
          .is("deleted_at", null)
          .eq(column, status.key);
        return { role, key: status.key, count: count ?? 0, failed: Boolean(countError) };
      }),
    ),
  );
  for (const c of counts) usage[c.role][c.key] = c.count;
  // Lo mismo por nivel de calificación (00329), y los que no tienen ninguno.
  const levelCounts = await Promise.all(
    [...QUALIFICATION_LEVELS, null].map(async (level) => {
      let query = service
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspace.id)
        .is("deleted_at", null)
        .eq("is_anonymous", false);
      query = level === null ? query.is("qualification_level", null) : query.eq("qualification_level", level);
      const { count, error: countError } = await query;
      return { level, count: count ?? 0, failed: Boolean(countError) };
    }),
  );
  const qualificationUsage: Record<number, number> = {};
  for (const c of levelCounts) if (c.level !== null) qualificationUsage[c.level] = c.count;
  const unqualified = levelCounts.find((c) => c.level === null);
  const usageFailed = counts.some((c) => c.failed) || levelCounts.some((c) => c.failed);

  return (
    <StatusesView
      settings={settings}
      usage={usage}
      usageFailed={usageFailed}
      qualification={qualification}
      qualificationUsage={qualificationUsage}
      unqualified={unqualified && !unqualified.failed ? unqualified.count : null}
    />
  );
}
