import { PageHeader } from "@/components/page-header";
import { SettingsScreen } from "@/components/designer/settings/settings-screen";
import { createServiceClient } from "@/lib/supabase/server";
import { CURATED_FONTS } from "@/lib/designer/fonts";
import { requireDesigner } from "@/lib/designer/guards";
import { googleFamiliesToLoad, previewFontsHref } from "@/lib/designer/screens/settings";
import { parseDesignSettings } from "@/lib/designer/settings-schema";
import { signAssetUrls } from "@/lib/designer/storage";

export const dynamic = "force-dynamic";

/**
 * Ajustes del Diseñador IA: estilos propios y fuentes (F11, F37, §11.8). Pide `designer.manage`; sin él, 404.
 * Los ajustes salen de `workspaces.design_settings` del negocio de la SESIÓN; las fuentes subidas se dibujan con
 * links firmados de 10 minutos (nunca públicos).
 */
export default async function DisenosAjustesPage() {
  const ctx = await requireDesigner("designer.manage");
  const parsed = parseDesignSettings(ctx.workspace.design_settings, ctx.workspace.id);
  const settings = parsed.ok ? parsed.settings : { palette: [], styles: [], fonts: { google: [], uploaded: [] } };
  const styles = settings.styles ?? [];
  const google = settings.fonts?.google ?? [];
  const uploaded = settings.fonts?.uploaded ?? [];

  // Diseños propios para «elegir diseños existentes» como piezas de referencia (la RLS decide cuáles ve).
  const { data: designRows } = await ctx.supabase
    .from("designs")
    .select("id, name")
    .eq("workspace_id", ctx.workspace.id)
    .is("template_id", null)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(30);
  const designs = (designRows ?? []).map((d) => ({ id: d.id, name: d.name }));

  const signed = await signAssetUrls(await createServiceClient(), ctx.workspace.id, uploaded.map((f) => f.path));
  const previewFaces = uploaded.flatMap((f) => {
    const url = signed.get(f.path);
    return url ? [{ family: f.family, weight: f.weight, style: f.style, url }] : [];
  });

  const googleHref = previewFontsHref(googleFamiliesToLoad(styles, google, uploaded.map((f) => f.family)));

  return (
    <div className="flex h-full flex-col">
      <PageHeader route="/dashboard/disenos/ajustes" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SettingsScreen styles={styles} google={google} uploaded={uploaded} designs={designs} googleHref={googleHref} previewFaces={previewFaces} curatedCount={CURATED_FONTS.length} />
      </div>
    </div>
  );
}
