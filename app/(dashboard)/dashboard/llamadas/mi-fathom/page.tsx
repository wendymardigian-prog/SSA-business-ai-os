import { PageHeader } from "@/components/page-header";
import { MiFathomCard } from "@/components/calls/mi-fathom-card";
import { BackToCalls } from "@/components/calls/back-link";
import { FathomHistoryImport } from "@/components/calls/fathom-history-import";
import { FathomImportSettings } from "@/components/calls/fathom-import-settings";
import { FathomRecorderEmails } from "@/components/calls/fathom-recorder-emails";
import { FathomTeamConnections, type TeamFathomConnection } from "@/components/calls/fathom-team-connections";
import { requirePermission } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { fathomCardView, pickConnection } from "@/lib/fathom/connection-state";
import { historyView, parseHistoryState } from "@/lib/fathom/history-state";
import { parseFathomSettings } from "@/lib/fathom/settings";
import { categoryGroups } from "@/lib/calls/catalog";
import { listCategories, toCategoryRow } from "@/lib/scheduling/data/event-types";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { normalizeFathomEmail } from "@/lib/fathom/recorder-emails";
import { listSecretNames, SECRET_NAMES } from "@/lib/vault";
import { firstParam } from "@/lib/url-params";
import { daysAgoIso } from "@/lib/calls/format";

export const dynamic = "force-dynamic";

/**
 * Mi Fathom (F6): quien tiene `calls.view` conecta SU cuenta, carga con que
 * correos graba e importa su historial. Entra lo que esa persona grabo.
 */
export default async function MiFathomPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace, user, supabase, can } = await requirePermission("calls.view");
  const sp = await searchParams;

  // Si la app esta cargada se lee con el cliente de servicio: listar los secretos
  // es de admins, y a un closer solo le importa si esta o no.
  const service = await createServiceClient();
  const since = daysAgoIso(7);
  const [secretNames, { data: connections }, { data: member }] = await Promise.all([
    listSecretNames(service, workspace.id),
    supabase
      .from("oauth_connections")
      .select("id, status, account_label, last_synced_at, last_error, sync_last_error, created_at, history_import, fathom_settings")
      .eq("workspace_id", workspace.id)
      .eq("provider", "fathom")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase.from("workspace_members").select("closer_emails").eq("workspace_id", workspace.id).eq("user_id", user.id).maybeSingle(),
  ]);

  const hasApp = secretNames.includes(SECRET_NAMES.fathomClientId) && secretNames.includes(SECRET_NAMES.fathomClientSecret);

  const mine = pickConnection(connections ?? []);
  const connectionId = mine ? (connections ?? []).find((c) => c === mine)?.id ?? null : null;

  let callsLast7d = 0;
  if (connectionId) {
    const { count } = await supabase
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .eq("source", "fathom")
      .eq("recorded_by_user_id", user.id)
      .gte("created_at", since);
    callsLast7d = count ?? 0;
  }

  const settings = parseFathomSettings(mine?.fathom_settings);
  const view = fathomCardView({ hasApp, connection: mine, callsLast7d, mode: settings.mode });
  const groups = categoryGroups((await listCategories(supabase, workspace.id)).map(toCategoryRow));
  // El link de un modulo trae su area: se ofrece elegida, si la conexion todavia no tiene una.
  const areaParam = firstParam(sp.area);
  const presetAreaId = !settings.default_area_id && areaParam && groups.some((g) => g.areaId === areaParam) ? areaParam : null;

  // Quien configura el analisis ve que importa cada persona: alguien podria dejar sus llamadas afuera.
  let team: TeamFathomConnection[] = [];
  if (can("calls.configure")) {
    const [{ data: rows }, members] = await Promise.all([
      service.from("oauth_connections").select("id, user_id, fathom_settings").eq("workspace_id", workspace.id).eq("provider", "fathom").in("status", ["active", "attention"]),
      getWorkspaceMembers(workspace.id),
    ]);
    const names = new Map(members.map((m) => [m.userId, m.name]));
    team = (rows ?? [])
      .filter((r) => r.user_id && r.user_id !== user.id)
      .map((r) => ({ id: r.id, name: names.get(r.user_id as string) ?? "Sin nombre", settings: parseFathomSettings(r.fathom_settings) }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }
  const history = historyView(parseHistoryState(mine?.history_import), new Date());
  const errorParam = firstParam(sp.error);
  const flash = firstParam(sp.connected) ? ({ kind: "connected" } as const) : errorParam ? ({ kind: "error", message: errorParam.slice(0, 200) } as const) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader route="/dashboard/llamadas/mi-fathom" backHref={<BackToCalls />} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MiFathomCard view={view} connectionId={connectionId} flash={flash} areaId={presetAreaId} />
        {hasApp && (
          <div className="mx-auto w-full max-w-xl px-4 pb-6 md:px-6">
            <FathomRecorderEmails accountEmail={normalizeFathomEmail(user.email)} initialEmails={member?.closer_emails ?? []} />
            {view.connected && (
              <div className="mt-4">
                <FathomImportSettings settings={settings} groups={groups} presetAreaId={presetAreaId} />
              </div>
            )}
            {view.connected && <FathomHistoryImport view={history} manual={settings.mode === "manual"} />}
            <FathomTeamConnections connections={team} groups={groups} />
          </div>
        )}
      </div>
    </div>
  );
}
