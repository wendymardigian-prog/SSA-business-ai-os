import { getPermissionContext } from "@/lib/auth/guards";
import { MyGoogleCard } from "@/components/settings/integrations/my-google-card";
import { MiFathomCard } from "@/components/calls/mi-fathom-card"; // @plantilla-quitar(llamadas)
import { getProfileForUser } from "@/lib/scheduling/data/profiles";
import { listCalendarConnections } from "@/lib/scheduling/data/calendars";
import { calendarConnectionStatus } from "@/lib/scheduling/bookable";
import { parseFathomSettings } from "@/lib/fathom/settings"; // @plantilla-quitar(llamadas)
import { fathomCardView, pickConnection } from "@/lib/fathom/connection-state"; // @plantilla-quitar(llamadas)
import { daysAgoIso } from "@/lib/calls/format"; // @plantilla-quitar(llamadas)
import { createServiceClient } from "@/lib/supabase/server"; // @plantilla-quitar(llamadas)
import { listSecretNames, SECRET_NAMES } from "@/lib/vault"; // @plantilla-quitar(llamadas)

/**
 * Mi cuenta → Conexiones (12/11/2026): lo que antes era «Mis conexiones» en Integraciones. El Google Calendar y el
 * Fathom de la propia persona, con los mismos datos y el mismo OAuth personal de siempre. No pide permisos de
 * integraciones: cada miembro conecta lo suyo.
 */
export async function ConnectionsTab() {
  const ctx = await getPermissionContext();
  const { workspace, supabase, user } = ctx;

  const service = await createServiceClient(); // @plantilla-quitar(llamadas)
  const since = daysAgoIso(7); // @plantilla-quitar(llamadas)
  const [profile, googleConnections, secretNames, { data: fathomConnections }] = await Promise.all([ // @plantilla-quitar(llamadas)
  // @plantilla-sin(llamadas): const [profile, googleConnections] = await Promise.all([
    getProfileForUser(supabase, workspace.id, user.id),
    listCalendarConnections(supabase, workspace.id, user.id),
    listSecretNames(service, workspace.id), // @plantilla-quitar(llamadas)
    // @plantilla-desde(llamadas)
    supabase
      .from("oauth_connections")
      .select("id, status, account_label, last_synced_at, last_error, sync_last_error, created_at, fathom_settings")
      .eq("workspace_id", workspace.id)
      .eq("provider", "fathom")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    // @plantilla-hasta(llamadas)
  ]);
  // @plantilla-desde(llamadas)
  const hasFathomApp = secretNames.includes(SECRET_NAMES.fathomClientId) && secretNames.includes(SECRET_NAMES.fathomClientSecret);
  const mineFathom = pickConnection(fathomConnections ?? []);
  const fathomConnectionId = mineFathom ? (fathomConnections ?? []).find((c) => c === mineFathom)?.id ?? null : null;
  let callsLast7d = 0;
  if (fathomConnectionId) {
    const { count } = await supabase
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .eq("source", "fathom")
      .eq("recorded_by_user_id", user.id)
      .gte("created_at", since);
    callsLast7d = count ?? 0;
  }
  const fathomView = fathomCardView({ hasApp: hasFathomApp, connection: mineFathom, mode: parseFathomSettings(mineFathom?.fathom_settings).mode, callsLast7d });
  // @plantilla-hasta(llamadas)

  return (
    <section aria-labelledby="mis-conexiones" className="space-y-4">
      <div>
        <h2 id="mis-conexiones" className="text-sm font-semibold">Conexiones</h2>
        <p className="mt-1 text-xs text-muted-foreground">Tu propio Google Calendar y tu propio Fathom. Nadie más ve ni toca lo tuyo.</p> {/* @plantilla-quitar(llamadas) */}
        {/* @plantilla-sin(llamadas): <p className="mt-1 text-xs text-muted-foreground">Tu propio Google Calendar. Nadie más ve ni toca lo tuyo.</p> */}
      </div>
      <MyGoogleCard
        canUse={ctx.can("scheduling.use")}
        hasProfile={Boolean(profile)}
        accounts={googleConnections.map((c) => ({
          id: c.id,
          label: c.account_label ?? "Cuenta de Google",
          status: calendarConnectionStatus({ id: c.id, status: c.status, granted_scopes: c.granted_scopes }),
        }))}
      />
      {/* @plantilla-desde(llamadas) */}
      {ctx.can("calls.view") && <MiFathomCard view={fathomView} connectionId={fathomConnectionId} flash={null} embedded />}
      {/* @plantilla-hasta(llamadas) */}
    </section>
  );
}
