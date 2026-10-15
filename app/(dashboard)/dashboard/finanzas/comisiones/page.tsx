import { CommissionDrawer } from "@/components/commissions/commission-drawer";
import { CommissionsList } from "@/components/commissions/commissions-list";
import { suggestRefundAdjustments } from "@/lib/actions/commissions";
import { requirePermission } from "@/lib/auth/guards";
import type { RefundSuggestionResult } from "@/lib/commissions/action-types";
import { parseCommissionFilters } from "@/lib/commissions/filters";
import { loadCommissionDetail, loadCommissionList } from "@/lib/commissions/list-load";
import { loadDrawerExtras, loadMineSummary, loadRowExtras } from "@/lib/commissions/screen-load";
import { workspaceMethods } from "@/lib/sales/workspace-methods";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { getWorkspaceMembers } from "@/lib/workspace-members";

export const dynamic = "force-dynamic";

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/**
 * Finanzas > Comisiones. Se lee con la sesión de quien mira: la RLS (`can_see_commission`) decide qué comisiones ve.
 * Con alcance propio es «Mis comisiones». Todo el estado vive en la URL: los filtros, la página, la ficha
 * (`?commission=<id>`) y el ajuste de un reembolso (`?ajuste=<id del pago>`).
 */
export default async function ComisionesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePermission("commissions.view");
  const params = await searchParams;
  const filters = parseCommissionFilters(params);
  const data = await loadCommissionList(ctx, filters);
  const own = data.scope === "own";
  const canManage = ctx.can("commissions.manage");

  const commissionId = first(params.commission);
  const refundPaymentId = first(params.ajuste);

  const [extras, mine, everyone, timeZone, detail, refundResult] = await Promise.all([
    loadRowExtras(ctx, data.rows),
    own ? loadMineSummary(ctx) : Promise.resolve(null),
    getWorkspaceMembers(ctx.workspace.id),
    resolveViewerTimezone(ctx.workspace.timezone),
    commissionId ? loadCommissionDetail(ctx, commissionId) : Promise.resolve(null),
    refundPaymentId && canManage ? suggestRefundAdjustments(refundPaymentId) : Promise.resolve(null),
  ]);

  // Quien ve solo lo suyo no recibe la lista del equipo; quien administra la necesita para ajustar y liquidar.
  const members = canManage || !own ? everyone.map((m) => ({ id: m.userId, name: m.name })) : [];
  const names = Object.fromEntries((own ? everyone.filter((m) => m.userId === ctx.user.id) : everyone).map((m) => [m.userId, m.name]));

  let drawer: React.ReactNode = null;
  if (detail) {
    const drawerExtras = await loadDrawerExtras(ctx, { saleId: detail.sale?.id ?? null, paymentId: detail.payment?.id ?? null });
    drawer = (
      <CommissionDrawer
        detail={detail}
        extras={drawerExtras}
        members={members}
        roles={data.roles}
        lookups={{
          roles: Object.fromEntries(data.roles.map((r) => [r.key, r.name])),
          products: Object.fromEntries(data.products.map((p) => [p.id, p.name])),
          people: own ? {} : Object.fromEntries(everyone.map((m) => [m.userId, m.name])),
          methods: Object.fromEntries(workspaceMethods(ctx.workspace).configs.map((m) => [m.key, m.name])),
        }}
        filters={filters}
        timeZone={timeZone}
        names={names}
        can={{ expenses: ctx.can("expenses.view"), sales: ctx.can("sales.view"), content: ctx.can("content.view"), ads: ctx.can("dashboards.ads.view") }}
      />
    );
  }

  let refund: RefundSuggestionResult | null = null;
  let refundError: string | null = null;
  if (refundPaymentId) {
    if (!canManage) refundError = "Para ajustar las comisiones de un reembolso necesitás poder administrar las comisiones.";
    else if (refundResult && !refundResult.ok) refundError = refundResult.error;
    else if (refundResult?.ok) {
      const { refundPaymentId: refundId, originalPaymentId, saleId, refundedCents, paidCents, suggestions } = refundResult;
      refund = { refundPaymentId: refundId, originalPaymentId, saleId, refundedCents, paidCents, suggestions };
    }
  }

  return (
    <CommissionsList
      data={data}
      extras={extras}
      mine={mine}
      canViewExpenses={ctx.can("expenses.view")}
      canViewSales={ctx.can("sales.view")}
      members={members}
      drawer={drawer}
      drawerMissing={!!commissionId && !detail}
      refund={refund}
      refundError={refundError}
    />
  );
}
