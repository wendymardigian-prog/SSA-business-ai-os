import { requireAnyPermission } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { loadEndpointList } from "@/lib/webhooks/queries";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { WebhooksScreen } from "@/components/webhooks/webhooks-screen";

/**
 * Integraciones › Webhooks entrantes. La abre quien tenga `flows.edit` o `integrations.manage`.
 *
 * Lee con el cliente de servicio, restringido al workspace de la sesion, DESPUES de chequear el
 * permiso aca (la RLS usa `has_permission`, que para el Member de sistema devuelve false aunque
 * tenga `flows.edit`). Con solo `integrations.manage` se ve la lista, sin URL ni acciones.
 */
export default async function WebhooksPage() {
  const ctx = await requireAnyPermission(["flows.edit", "integrations.manage"]);
  const db = await createServiceClient();
  const endpoints = await loadEndpointList(db, ctx.workspace.id);
  const timeZone = await resolveViewerTimezone((ctx.workspace as { timezone?: string }).timezone);
  return <WebhooksScreen endpoints={endpoints} canEdit={ctx.can("flows.edit")} timeZone={timeZone} />;
}
