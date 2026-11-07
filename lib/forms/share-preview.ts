/**
 * La tarjeta de un link de formulario (ver `lib/og/share.ts`). SOLO servidor. Recibe la
 * definición pública que dio `get_public_form`: de la tabla `forms` solo se lee de qué negocio
 * es. Si no se puede leer la marca devuelve null: mejor sin tarjeta que con el logo de otro negocio.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { resolveBrand } from "@/lib/brand";
import { SHARE_WORKSPACE_COLUMNS, buildShareData, type ShareData } from "@/lib/og/share";
import { formShareText } from "@/lib/og/text";
import type { PublicFormData } from "./public-client";

export async function loadFormShare(service: SupabaseClient<Database>, form: PublicFormData): Promise<ShareData | null> {
  try {
    const { data: row, error: formError } = await service.from("forms").select("workspace_id").ilike("slug", form.slug).maybeSingle();
    if (formError || !row) return null;
    const { data: workspace, error } = await service.from("workspaces").select(SHARE_WORKSPACE_COLUMNS).eq("id", row.workspace_id).maybeSingle();
    if (error || !workspace) return null;
    return buildShareData(
      workspace,
      `/f/${encodeURIComponent(form.slug)}`,
      formShareText({ title: form.design?.title, intro: form.design?.intro, businessName: resolveBrand(workspace).name }),
    );
  } catch (error) {
    console.error("[vista previa] no pude leer la marca del formulario:", error instanceof Error ? error.message : String(error));
    return null;
  }
}
