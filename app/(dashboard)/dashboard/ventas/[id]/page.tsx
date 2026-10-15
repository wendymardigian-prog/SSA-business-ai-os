import { notFound } from "next/navigation";
import { SaleContracts } from "@/components/sales/sale-contracts";
import { SaleDetail, type SaleDetailData } from "@/components/sales/sale-detail";
import { loadSaleContracts } from "@/lib/sales/contracts-load";
import { createServiceClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/guards";
import { saleNumbers } from "@/lib/sales/detail";
import { loadWizardConfig } from "@/lib/sales/wizard/load";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { snapshotText } from "@/lib/sales/sale-text";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La ficha de una venta (F26). Se lee con el cliente del usuario: si la RLS (`can_see_sale`)
 * no deja ver la venta, es un 404 (no se confirma que exista).
 */
export default async function VentaPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("sales.view");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { supabase, workspace } = ctx;

  const { data: sale } = await supabase
    .from("sales")
    .select("id, contact_id, status, financing_type, subscription_interval, base_amount, discount_amount, final_amount, discount_reason, product_snapshot, product_variant_id, setter_id, vendedor_id, attribution, attribution_type, booking_id, service_starts_at, sale_date, notes, plan_unbalanced, cancellation_reason, subscription_cancel_reason, created_at, updated_at")
    .eq("id", id)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!sale) notFound();

  const service = await createServiceClient();
  const [payments, contact, members, timeZone, booking, wizard, contracts] = await Promise.all([
    supabase.from("payments").select("id, type, status, amount, due_date, original_due_date, paid_on, delay_days, payment_method, provider_fee_amount, provider_fee_percent, provider_fee_fixed, receipt_path, reschedule_count, notes").eq("sale_id", id).order("due_date", { ascending: true }).order("created_at", { ascending: true }),
    supabase.from("contacts").select("id, display_name, email, phone").eq("id", sale.contact_id).maybeSingle().then((r) => r.data),
    getWorkspaceMembers(workspace.id),
    resolveViewerTimezone(workspace.timezone),
    sale.booking_id ? supabase.from("bookings").select("id, start_at, title").eq("id", sale.booking_id).maybeSingle().then((r) => r.data) : Promise.resolve(null),
    loadWizardConfig(ctx),
    // La venta ya se comprobó con la sesión de quien mira: las firmas se leen con el cliente de servicio.
    loadSaleContracts(service, workspace.id, id),
  ]);

  const rows = payments.data ?? [];
  const names = Object.fromEntries(members.map((m) => [m.userId, m.name]));
  const data: SaleDetailData = {
    sale: { ...sale, product: snapshotText(sale.product_snapshot) },
    payments: rows,
    numbers: saleNumbers(sale.final_amount, rows),
    contact: contact ? { id: contact.id, name: contact.display_name || contact.email || "Sin nombre", email: contact.email ?? null, phone: contact.phone ?? null } : null,
    booking: booking ? { id: booking.id, startAt: booking.start_at, title: booking.title } : null,
    names,
    members: wizard.members,
    timeZone,
    today: wizard.today,
    canManage: ctx.can("sales.manage"),
    canManagePayments: ctx.can("payments.manage"),
    enabledMethods: wizard.enabledMethods,
    methods: wizard.methods,
  };

  const closed = ["cancelled", "refunded", "subscription_cancelled"].includes(sale.status);
  return (
    <SaleDetail
      data={data}
      wizard={wizard}
      contracts={
        <SaleContracts
          saleId={sale.id}
          data={contracts}
          canManage={ctx.can("sales.manage")}
          canViewForms={ctx.can("forms.view")}
          canManageForms={ctx.can("forms.manage")}
          saleOpen={!closed}
          timeZone={timeZone}
        />
      }
    />
  );
}
