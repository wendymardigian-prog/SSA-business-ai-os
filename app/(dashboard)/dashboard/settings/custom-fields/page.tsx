import { requirePermission } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { CustomFieldsView, type FieldRow } from "./custom-fields-view";

/**
 * Definicion de campos personalizados (F6).
 *
 * Es de Owner/Admin: definir un campo cambia la ficha de todos los contactos
 * del workspace. Completar el valor de un campo, en cambio, lo hace cualquiera
 * que vea el contacto.
 */
export default async function CustomFieldsPage() {
  const { workspace, supabase } = await requirePermission("custom_fields.manage");

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
  // Una cuenta por campo (antes se traian todas las filas y se cortaba en
  // 1000), con el cliente de servicio filtrado por los campos de ESTE workspace:
  // la RLS de contactos no tiene que achicar el numero.
  const service = await createServiceClient();
  const usos = new Map<string, number>();
  await Promise.all(
    (data ?? []).map(async (f) => {
      const { count, error: countError } = await service
        .from("contact_custom_fields")
        .select("field_id", { count: "exact", head: true })
        .eq("field_id", f.id);
      if (countError) console.error("[custom-fields] conteo fallido:", countError.message);
      usos.set(f.id, count ?? 0);
    }),
  );

  const fields: FieldRow[] = (data ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    slug: f.slug,
    type: f.type,
    usedBy: usos.get(f.id) ?? 0,
  }));

  return <CustomFieldsView fields={fields} />;
}
