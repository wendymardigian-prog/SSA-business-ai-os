import { PageHeader } from "@/components/page-header";
import { MiFathomCard } from "@/components/calls/mi-fathom-card";
import { BackToCalls } from "@/components/calls/back-link";
import { getPermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { fathomCardView, pickConnection } from "@/lib/fathom/connection-state";
import { listSecretNames, SECRET_NAMES } from "@/lib/vault";
import { firstParam } from "@/lib/url-params";
import { daysAgoIso } from "@/lib/calls/format";

export const dynamic = "force-dynamic";

/**
 * Mi Fathom (F6): cualquier miembro conecta SU cuenta, sin permiso aparte
 * (decision 153). Solo entran las llamadas de quien esta marcado "es closer".
 */
export default async function MiFathomPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace, user, supabase } = await getPermissionContext();
  const sp = await searchParams;

  // Si la app esta cargada se lee con el cliente de servicio: listar los secretos
  // es de admins, y a un closer solo le importa si esta o no.
  const service = await createServiceClient();
  const since = daysAgoIso(7);
  const [secretNames, { data: connections }, { data: member }] = await Promise.all([
    listSecretNames(service, workspace.id),
    supabase
      .from("oauth_connections")
      .select("id, status, account_label, last_synced_at, last_error, sync_last_error, created_at")
      .eq("workspace_id", workspace.id)
      .eq("provider", "fathom")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase.from("workspace_members").select("is_closer").eq("workspace_id", workspace.id).eq("user_id", user.id).maybeSingle(),
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

  const view = fathomCardView({ hasApp, connection: mine, isCloser: member?.is_closer === true, callsLast7d });
  const errorParam = firstParam(sp.error);
  const flash = firstParam(sp.connected) ? ({ kind: "connected" } as const) : errorParam ? ({ kind: "error", message: errorParam.slice(0, 200) } as const) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader route="/dashboard/llamadas/mi-fathom" backHref={<BackToCalls />} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MiFathomCard view={view} connectionId={connectionId} flash={flash} />
      </div>
    </div>
  );
}
