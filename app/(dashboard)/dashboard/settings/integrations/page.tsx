import { getPermissionContext } from "@/lib/auth/guards";
import { hasSharedSections, integrationSections } from "@/lib/integrations/sections";
import { createServiceClient } from "@/lib/supabase/server"; // @plantilla-quitar(llamadas)
import { IntegrationsGrid } from "@/components/settings/integrations/integrations-grid";
import { loadIntegrations } from "@/lib/integrations/load";
import { FathomAppCard } from "@/components/settings/integrations/fathom-app-card"; // @plantilla-quitar(llamadas)
import { WebhooksCard } from "@/components/settings/integrations/webhooks-card"; // @plantilla-quitar(webhooks)
import { WebsiteCard } from "@/components/settings/integrations/website-card"; // @plantilla-quitar(formularios)
import { parseWebsiteSettings } from "@/lib/settings/website"; // @plantilla-quitar(formularios)
import { listSecretNames, SECRET_NAMES } from "@/lib/vault"; // @plantilla-quitar(llamadas)
import { appUrl } from "@/lib/app-url"; // @plantilla-quitar(llamadas)

/**
 * Integraciones: todo lo que el negocio conecta con afuera, en dos secciones (12/11/2026): Integraciones del negocio
 * (canales incluidos, Sitio web y Webhooks al final) e Inteligencia artificial. Las conectadas van primero.
 *
 * `loadIntegrations` arma lo que cada card necesita —estado (con la salud de la credencial OAuth, G3), cuenta
 * conectada, barra de uso y QUE secretos hay guardados— y nada mas. El valor de un secreto no sale de Vault.
 *
 * La abre todo el equipo (Equipo y roles, F18), pero lo personal (Google Calendar y Fathom propios) se mudo a
 * Mi cuenta → Conexiones. Canales y el negocio piden sus claves, y la RLS de integration_configs lo repite; un Member
 * de sistema ve solo el aviso de donde conectar lo suyo.
 */
export default async function IntegrationsPage() {
  const ctx = await getPermissionContext();
  const { workspace, supabase } = ctx;
  const sections = integrationSections(ctx.can);
  const shared = hasSharedSections(ctx.can);

  // Lo compartido solo se carga si hay algo que mostrar. Con el cliente de la persona: la RLS decide.
  const integrations = shared ? (await loadIntegrations(supabase, workspace.id)).integrations : {};
  // @plantilla-desde(llamadas)
  const service = await createServiceClient();
  const secretNames = shared ? await listSecretNames(service, workspace.id) : [];
  const hasFathomApp = secretNames.includes(SECRET_NAMES.fathomClientId) && secretNames.includes(SECRET_NAMES.fathomClientSecret);
  // @plantilla-hasta(llamadas)
  // @plantilla-desde(llamadas,webhooks)
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
  // @plantilla-hasta(llamadas,webhooks)

  return (
    <IntegrationsGrid
      integrations={integrations}
      access={{ channels: sections.channels, business: sections.business }}
      // Fathom va con las demas integraciones del negocio, con el mismo diseno. // @plantilla-quitar(llamadas)
      fathom={sections.business === "edit" ? <FathomAppCard hasApp={hasFathomApp} returnUrl={`${appUrl()}/api/oauth/fathom/callback`} connected={connected} withError={withError} /> : undefined} // @plantilla-quitar(llamadas)
      fathomNeedsAttention={withError > 0 || !hasFathomApp} // @plantilla-quitar(llamadas)
      fathomConnected={hasFathomApp && connected > 0} // @plantilla-quitar(llamadas)
      tail={
        <>
          {/* @plantilla-desde(formularios) */}
          <WebsiteCard origins={parseWebsiteSettings((workspace as { website_settings?: unknown }).website_settings).allowedOrigins.length} />
          {/* @plantilla-hasta(formularios) */}
          {/* @plantilla-desde(webhooks) */}
          <WebhooksCard active={activeEndpoints} paused={pausedEndpoints} />
          {/* @plantilla-hasta(webhooks) */}
        </>
      }
    />
  );
}
