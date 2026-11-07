import { DesignsList } from "@/components/designer/list/designs-list";
import { designerAbilities, requireDesigner } from "@/lib/designer/guards";
import { loadList, type ListData } from "@/lib/designer/queries";
import { parseListFilters } from "@/lib/designer/screens/list";
import { parseDesignSettings } from "@/lib/designer/settings-schema";
import { availableStyles } from "@/lib/designer/styles";
import { resolveViewerTimezone } from "@/lib/user-timezone";

export const dynamic = "force-dynamic";

/**
 * Diseñador IA: la lista de Diseños y Plantillas (F15, §11.2). Sin `designer.view`, 404 (F4).
 *
 * Lee con el cliente de la persona (la RLS decide qué ve). Los filtros y la pestaña viven en la URL. La lista de
 * Diseños trae SOLO diseños propios: las generaciones de una plantilla se ven dentro de ella. Las miniaturas se dibujan
 * en vivo con `renderPageHTML` (F48): abrir esta pantalla no le pide nada al servicio de render.
 */
export default async function DisenosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireDesigner("designer.view");
  const abilities = designerAbilities(ctx);
  const filters = parseListFilters(await searchParams);
  const timeZone = await resolveViewerTimezone(ctx.workspace.timezone);
  const settings = parseDesignSettings(ctx.workspace.design_settings, ctx.workspace.id);
  const styles = availableStyles(settings.ok ? settings.settings.styles : []);

  let data: ListData = { items: [], total: 0, assetUrls: {}, uploadedFonts: [], counts: { designs: 0, templates: 0 } };
  let loadError = false;
  try {
    data = await loadList(ctx.supabase, ctx.workspace.id, filters, ctx.workspace.design_settings);
  } catch (error) {
    console.error("[designer] no pude leer la lista:", error instanceof Error ? error.message : "error");
    loadError = true;
  }

  return (
    <DesignsList
      data={data}
      filters={filters}
      canEdit={abilities.edit}
      canManage={abilities.manage}
      loadError={loadError}
      timeZone={timeZone}
      nowIso={new Date().toISOString()}
      styles={styles}
    />
  );
}
