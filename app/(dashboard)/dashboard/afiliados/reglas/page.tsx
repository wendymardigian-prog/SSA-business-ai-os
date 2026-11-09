// @plantilla-quitar(ventas)
import { requirePermission } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { loadAffiliateSettings } from "@/lib/affiliates/load";
import { AffiliateSettingsForm } from "@/components/affiliates/affiliate-settings-form";
import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/ui/back-link";

export const dynamic = "force-dynamic";

/**
 * Reglas de afiliados (F105): el engranaje de la barra de Afiliados. Pide `affiliates.settings`; se lee con el cliente
 * de servicio DESPUÉS del permiso, filtrado por el negocio de la sesión.
 */
export default async function AfiliadosReglasPage() {
  const ctx = await requirePermission("affiliates.settings");
  const { settings, rev } = await loadAffiliateSettings(await createServiceClient(), ctx.workspace.id);
  // Quien solo tiene las reglas no ve la lista: la flecha de volver no lo llevaría a ningún lado.
  const canList = ctx.can("affiliates.view_all");
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/afiliados/reglas"
        backHref={canList ? <BackLink href="/dashboard/afiliados" label="Volver a Afiliados" /> : undefined}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 md:px-8">
          <AffiliateSettingsForm initial={settings} rev={rev} canEdit />
        </div>
      </div>
    </div>
  );
}
