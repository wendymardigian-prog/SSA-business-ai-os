import { requireAnyPermission } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { appUrl } from "@/lib/app-url";
import { parseWebsiteSettings } from "@/lib/settings/website";
import { guideFields, type GuideForm } from "@/lib/settings/website-guide";
import { fieldsOf } from "@/lib/forms/server-ports";
import { isPublicFormType } from "@/lib/forms/fields";
import { WebsiteScreen } from "@/components/settings/integrations/website-screen";

/**
 * Integraciones › Tu sitio web: los orígenes desde los que la web del negocio manda
 * formularios (CORS, 00277) y la guía para conectarla con los datos reales.
 *
 * La ve quien puede ver las integraciones del negocio; la cambia `integrations.manage`.
 * Lee con el cliente de servicio, filtrando por el workspace de la sesión, DESPUÉS del
 * permiso (las definiciones de los formularios solo dicen sus preguntas, nada de respuestas).
 */
export default async function WebsitePage() {
  const ctx = await requireAnyPermission(["integrations.view", "integrations.manage"]);
  const workspace = ctx.workspace as { id: string; slug?: string | null; website_settings?: unknown };
  const db = await createServiceClient();

  const { data: forms } = await db
    .from("forms")
    .select("name, slug, type, current_version_id")
    .eq("workspace_id", workspace.id)
    .eq("status", "published")
    .not("current_version_id", "is", null)
    .order("name");
  const publicForms = (forms ?? []).filter((f) => isPublicFormType(f.type));
  const versionIds = publicForms.map((f) => f.current_version_id as string);
  const { data: versions } = versionIds.length
    ? await db.from("form_versions").select("id, definition").in("id", versionIds)
    : { data: [] as Array<{ id: string; definition: unknown }> };
  const byVersion = new Map((versions ?? []).map((v) => [v.id, v.definition]));

  const guide: GuideForm[] = publicForms.map((f) => ({
    name: f.name,
    slug: f.slug,
    fields: guideFields(fieldsOf(byVersion.get(f.current_version_id as string) as never)),
  }));

  return (
    <WebsiteScreen
      initialOrigins={parseWebsiteSettings(workspace.website_settings).allowedOrigins}
      canEdit={ctx.can("integrations.manage")}
      appUrl={appUrl()}
      workspaceSlug={workspace.slug ?? ""}
      forms={guide}
    />
  );
}
