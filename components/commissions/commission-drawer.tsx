"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ExternalLink, Loader2, X } from "lucide-react";
import { Drawer } from "@/components/content/drawer/drawer";
import { DialogField, fieldInput } from "@/components/content/dialog";
import { AdjustmentDialog } from "@/components/commissions/adjustment-dialog";
import { CommissionStatusChip, toneClasses } from "@/components/commissions/commission-chips";
import { Historial } from "@/components/historial/historial";
import { SaleModal } from "@/components/sales/sale-modal";
import { assignCommissionPerson, voidCommission } from "@/lib/actions/commissions";
import type { DescribeLookups } from "@/lib/commissions/describe";
import { allowedActions, attributionView, paymentLines, saleClosedChip, usedRuleText } from "@/lib/commissions/drawer-view";
import type { CommissionFilters } from "@/lib/commissions/filters";
import type { CommissionDetail } from "@/lib/commissions/list-load";
import { closeDrawerHref } from "@/lib/commissions/list-view";
import type { DrawerExtras } from "@/lib/commissions/screen-load";
import type { CommissionRole } from "@/lib/commissions/types";
import { formatDateOnly } from "@/lib/dates";
import { formatUsd } from "@/lib/finance/format";
import { formatCivilDate } from "@/lib/finance/view";
import { FINANCING_TYPE_LABELS, type FinancingType } from "@/lib/sales/labels";

/**
 * La ficha de una comisión (F61): un cajón que se abre con `?commission=<id>` en la URL (se comparte con un link y
 * «atrás» lo cierra). Muestra el monto y el estado, el pago, la venta, de dónde vino, la regla con la que se
 * calculó (una foto: si la regla cambió después, lo dice), el gasto y el historial. Las acciones (asignar persona,
 * anular, crear ajuste) solo existen con `commissions.manage` y según el estado.
 */
export interface CommissionDrawerProps {
  detail: CommissionDetail;
  extras: DrawerExtras;
  members: ReadonlyArray<{ id: string; name: string }>;
  roles: readonly CommissionRole[];
  lookups: DescribeLookups;
  filters: CommissionFilters;
  timeZone: string;
  /** Id de persona → nombre, para el historial. */
  names: Record<string, string>;
  can: { expenses: boolean; sales: boolean; content: boolean; ads: boolean };
}

type DialogKind = "assign" | "void" | "adjust" | null;

export function CommissionDrawer({ detail, extras, members, roles, lookups, filters, timeZone, names, can }: CommissionDrawerProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const close = () => router.replace(closeDrawerHref(filters), { scroll: false });
  const refresh = () => {
    setHistoryKey((k) => k + 1);
    router.refresh();
  };

  const d = detail;
  const actions = d.canManage ? allowedActions(d.status.key, !!d.expense) : { assign: false, void: false };
  const closedSale = saleClosedChip(extras.saleStatus);
  const attribution = attributionView(d.attribution.snapshot, d.attribution.touch);
  const ruleText = usedRuleText(d.rule.used, lookups);
  const pay = paymentLines({
    installment: extras.installment,
    paidOn: d.paidOn,
    methodName: extras.methodName ?? (d.payment?.method ?? null),
    collectedCents: d.payment?.amountCents ?? null,
    feeCents: d.payment?.feeCents ?? null,
    formatDate: formatCivilDate,
  });
  const title = d.kind === "adjustment" ? "Ajuste de comisión" : `Comisión${d.roleName ? ` · ${d.roleName}` : ""}`;
  const person = d.userName ?? (d.userId ? "Una persona" : "Sin persona");
  const footer = d.canManage ? (
    <>
      {actions.assign && <FooterButton onClick={() => setDialog("assign")}>Asignar persona</FooterButton>}
      <FooterButton onClick={() => setDialog("adjust")}>Crear ajuste</FooterButton>
      {actions.void && <FooterButton danger onClick={() => setDialog("void")}>Anular</FooterButton>}
    </>
  ) : undefined;

  const roleList = roles.map((r) => ({ key: r.key, name: r.name, active: r.active }));

  return (
    <>
      <Drawer
        size="idea"
        label={`${title} de ${person}`}
        onClose={close}
        header={
          <>
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
            <button type="button" onClick={close} aria-label="Cerrar la ficha" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </>
        }
        footer={footer}
      >
        <div className="space-y-5 p-4">
          <header className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CommissionStatusChip status={d.status} />
              {d.status.detail && <span className="text-xs text-muted-foreground">{d.status.detail}</span>}
              {closedSale && <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${toneClasses(closedSale.tone)}`}>{closedSale.label}</span>}
            </div>
            <p className={`text-3xl font-semibold tabular-nums ${d.amountCents < 0 ? "text-red-600 dark:text-red-400" : ""} ${d.status.key === "anulada" ? "text-muted-foreground line-through" : ""}`}>
              {formatUsd(d.amountCents)}
            </p>
            <p className="text-sm text-muted-foreground">
              {d.kind === "adjustment" ? "Ajuste para" : "Para"} <span className="font-medium text-foreground">{person}</span>
              {d.baseCents !== null && d.kind === "earned" && <> · sobre una base de {formatUsd(d.baseCents)}</>}
            </p>
            {d.status.key === "anulada" && (
              <p role="status" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
                <span className="font-medium">Anulada{d.voidedAt ? ` el ${formatDateOnly(d.voidedAt, timeZone)}` : ""}{d.voidedByName ? ` por ${d.voidedByName}` : ""}.</span>{" "}
                {d.voidReason && <span className="text-muted-foreground">Motivo: {d.voidReason}</span>}
              </p>
            )}
            {d.notes && (
              <p className="whitespace-pre-wrap break-words rounded-lg bg-muted/40 px-3 py-2 text-sm"><span className="font-medium">{d.kind === "adjustment" ? "Motivo: " : "Notas: "}</span>{d.notes}</p>
            )}
          </header>

          {d.payment && (
            <Section title="Pago">
              <Lines lines={pay} />
              {d.payment.type === "refund" && <p className="mt-2 text-xs text-muted-foreground">Este ajuste es por un reembolso.</p>}
            </Section>
          )}

          <Section title="Venta">
            {d.sale ? (
              <>
                <Lines
                  lines={[
                    { label: "Contacto", value: d.sale.contactName ?? "Sin nombre" },
                    { label: "Producto", value: [d.sale.productName, d.sale.variantName].filter(Boolean).join(" · ") || "—" },
                    { label: "Financiamiento", value: d.sale.financingType ? FINANCING_TYPE_LABELS[d.sale.financingType as FinancingType] ?? d.sale.financingType : "—" },
                    { label: "Fecha de la venta", value: formatCivilDate(d.sale.saleDate) },
                  ]}
                />
                {can.sales ? (
                  <Link href={`/dashboard/ventas/${d.sale.id}`} className="mt-2 inline-flex items-center gap-1 text-sm text-primary underline-offset-2 hover:underline">
                    Ver la venta <ExternalLink className="h-3 w-3" aria-hidden />
                  </Link>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{d.kind === "adjustment" ? "Este ajuste no está atado a una venta." : "No encontramos la venta de esta comisión."}</p>
            )}
          </Section>

          <Section title="De dónde vino">
            {attribution.empty ? (
              <p className="text-sm text-muted-foreground">Sin datos de origen: la persona llegó directo o no quedó registrado cómo.</p>
            ) : (
              <>
                <Lines
                  lines={[
                    ...(attribution.channelLabel ? [{ label: "Canal", value: attribution.channelLabel }] : []),
                    ...(attribution.source ? [{ label: "Fuente", value: attribution.source }] : []),
                    ...attribution.touch,
                  ]}
                />
                {attribution.piece && (
                  <p className="mt-2 text-sm">
                    <span className="text-muted-foreground">Pieza: </span>
                    {attribution.piece.id && can.content ? (
                      <Link href={`/dashboard/content?piece=${attribution.piece.id}`} className="text-primary underline-offset-2 hover:underline">{attribution.piece.title}</Link>
                    ) : (
                      attribution.piece.title
                    )}
                  </p>
                )}
                {attribution.ad && (
                  <p className="mt-1 text-sm">
                    <span className="text-muted-foreground">Anuncio: </span>
                    {attribution.ad.id && can.ads ? (
                      <Link href={`/dashboard/dashboards/ads/ads/${attribution.ad.id}`} className="text-primary underline-offset-2 hover:underline">{attribution.ad.name}</Link>
                    ) : (
                      attribution.ad.name
                    )}
                  </p>
                )}
              </>
            )}
          </Section>

          {d.kind === "earned" && (
            <Section title="Regla usada">
              {ruleText ? (
                <>
                  <p className="text-sm font-medium">{String(d.rule.used?.name ?? "Regla")}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{ruleText}</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No quedó guardada la regla de esta comisión.</p>
              )}
              {d.rule.comparison.changed && (
                <div role="status" className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <p>
                    <span className="font-medium">La regla cambió desde entonces</span> ({d.rule.comparison.fields.join(", ").toLowerCase()}). Esta comisión se calculó con la versión de arriba y no se recalcula.
                  </p>
                </div>
              )}
              {d.rule.comparison.archived && <p className="mt-2 text-xs text-muted-foreground">Esa regla está archivada: ya no se aplica a pagos nuevos.</p>}
              {d.canManage && (
                <Link href="/dashboard/finanzas/comisiones/reglas" className="mt-2 inline-flex items-center gap-1 text-sm text-primary underline-offset-2 hover:underline">
                  Ver las reglas <ExternalLink className="h-3 w-3" aria-hidden />
                </Link>
              )}
            </Section>
          )}

          <Section title="Gasto">
            {d.expense ? (
              <div className="space-y-1 text-sm">
                <p>
                  {d.status.key === "pagada" ? "Pagado" : d.expense.status === "programado" ? "Programado" : "En un gasto"}
                  {d.expense.paid_date ? ` el ${formatCivilDate(d.expense.paid_date)}` : d.expense.scheduled_date ? ` para el ${formatCivilDate(d.expense.scheduled_date)}` : ""}
                </p>
                {can.expenses && (
                  <Link href={`/dashboard/finanzas/gastos/${d.expense.expense_id}`} className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">
                    Ver el gasto <ExternalLink className="h-3 w-3" aria-hidden />
                  </Link>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {d.status.key === "anulada" ? "No está en ningún gasto." : d.status.key === "sin_persona" ? "Todavía no se puede pagar: falta asignarle una persona." : d.status.key === "retenida" ? "Todavía no se puede pagar: está retenida." : "Todavía no está en un gasto."}
              </p>
            )}
          </Section>

          <Section title="Historial">
            <Historial key={historyKey} entityType="commission" entityId={d.id} names={{ users: names }} timeZone={timeZone} />
          </Section>
        </div>
      </Drawer>

      {dialog === "assign" && <AssignDialog id={d.id} members={members} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === "void" && <VoidDialog id={d.id} amountCents={d.amountCents} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === "adjust" && (
        <AdjustmentDialog
          members={members}
          roles={roleList}
          seed={{
            userId: d.userId ?? undefined,
            saleId: d.sale?.id,
            saleLabel: d.sale ? `${d.sale.contactName ?? "Contacto"} · ${d.sale.productName ?? "Producto"}` : undefined,
            paymentId: d.payment?.id,
            paymentLabel: extras.installment ?? undefined,
            role: d.role,
          }}
          onClose={() => setDialog(null)}
          onDone={refresh}
        />
      )}
    </>
  );
}

function FooterButton({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-medium ${danger ? "border border-red-500/40 text-red-700 hover:bg-red-500/10 dark:text-red-400" : "border border-border hover:bg-accent"}`}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border p-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Lines({ lines }: { lines: ReadonlyArray<{ label: string; value: string }> }) {
  return (
    <dl className="space-y-1 text-sm">
      {lines.map((l) => (
        <div key={l.label} className="flex items-start gap-2">
          <dt className="w-36 shrink-0 text-muted-foreground">{l.label}</dt>
          <dd className="min-w-0 flex-1 break-words">{l.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── Asignar persona y anular ───────────────────────────────────────────

function DialogFooter({ error, pending, disabled, onClose, onSubmit, label, danger }: { error: string | null; pending: boolean; disabled?: boolean; onClose: () => void; onSubmit: () => void; label: string; danger?: boolean }) {
  return (
    <>
      {error && <p role="alert" className="mr-auto min-w-0 text-xs text-red-700 dark:text-red-400">{error}</p>}
      <div className="ml-auto flex gap-2">
        <button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">Cancelar</button>
        <button type="button" disabled={pending || disabled} onClick={onSubmit} className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-sm font-medium disabled:opacity-50 ${danger ? "bg-red-600 text-white" : "bg-primary text-primary-foreground"}`}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} {label}
        </button>
      </div>
    </>
  );
}

function AssignDialog({ id, members, onClose, onDone }: { id: string; members: ReadonlyArray<{ id: string; name: string }>; onClose: () => void; onDone: () => void }) {
  const [userId, setUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit() {
    setError(null);
    start(async () => {
      const res = await assignCommissionPerson(id, userId);
      if (!res.ok) return setError(res.error);
      onDone();
      onClose();
    });
  }
  return (
    <SaleModal
      title="Asignar persona"
      label="Asignar una persona a la comisión"
      onClose={onClose}
      footer={<DialogFooter error={error} pending={pending} disabled={!userId} onClose={onClose} onSubmit={submit} label="Asignar" />}
    >
      <p className="text-sm text-muted-foreground">La pieza que trajo la venta no tenía responsable. Elegí a quién le corresponde esta comisión: queda lista para pagarse.</p>
      <DialogField label="Persona">
        <select className={fieldInput} value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Elegí una persona</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </DialogField>
    </SaleModal>
  );
}

function VoidDialog({ id, amountCents, onClose, onDone }: { id: string; amountCents: number; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit() {
    setError(null);
    if (!reason.trim()) return setError("Contá por qué la anulás");
    start(async () => {
      const res = await voidCommission(id, reason);
      if (!res.ok) return setError(res.error);
      onDone();
      onClose();
    });
  }
  return (
    <SaleModal
      title="Anular la comisión"
      label="Anular la comisión"
      onClose={onClose}
      footer={<DialogFooter error={error} pending={pending} disabled={!reason.trim()} onClose={onClose} onSubmit={submit} label="Anular comisión" danger />}
    >
      <p className="text-sm text-muted-foreground">
        Anular una comisión de {formatUsd(amountCents)} la saca de las cuentas y no se puede volver atrás. Si había que pagar otra cosa, después podés cargar un ajuste.
      </p>
      <DialogField label="Motivo" hint={`${reason.length}/500`}>
        <textarea className={`${fieldInput} min-h-24`} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Por qué la anulás" />
      </DialogField>
    </SaleModal>
  );
}
