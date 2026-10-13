import { requireWorkspaceAdmin } from "@/lib/auth/guards";
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
 * Solo Owner/Admin. El guard rebota al dashboard y ademas la RLS de
 * integration_configs no le devuelve una sola fila a un Member.
 */
export default async function IntegrationsPage() {
  const { workspace, supabase } = await requireWorkspaceAdmin();
  const { integrations } = await loadIntegrations(supabase, workspace.id);

  // Fathom (Llamadas) no pasa por el catalogo: es la app OAuth del negocio y
  // cada closer conecta la suya. Aca solo se carga la app y se cuenta quien conecto.
  const [secretNames, { data: connections }, { data: endpoints }] = await Promise.all([
    listSecretNames(supabase, workspace.id),
    supabase.from("oauth_connections").select("status").eq("workspace_id", workspace.id).eq("provider", "fathom"),
    // Webhooks entrantes: solo cuantos hay (la RLS deja leer la lista a Owner y Admin, sin el token).
    supabase.from("webhook_endpoints").select("status").eq("workspace_id", workspace.id).is("deleted_at", null),
  ]);
  const activeEndpoints = (endpoints ?? []).filter((e) => e.status === "active").length;
  const pausedEndpoints = (endpoints ?? []).length - activeEndpoints;
  const hasApp = secretNames.includes(SECRET_NAMES.fathomClientId) && secretNames.includes(SECRET_NAMES.fathomClientSecret);
  const connected = (connections ?? []).filter((c) => c.status === "active" || c.status === "attention").length;
  const withError = (connections ?? []).filter((c) => c.status === "error").length;

  return (
    <IntegrationsGrid
      integrations={integrations}
      extra={
        <div className="space-y-4">
          <FathomAppCard
            hasApp={hasApp}
            returnUrl={`${appUrl()}/api/oauth/fathom/callback`}
            connected={connected}
            withError={withError}
          />
          <WebhooksCard active={activeEndpoints} paused={pausedEndpoints} />
        </div>
      }
    />
  );
}
