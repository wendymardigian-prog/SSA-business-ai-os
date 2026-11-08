import { notFound } from "next/navigation";
import { resolveBrand } from "@/lib/brand";
import type { DesignKind } from "@/lib/designer/contracts";
import { designerAbilities, requireDesigner } from "@/lib/designer/guards";
import { designLinksFor } from "@/lib/designer/public-links";
import { countGenerations, loadEditorRecord, signDocAssets } from "@/lib/designer/queries";
import { parseDesignSettings } from "@/lib/designer/settings-schema";
import type { UploadedFont } from "@/lib/designer/fonts";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { DesignEditor } from "./design-editor";

/**
 * La pantalla del editor de un diseño, una generación o una plantilla (F17). Sin `designer.view`, 404 (F4). Lee con el
 * cliente de la PERSONA (la RLS decide qué ve). Los links salen del dominio del negocio, armados acá y nunca en el navegador.
 */
export async function EditorPage({ kind, id }: { kind: DesignKind; id: string }) {
  const ctx = await requireDesigner("designer.view");
  const { supabase, workspace } = ctx;
  const loaded = await loadEditorRecord(supabase, workspace.id, kind, id);
  if (!loaded.ok && loaded.reason === "not_found") notFound();
  if (!loaded.ok) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div className="max-w-md">
          <p className="text-base font-semibold">No pudimos abrir este diseño</p>
          <p className="mt-1 text-sm text-muted-foreground">El documento guardado no tiene la forma esperada. Podés volver a una versión anterior desde el historial o pedir ayuda al equipo.</p>
        </div>
      </div>
    );
  }
  const { record } = loaded;
  const settings = parseDesignSettings(workspace.design_settings, workspace.id);
  const parsed = settings.ok ? settings.settings : { palette: [], styles: [], fonts: { google: [], uploaded: [] } };
  const uploadedFonts = (parsed.fonts?.uploaded ?? []) as UploadedFont[];
  const [assetUrls, generationsCount, timeZone] = await Promise.all([
    signDocAssets(supabase, workspace.id, record.doc, parsed),
    kind === "template" ? countGenerations(supabase, workspace.id, record.id) : Promise.resolve(0),
    resolveViewerTimezone(workspace.timezone),
  ]);
  const links = record.code ? designLinksFor(workspace, record.code) : null;
  const brand = resolveBrand(workspace);

  return (
    <DesignEditor
      // Si el servidor manda otro diseño (otra URL), el editor arranca de cero.
      key={`${record.kind}:${record.id}`}
      record={record}
      assetUrls={assetUrls}
      uploadedFonts={uploadedFonts}
      googleFonts={parsed.fonts?.google ?? []}
      brand={{ name: brand.name, colorHex: brand.colorHex }}
      palette={parsed.palette ?? []}
      links={links ? { link: links.link, pdfUrl: links.pdfUrl } : null}
      can={{ ...designerAbilities(ctx), automate: ctx.can("flows.edit"), content: ctx.can("content.create") }}
      generationsCount={generationsCount}
      timeZone={timeZone}
      workspaceName={brand.name}
    />
  );
}
