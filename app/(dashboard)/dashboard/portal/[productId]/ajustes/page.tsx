// @plantilla-quitar(servicios)
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAnyPermission } from "@/lib/auth/guards";
import { isModuleEnabled, moduleShows } from "@/lib/services/module";
import { opensLabel } from "@/lib/services/screens/variant-portal-form";
import { SECTION_LABELS } from "@/lib/services/availability";
import { PROGRAM_PAGE_PERMISSIONS, loadPortalProgram } from "@/lib/portal-admin/load-program";
import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/ui/back-link";
import { ProgramSettingsPanel } from "@/components/services/portal/program-settings-panel";
import { ProgramTermsPanel } from "@/components/services/portal/program-terms-panel";
import type { PortalFormInitial } from "@/components/services/portal/portal-form-editor";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ajustes del programa (el engranaje de la barra de un programa del portal): las secciones prendidas, los términos al
 * entrar y el resumen de las variantes. Edita quien tiene `portal.sections`.
 */
export default async function PortalProgramSettingsPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  if (!UUID.test(productId)) notFound();
  const ctx = await requireAnyPermission(PROGRAM_PAGE_PERMISSIONS);
  const { workspace, supabase } = ctx;
  if (!moduleShows("route.portal", { servicesEnabled: isModuleEnabled(workspace as { services_enabled?: boolean | null }) })) notFound();
  const loaded = await loadPortalProgram(supabase, workspace.id, productId);
  if (!loaded) notFound();
  const { program: p, variants: vs } = loaded;
  const ps = (p.portal_settings ?? {}) as { sections?: Record<string, boolean>; terms?: { enabled?: boolean; form_id?: string | null; ask_again_on_change?: boolean } };
  const canEdit = ctx.can("portal.sections");

  // Términos al entrar (F113): el formulario del producto se lee con el cliente de servicio, del negocio de la sesión.
  const terms = ps.terms ?? {};
  let termsForm: PortalFormInitial | null = null;
  if (terms.form_id) {
    const { data } = await (await createServiceClient()).from("forms").select("name, draft_definition").eq("id", terms.form_id).eq("workspace_id", workspace.id).maybeSingle();
    const f = data as { name: string; draft_definition: { intro?: string; fields?: PortalFormInitial["fields"] } } | null;
    if (f) termsForm = { name: f.name, intro: f.draft_definition?.intro ?? "", fields: f.draft_definition?.fields ?? [], quiz: {}, grading: { enabled: false } };
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={`Ajustes de ${p.name}`}
        route="/dashboard/portal/[productId]/ajustes"
        backHref={<BackLink href={`/dashboard/portal/${p.id}`} label={`Volver a ${p.name}`} />}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 md:px-8">
          <section aria-labelledby="secciones" className="space-y-2">
            <h2 id="secciones" className="text-sm font-semibold">
              Secciones del programa
            </h2>
            <ProgramSettingsPanel productId={p.id} mode="sections" sections={ps.sections ?? {}} links={[]} visibleLinkKeys={[]} rev={p.portal_settings_rev ?? 0} canEdit={canEdit} />
          </section>
          <section aria-labelledby="terminos" className="space-y-2">
            <h2 id="terminos" className="text-sm font-semibold">
              Términos al entrar
            </h2>
            <ProgramTermsPanel productId={p.id} terms={terms} rev={p.portal_settings_rev ?? 0} form={termsForm} canEdit={canEdit} />
          </section>
          <section aria-labelledby="variantes" className="space-y-2">
            <h2 id="variantes" className="text-sm font-semibold">
              Variantes
            </h2>
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {vs.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <span className="text-foreground">{v.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {v.portal.enabled
                      ? (v.portal.sections ?? [])
                          .filter((s) => s.included !== false)
                          .map((s) => `${SECTION_LABELS[s.section as keyof typeof SECTION_LABELS] ?? s.section}: ${opensLabel(s).toLowerCase()}`)
                          .join(" · ") || "Con acceso, sin secciones"
                      : "Sin acceso al portal"}
                  </span>
                  <Link href={`/dashboard/settings/productos/${p.id}/variantes/${v.id}?tab=portal`} className="text-xs text-primary-ink hover:underline">
                    Editar en Productos
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
