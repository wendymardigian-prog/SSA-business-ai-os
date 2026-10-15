import { redirect } from "next/navigation";
import { RulesScreen } from "@/components/commissions/rules/rules-screen";
import { requireAnyPermission } from "@/lib/auth/guards";
import { COMMISSIONS_PATH, pickRoleTab, rulesAccess } from "@/lib/commissions/rules-ui-access";
import { loadRulesForViewer } from "@/lib/commissions/rules-ui-load";

export const dynamic = "force-dynamic";

/**
 * Finanzas > Comisiones > Reglas de comisión. Edita quien tiene `commissions.manage`; quien tiene `commissions.view`
 * con alcance «todo» la ve en solo lectura; el resto vuelve a la lista de comisiones. La pestaña de cada rol vive en la
 * URL (`?rol=`). Las reglas se leen con la sesión de quien mira: la base decide qué ve cada quien.
 */
export default async function ReglasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireAnyPermission(["commissions.manage", "commissions.view"]);
  const access = rulesAccess(ctx.can, ctx.scope("commissions"));
  if (access === "none") redirect(COMMISSIONS_PATH);

  const data = await loadRulesForViewer(ctx, access);
  const role = pickRoleTab((await searchParams).rol, data.roles);
  return <RulesScreen data={data} initialRole={role} />;
}
