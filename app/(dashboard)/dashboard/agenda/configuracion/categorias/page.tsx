import { getPermissionContext } from "@/lib/auth/guards";
import { categoryUsage, listCategories, toCategoryRow } from "@/lib/scheduling/data/event-types";
import { CategoriesView } from "@/components/scheduling/categories-view";

export const dynamic = "force-dynamic";

/** Configuracion de agenda > Categorias (F50). La ven todos; la editan los que tienen el permiso. */
export default async function AgendaCategoriasPage() {
  const ctx = await getPermissionContext();
  const [rows, usage] = await Promise.all([
    listCategories(ctx.supabase, ctx.workspace.id),
    categoryUsage(ctx.supabase, ctx.workspace.id),
  ]);

  return (
    <CategoriesView
      categories={rows.map(toCategoryRow)}
      canEdit={ctx.can("scheduling.manage_categories")}
      usage={Object.fromEntries(usage)}
    />
  );
}
