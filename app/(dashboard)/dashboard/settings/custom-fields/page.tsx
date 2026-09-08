import { requireWorkspaceAdmin } from "@/lib/auth/guards";
import { CustomFieldsView, type FieldRow } from "./custom-fields-view";

/**
 * Definicion de campos personalizados (F6).
 *
 * Es de Owner/Admin: definir un campo cambia la ficha de todos los contactos
 * del workspace. Completar el valor de un campo, en cambio, lo hace cualquiera
 * que vea el contacto.
 */
export default async function CustomFieldsPage() {
  const { workspace, supabase } = await requireWorkspaceAdmin();

  const { data, error } = await supabase
    .from("custom_field_definitions")
    .select("id, name, slug, type")
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .order("name");

  if (error) {
    console.error("[custom-fields] listado fallido:", error.message);
  }

  // Cuantos contactos tienen un valor cargado en cada campo: es lo que decide
  // si el tipo se puede cambiar, y lo que hay que avisar antes de eliminar.
  const { data: valores } = await supabase
    .from("contact_custom_fields")
    .select("field_id");

  const usos = new Map<string, number>();
  for (const v of valores ?? []) {
    usos.set(v.field_id, (usos.get(v.field_id) ?? 0) + 1);
  }

  const fields: FieldRow[] = (data ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    slug: f.slug,
    type: f.type,
    usedBy: usos.get(f.id) ?? 0,
  }));

  return <CustomFieldsView fields={fields} />;
}
