// @plantilla-quitar(servicios)
import { notFound } from "next/navigation";
import { requireAnyPermission } from "@/lib/auth/guards";
import { isModuleEnabled, moduleShows } from "@/lib/services/module";
import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/ui/back-link";
import { PortalSettingsForm } from "@/components/services/portal/portal-settings-form";
import { resolveBrand } from "@/lib/brand";

export const dynamic = "force-dynamic";

/**
 * Ajustes del portal (F43): el engranaje de la barra de Portal. Lo ve quien tiene `portal.settings` o `portal.view`;
 * edita solo `portal.settings`. Con el módulo apagado, 404. Se lee con la sesión de quien mira.
 */
export default async function PortalAjustesPage() {
  const ctx = await requireAnyPermission(["portal.settings", "portal.view"]);
  const { workspace, supabase } = ctx;
  if (!moduleShows("route.portal", { servicesEnabled: isModuleEnabled(workspace as { services_enabled?: boolean | null }) })) notFound();
  const { data } = await supabase.from("workspaces").select("portal_settings, portal_settings_rev").eq("id", workspace.id).maybeSingle();
  const row = data as { portal_settings?: Record<string, unknown> | null; portal_settings_rev?: number | null } | null;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/portal/ajustes"
        backHref={<BackLink href="/dashboard/portal" label="Volver a Portal" />}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8">
          <PortalSettingsForm
            initial={(row?.portal_settings ?? {}) as never}
            rev={row?.portal_settings_rev ?? 0}
            canEdit={ctx.can("portal.settings")}
            workspaceName={workspace.name}
            brand={resolveBrand(workspace as never)}
            timeZone={(workspace as { timezone?: string | null }).timezone ?? null}
          />
        </div>
      </div>
    </div>
  );
}
