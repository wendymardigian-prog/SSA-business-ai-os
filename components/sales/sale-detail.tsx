"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, ArrowLeft, Calendar, ExternalLink, Pencil, User } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Historial } from "@/components/historial/historial";
import { CancelDialog, RebuildPlanDialog } from "@/components/sales/sale-action-dialogs";
import { SaleEditDialog, type EditableSale } from "@/components/sales/sale-edit-dialog";
import { StatusChip } from "@/components/sales/sales-list";
import type { WizardConfig, WizardMember } from "@/components/sales/wizard/types";
import { describeAttribution, type SaleAttribution } from "@/lib/sales/attribution";
import type { SaleNumbers } from "@/lib/sales/detail";
import { isLockedForEdit } from "@/lib/sales/edit";
import { formatMoney } from "@/lib/sales/format";
import { ATTRIBUTION_TYPE_LABELS, FINANCING_TYPE_LABELS, PAYMENT_TYPE_LABELS, paymentStatusLabel, type AttributionType, type FinancingType, type PaymentType } from "@/lib/sales/labels";
import { PaymentPlan } from "@/components/sales/payment-plan";
import type { TablePayment } from "@/lib/sales/payment-table";

export interface SaleDetailData {
  sale: {
    id: string;
    contact_id: string;
    status: string;
    financing_type: string;
    subscription_interval: string | null;
    base_amount: unknown;
    discount_amount: unknown;
    final_amount: unknown;
    discount_reason: string | null;
    product_snapshot: unknown;
    product_variant_id: string;
    setter_id: string | null;
    vendedor_id: string | null;
    attribution: unknown;
    attribution_type: string;
    booking_id: string | null;
    service_starts_at: string | null;
    sale_date: string;
    notes: string | null;
    plan_unbalanced: boolean;
    cancellation_reason: string | null;
    subscription_cancel_reason: string | null;
    created_at: string;
    updated_at: string;
    product: string;
  };
  payments: TablePayment[];
  numbers: SaleNumbers;
  contact: { id: string; name: string; email: string | null; phone: string | null } | null;
  booking: { id: string; startAt: string; title: string | null } | null;
  names: Record<string, string>;
  members: WizardMember[];
  timeZone: string;
  today: string;
  canManage: boolean;
  canManagePayments: boolean;
  enabledMethods: string[];
}

function formatDate(date: string | null): string {
  if (!date) return "—";
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * La ficha de una venta (F26): cabecera con los números, datos, plan de pagos (solo lectura en
 * este bloque), contratos e historial. Las acciones solo aparecen con `sales.manage`.
 */
export function SaleDetail({ data, wizard, contracts }: { data: SaleDetailData; wizard: WizardConfig; contracts?: React.ReactNode }) {
  const { sale, payments, numbers, contact } = data;
  const [dialog, setDialog] = useState<"edit" | "cancel" | "subscription" | "rebuild" | null>(null);
  const closed = isLockedForEdit(sale.status) || sale.status === "subscription_cancelled";
  const isSubscription = sale.financing_type === "subscription";
  const attribution = sale.attribution_type === "none" ? null : (sale.attribution as SaleAttribution | null);
  const attributionLine = attribution ? describeAttribution(attribution, new Date(), data.timeZone) : "Sin atribución";
  const hasCollected = payments.some((p) => p.status === "paid" && Number(p.amount) > 0);
  const cancelReason = sale.cancellation_reason ?? sale.subscription_cancel_reason;

  const editable: EditableSale = {
    id: sale.id,
    contact_id: sale.contact_id,
    status: sale.status,
    setter_id: sale.setter_id,
    vendedor_id: sale.vendedor_id,
    base_amount: sale.base_amount,
    discount_amount: sale.discount_amount,
    discount_reason: sale.discount_reason,
    product_snapshot: sale.product_snapshot,
    product_variant_id: sale.product_variant_id,
    notes: sale.notes,
    service_starts_at: sale.service_starts_at,
    attribution_line: `${ATTRIBUTION_TYPE_LABELS[sale.attribution_type as AttributionType] ?? sale.attribution_type}: ${attributionLine}`,
    updated_at: sale.updated_at,
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        route="/dashboard/ventas/[id]"
        backHref={
          <Link href="/dashboard/ventas" aria-label="Volver a Ventas" className="-ml-1 flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground">
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
        }
        right={
          data.canManage ? (
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={() => setDialog("edit")} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm hover:bg-accent" aria-label="Editar la venta">
                <Pencil className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Editar</span>
              </button>
              {!closed && !isSubscription && (
                <button type="button" onClick={() => setDialog("cancel")} className="inline-flex h-9 items-center rounded-lg border border-red-500/40 px-2.5 text-sm text-red-700 hover:bg-red-500/10 dark:text-red-400">Cancelar venta</button>
              )}
              {sale.status === "subscription_active" && (
                <button type="button" onClick={() => setDialog("subscription")} className="inline-flex h-9 items-center rounded-lg border border-red-500/40 px-2.5 text-sm text-red-700 hover:bg-red-500/10 dark:text-red-400">Dar de baja</button>
              )}
            </div>
          ) : undefined
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
          <header className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold">{sale.product}</h1>
                <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <User className="h-3.5 w-3.5" aria-hidden />
                  {contact ? <Link href={`/dashboard/contacts/${contact.id}`} className="underline-offset-2 hover:underline">{contact.name}</Link> : "Contacto sin acceso"}
                </p>
              </div>
              <StatusChip status={sale.status} />
            </div>
            <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-card p-4 text-center sm:grid-cols-4">
              <Stat label="Total" value={formatMoney(numbers.total)} />
              <Stat label="Cobrado" value={formatMoney(numbers.paid)} tone="text-emerald-700 dark:text-emerald-400" />
              <Stat label="Saldo" value={formatMoney(numbers.balance)} tone={numbers.balance > 0 ? "text-amber-700 dark:text-amber-400" : undefined} />
              <Stat label="Próximo pago" value={numbers.nextDue ? formatDate(numbers.nextDue) : "—"} />
              {numbers.refunded > 0 && <Stat label="Reembolsado" value={formatMoney(numbers.refunded)} tone="text-purple-700 dark:text-purple-400" />}
            </dl>
            {cancelReason && <p role="status" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">Motivo: {cancelReason}</p>}
            {sale.plan_unbalanced && (
              <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                <span className="min-w-0 flex-1">El plan de pagos no cuadra con el precio final: lo programado más lo cobrado no suma {formatMoney(numbers.total)}.</span>
                {data.canManagePayments && !closed && (
                  <button type="button" onClick={() => setDialog("rebuild")} className="h-8 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground">Rearmar el plan</button>
                )}
              </div>
            )}
          </header>

          <Section title="Datos de la venta">
            <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              <Row label="Fecha de la venta" value={formatDate(sale.sale_date)} />
              <Row label="Inicio del servicio" value={formatDate(sale.service_starts_at)} />
              <Row label="Financiamiento" value={FINANCING_TYPE_LABELS[sale.financing_type as FinancingType] ?? sale.financing_type} />
              <Row label="Descuento" value={Number(sale.discount_amount) > 0 ? `${formatMoney(sale.discount_amount)}${sale.discount_reason ? ` · ${sale.discount_reason}` : ""}` : "Sin descuento"} />
              <Row label="Setter" value={sale.setter_id ? data.names[sale.setter_id] ?? "—" : "Sin asignar"} />
              <Row label="Vendedor" value={sale.vendedor_id ? data.names[sale.vendedor_id] ?? "—" : "Sin asignar"} />
              <Row label={`Atribución · ${ATTRIBUTION_TYPE_LABELS[sale.attribution_type as AttributionType] ?? sale.attribution_type}`} value={attributionLine} wide />
              <div className="flex items-start gap-2 sm:col-span-2">
                <dt className="w-28 shrink-0 text-muted-foreground sm:w-40">Agenda de origen</dt>
                <dd>
                  {data.booking ? (
                    <Link href={`/dashboard/agenda?agenda=${data.booking.id}`} className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
                      <Calendar className="h-3.5 w-3.5" aria-hidden /> {data.booking.title ?? "Agenda"} · {formatDate(data.booking.startAt)} <ExternalLink className="h-3 w-3" aria-hidden />
                    </Link>
                  ) : "Ninguna"}
                </dd>
              </div>
              {sale.notes && <Row label="Notas" value={sale.notes} wide />}
            </dl>
          </Section>

          <PaymentPlan
            saleId={sale.id}
            saleDate={sale.sale_date}
            payments={payments}
            finalAmount={numbers.total}
            isSubscription={isSubscription}
            saleStatus={sale.status}
            canManage={data.canManagePayments}
            enabledMethods={data.enabledMethods}
            today={data.today}
            timeZone={data.timeZone}
            names={data.names}
          />

          {contracts}

          <Section title="Historial">
            <Historial entityType="sale" entityId={sale.id} names={{ users: data.names }} timeZone={data.timeZone} />
          </Section>
        </div>
      </div>

      {dialog === "edit" && <SaleEditDialog sale={editable} contactName={contact?.name ?? "Contacto"} config={wizard} onClose={() => setDialog(null)} />}
      {dialog === "cancel" && <CancelDialog saleId={sale.id} kind="sale" hasCollected={hasCollected} onClose={() => setDialog(null)} />}
      {dialog === "subscription" && <CancelDialog saleId={sale.id} kind="subscription" hasCollected={false} onClose={() => setDialog(null)} />}
      {dialog === "rebuild" && <RebuildPlanDialog saleId={sale.id} finalAmount={numbers.total} paidAmount={numbers.paid} today={data.today} onClose={() => setDialog(null)} />}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-lg font-bold tabular-nums ${tone ?? ""}`}>{value}</dd>
    </div>
  );
}

function Row({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`flex items-start gap-2 ${wide ? "sm:col-span-2" : ""}`}>
      <dt className="w-28 shrink-0 text-muted-foreground sm:w-40">{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words">{value}</dd>
    </div>
  );
}

export function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-base font-semibold">{icon}{title}</h2>
      {children}
    </section>
  );
}
