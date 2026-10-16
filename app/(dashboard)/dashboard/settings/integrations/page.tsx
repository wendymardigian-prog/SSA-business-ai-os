import { getPermissionContext } from "@/lib/auth/guards";
import { hasSharedSections, integrationSections } from "@/lib/integrations/sections";
import { MyGoogleCard } from "@/components/settings/integrations/my-google-card";
import { MiFathomCard } from "@/components/calls/mi-fathom-card";
import { getProfileForUser } from "@/lib/scheduling/data/profiles";
import { listCalendarConnections } from "@/lib/scheduling/data/calendars";
import { calendarConnectionStatus } from "@/lib/scheduling/bookable";
import { fathomCardView, pickConnection } from "@/lib/fathom/connection-state";
import { daysAgoIso } from "@/lib/calls/format";
import { createServiceClient } from "@/lib/supabase/server";
import { IntegrationsGrid } from "@/components/settings/integrations/integrations-grid";
import { loadIntegrations } from "@/lib/integrations/load";
import { FathomAppCard } from "@/components/settings/integrations/fathom-app-card";
import { WebhooksCard } from "@/components/settings/integrations/webhooks-card";
import { listSecretNames, SECRET_NAMES } from "@/lib/vault";
import { appUrl } from "@/lib/app-url";

/**
 * Integraciones: todo lo que el sistema conecta con afuera, en una pantalla.
 *
 * `loadIntegrations` arma lo que cada card necesita —estado (ahora con la
 * salud de la credencial OAuth enchufada, G3), cuenta conectada, barra de uso
 * y QUE secretos hay guardados— y nada mas. El valor de un secreto no sale de
 * Vault: de los secretos viaja solo su nombre. El resto de lo que devuelve
 * (webhooks, cuentas de Zernio y Meta, la prueba de YouTube) lo usa el
 * detalle de cada proveedor (`[providerId]/page.tsx`, G5), no esta pantalla.
 *
 * La abre todo el equipo (Equipo y roles, F18): cada persona ve «Mis conexiones»; Canales y las
 * integraciones del negocio piden sus claves, y la RLS de integration_configs lo repite.
 */
export default async function IntegrationsPage() {
  // La abre todo el equipo: «Mis conexiones» es de cada persona. Canales y el negocio piden sus claves
  // (`integrationSections`); un Member de sistema ve solo lo suyo. Los secretos no viajan: solo sus nombres.
  const ctx = await getPermissionContext();
  const { workspace, supabase, user } = ctx;
  const sections = integrationSections(ctx.can);
  const shared = hasSharedSections(ctx.can);

  // Mis conexiones: mi Google Calendar y mi Fathom (los mismos datos y OAuth personal de siempre).
  const service = await createServiceClient();
  const since = daysAgoIso(7);
  const [profile, googleConnections, secretNames, { data: fathomConnections }, { data: me }] = await Promise.all([
    getProfileForUser(supabase, workspace.id, user.id),
    listCalendarConnections(supabase, workspace.id, user.id),
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
  const fathomView = fathomCardView({ hasApp: hasFathomApp, connection: mineFathom, isCloser: me?.is_closer === true, callsLast7d });

  const mine = (
    <>
      <MyGoogleCard
        canUse={ctx.can("scheduling.use")}
        hasProfile={Boolean(profile)}
        accounts={googleConnections.map((c) => ({
          id: c.id,
          label: c.account_label ?? "Cuenta de Google",
          status: calendarConnectionStatus({ id: c.id, status: c.status, granted_scopes: c.granted_scopes }),
        }))}
      />
      <MiFathomCard view={fathomView} connectionId={fathomConnectionId} flash={null} embedded />
    </>
  );

  // Lo compartido solo se carga si hay algo que mostrar. Con el cliente de la persona: la RLS decide.
  const integrations = shared ? (await loadIntegrations(supabase, workspace.id)).integrations : {};
  const [{ data: connections }, { data: endpoints }] = shared
    ? await Promise.all([
        supabase.from("oauth_connections").select("status").eq("workspace_id", workspace.id).eq("provider", "fathom"),
        // Webhooks entrantes: solo cuantos hay (sin el token, que la RLS no devuelve).
        supabase.from("webhook_endpoints").select("status").eq("workspace_id", workspace.id).is("deleted_at", null),
      ])
    : [{ data: [] }, { data: [] }];
  const activeEndpoints = (endpoints ?? []).filter((e) => e.status === "active").length;
  const pausedEndpoints = (endpoints ?? []).length - activeEndpoints;
  const connected = (connections ?? []).filter((c) => c.status === "active" || c.status === "attention").length;
  const withError = (connections ?? []).filter((c) => c.status === "error").length;

  return (
    <IntegrationsGrid
      integrations={integrations}
      mine={mine}
      access={{ channels: sections.channels, business: sections.business }}
      // Fathom va con las demas conexiones (Integraciones del negocio > Conexiones), con el mismo diseno.
      fathom={sections.business === "edit" ? <FathomAppCard hasApp={hasFathomApp} returnUrl={`${appUrl()}/api/oauth/fathom/callback`} connected={connected} withError={withError} /> : undefined}
      fathomNeedsAttention={withError > 0 || !hasFathomApp}
      extra={sections.business ? <WebhooksCard active={activeEndpoints} paused={pausedEndpoints} /> : undefined}
    />
  );
}
