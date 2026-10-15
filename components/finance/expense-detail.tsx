"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Copy, ExternalLink, FileImage, FileText, Loader2, Paperclip, Pencil } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Historial } from "@/components/historial/historial";
import { PayExpenseDialog, RevertExpenseDialog, VoidExpenseDialog } from "@/components/finance/expense-dialogs";
import { ExpenseForm, type EditableExpense } from "@/components/finance/expense-form";
import { FinanceTabs, ReadOnlyNote } from "@/components/finance/finance-tabs";
import { getExpenseReceiptUrl, removeExpenseReceipt, uploadExpenseReceipt } from "@/lib/actions/finance-expenses";
import { formatDateOnly } from "@/lib/dates";
import { CATEGORY_GROUP_LABELS, categoryName, findCategory, type ExpenseCategory } from "@/lib/finance/categories";
import { draftFromDuplicate } from "@/lib/finance/expense-form";
import { dueHint } from "@/lib/finance/expense-list";
import { EXPENSE_ACTION_LABELS, EXPENSE_STATUSES, allowedTransitions, expenseOriginLabel, isExpenseStatus } from "@/lib/finance/expense-status";
import { formatUsd } from "@/lib/finance/format";
import { expensesHref } from "@/lib/finance/expense-filters";
import { vendorLabel, type VendorLite } from "@/lib/finance/vendors";
import { amountClasses, driftNotice, expenseStatusClasses, formatCivilDate, receiptKind, receiptPickError, type OriginDescription } from "@/lib/finance/view";
import { toCents } from "@/lib/sales/money";

/**
 * La ficha de un gasto: el monto grande, su estado, los datos, el comprobante, de dónde salió, las acciones que
 * permite su estado (`allowedTransitions`) y su historial. Las acciones están en el encabezado en la computadora y
 * en una barra fija abajo en el celular. Quien solo puede ver no tiene botones.
 */
export interface ExpenseDetailRow {
  id: string;
  concept: string;
  vendor_id: string | null;
  category_key: string;
  amount: unknown;
  status: string;
  scheduled_date: string;
  paid_date: string | null;
  origin: string;
  recurring_expense_id: string | null;
  source_ref: unknown;
  auto_drift_amount: unknown;
  auto_drift_resolved_at: string | null;
  adjusts_expense_id: string | null;
  receipt_path: string | null;
  receipt_name: string | null;
  responsible_id: string | null;
  notes: string | null;
  void_reason: string | null;
  void_kind: string | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpenseDetailData {
  expense: ExpenseDetailRow;
  origin: OriginDescription;
  categories: ExpenseCategory[];
  vendors: VendorLite[];
  members: Array<{ id: string; name: string }>;
  timeZone: string;
  today: string;
  canManage: boolean;
}

type DialogKind = "pay" | "revert" | "void" | "edit" | "duplicate" | null;

export function ExpenseDetail({ data }: { data: ExpenseDetailData }) {
  const { expense: e, origin, categories, vendors, members, timeZone, today, canManage } = data;
  const [dialog, setDialog] = useState<DialogKind>(null);
  const transitions = canManage ? allowedTransitions(e) : [];
  const editAction = transitions.find((a) => a === "confirm_amount" || a === "edit_date" || a === "reschedule");
  const annulled = e.status === "anulado";
  const drift = driftNotice(e);
  const names = Object.fromEntries(members.map((m) => [m.id, m.name]));
  const category = findCategory(categories, e.category_key);
  const hint = dueHint(e.scheduled_date, today, e.status);
  const statusLabel = isExpenseStatus(e.status) ? EXPENSE_STATUSES[e.status].label : e.status;
  const editable: EditableExpense = {
    status: e.status, origin: e.origin, amount: e.amount, scheduled_date: e.scheduled_date, paid_date: e.paid_date, concept: e.concept,
    vendor_id: e.vendor_id, category_key: e.category_key, responsible_id: e.responsible_id, notes: e.notes,
    recurring_expense_id: e.recurring_expense_id, adjusts_expense_id: e.adjusts_expense_id, id: e.id, updated_at: e.updated_at, receipt_name: e.receipt_name,
  };

  const actions = canManage ? (
    <>
      {transitions.includes("pay") && (
        <ActionButton primary onClick={() => setDialog("pay")}>{EXPENSE_ACTION_LABELS.pay}</ActionButton>
      )}
      {!annulled && (
        <ActionButton onClick={() => setDialog("edit")} icon={<Pencil className="h-4 w-4" aria-hidden />}>{editAction ? EXPENSE_ACTION_LABELS[editAction] : "Editar"}</ActionButton>
      )}
      {transitions.includes("revert") && <ActionButton onClick={() => setDialog("revert")}>{EXPENSE_ACTION_LABELS.revert}</ActionButton>}
      <ActionButton onClick={() => setDialog("duplicate")} icon={<Copy className="h-4 w-4" aria-hidden />}>Duplicar</ActionButton>
      {transitions.includes("void") && <ActionButton danger onClick={() => setDialog("void")}>{EXPENSE_ACTION_LABELS.void}</ActionButton>}
    </>
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        route="/dashboard/finanzas/gastos/[id]"
        tabs={<FinanceTabs />}
        backHref={
          <Link href="/dashboard/finanzas/gastos" aria-label="Volver a Gastos" className="-ml-1 flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground">
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
          {!canManage && <ReadOnlyNote />}

          <header className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className={`text-lg font-semibold ${annulled ? "text-muted-foreground line-through" : ""}`}>{e.concept}</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">{e.vendor_id ? vendorLabel(vendors, e.vendor_id) : "Sin proveedor"}</p>
              </div>
              <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${expenseStatusClasses(e.status)}`}>{statusLabel}</span>
            </div>
            <p className={`text-3xl font-semibold tabular-nums ${amountClasses(e.amount)} ${annulled ? "line-through" : ""}`}>
              {e.status === "por_revisar" && toCents(e.amount) === 0 ? <span className="text-amber-700 dark:text-amber-300">Monto a confirmar</span> : formatUsd(toCents(e.amount))}
            </p>
            <dl className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
              <div className="flex gap-2"><dt className="text-muted-foreground">Fecha programada</dt><dd className="font-medium">{formatCivilDate(e.scheduled_date)}</dd></div>
              {hint && <div className={`text-xs ${e.status === "vencido" ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>{hint}</div>}
              {e.paid_date && <div className="flex gap-2"><dt className="text-muted-foreground">Fecha de pago</dt><dd className="font-medium">{formatCivilDate(e.paid_date)}</dd></div>}
            </dl>

            {annulled && (
              <p role="status" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
                <span className="font-medium">Anulado{e.voided_at ? ` el ${formatDateOnly(e.voided_at, timeZone)}` : ""}{e.void_kind === "auto_zero" ? " por el sistema" : ""}.</span>{" "}
                {e.void_reason && <span className="text-muted-foreground">Motivo: {e.void_reason}</span>}
              </p>
            )}
            {drift && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <div>
                  <p className="font-medium">{drift}</p>
                  <p className="text-xs">El gasto ya estaba pagado, así que no se tocó su monto.</p>
                </div>
              </div>
            )}

            {actions && <div className="hidden flex-wrap items-center gap-2 md:flex" role="group" aria-label="Acciones del gasto">{actions}</div>}
          </header>

          <Section title="Datos">
            <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              <Row label="Proveedor">
                {e.vendor_id ? (
                  <span className="flex flex-wrap items-center gap-x-2">
                    {vendorLabel(vendors, e.vendor_id)}
                    <Link href={expensesHref({ vendors: [e.vendor_id] })} className="text-xs text-primary underline-offset-2 hover:underline">Ver sus gastos</Link>
                  </span>
                ) : "Sin proveedor"}
              </Row>
              <Row label="Categoría">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: category?.color ?? "#78716c" }} aria-hidden />
                  {categoryName(categories, e.category_key)}
                  <span className="text-xs text-muted-foreground">· {CATEGORY_GROUP_LABELS[category?.group ?? "otro"]}</span>
                </span>
              </Row>
              <Row label="Responsable">{e.responsible_id ? (names[e.responsible_id] ?? "—") : "Sin responsable"}</Row>
              <Row label="Origen">{expenseOriginLabel(e.origin)}</Row>
              {e.notes && <Row label="Notas" wide><span className="whitespace-pre-wrap break-words">{e.notes}</span></Row>}
            </dl>
          </Section>

          <ReceiptSection expense={e} canManage={canManage && !annulled} />

          <Section title="De dónde salió">
            <p className="text-sm font-medium">{origin.title}</p>
            {origin.detail && <p className="mt-0.5 text-sm text-muted-foreground">{origin.detail}</p>}
            {origin.href && origin.linkLabel && (
              <Link href={origin.href} className="mt-1 inline-flex items-center gap-1 text-sm text-primary underline-offset-2 hover:underline">
                {origin.linkLabel} <ExternalLink className="h-3 w-3" aria-hidden />
              </Link>
            )}
          </Section>

          <Section title="Historial">
            <Historial key={e.updated_at} entityType="expense" entityId={e.id} names={{ users: names }} timeZone={timeZone} />
          </Section>
        </div>
      </div>

      {actions && (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-t border-border bg-background p-3 md:hidden" role="group" aria-label="Acciones del gasto">
          {actions}
        </div>
      )}

      {dialog === "pay" && <PayExpenseDialog expense={e} today={today} onClose={() => setDialog(null)} />}
      {dialog === "revert" && <RevertExpenseDialog expense={e} onClose={() => setDialog(null)} />}
      {dialog === "void" && <VoidExpenseDialog expense={e} onClose={() => setDialog(null)} />}
      {dialog === "edit" && <ExpenseForm mode="edit" expense={editable} categories={categories} vendors={vendors} members={members} today={today} onClose={() => setDialog(null)} />}
      {dialog === "duplicate" && (
        <ExpenseForm mode="create" initial={draftFromDuplicate(editable, today, categories)} categories={categories} vendors={vendors} members={members} today={today} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

function ActionButton({ children, onClick, primary, danger, icon }: { children: React.ReactNode; onClick: () => void; primary?: boolean; danger?: boolean; icon?: React.ReactNode }) {
  const tone = primary
    ? "bg-primary text-primary-foreground hover:opacity-90"
    : danger
      ? "border border-red-500/40 text-red-700 hover:bg-red-500/10 dark:text-red-400"
      : "border border-border hover:bg-accent";
  return (
    <button type="button" onClick={onClick} className={`inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium md:flex-none ${tone}`}>
      {icon} {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`flex items-start gap-2 ${wide ? "sm:col-span-2" : ""}`}>
      <dt className="w-28 shrink-0 text-muted-foreground sm:w-32">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

// ── Comprobante ─────────────────────────────────────────────────────────

function ReceiptSection({ expense, canManage }: { expense: ExpenseDetailRow; canManage: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState<"view" | "upload" | "remove" | null>(null);
  const [, start] = useTransition();
  const has = !!expense.receipt_path;
  const kind = receiptKind(expense.receipt_name);
  const Icon = kind === "image" ? FileImage : kind === "pdf" ? FileText : Paperclip;

  async function view() {
    setError(null);
    setBusy("view");
    // La pestaña se abre ya (con el clic) y recién después se le pone la dirección: un navegador no deja abrir una
    // pestaña después de esperar al servidor.
    const tab = window.open("about:blank", "_blank");
    const result = await getExpenseReceiptUrl(expense.id);
    setBusy(null);
    if (!result.ok) {
      tab?.close();
      return setError(result.error);
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = result.url;
    } else {
      window.open(result.url, "_blank", "noopener");
    }
  }

  async function upload(file: File) {
    setError(null);
    const pickError = receiptPickError(file);
    if (pickError) return setError(pickError);
    setBusy("upload");
    const fd = new FormData();
    fd.set("expenseId", expense.id);
    fd.set("file", file);
    const result = await uploadExpenseReceipt(fd);
    setBusy(null);
    if (fileRef.current) fileRef.current.value = "";
    if (!result.ok) return setError(result.error);
    start(() => router.refresh());
  }

  async function remove() {
    setError(null);
    setBusy("remove");
    const result = await removeExpenseReceipt(expense.id);
    setBusy(null);
    setConfirmRemove(false);
    if (!result.ok) return setError(result.error);
    start(() => router.refresh());
  }

  return (
    <Section title="Comprobante">
      {has ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><Icon className="h-5 w-5" aria-hidden /></span>
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{expense.receipt_name ?? "Comprobante"}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void view()} disabled={busy !== null} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-60">
              {busy === "view" && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Ver
            </button>
            {canManage && (
              <>
                <button type="button" onClick={() => fileRef.current?.click()} disabled={busy !== null} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-60">
                  {busy === "upload" && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Cambiar
                </button>
                {confirmRemove ? (
                  <span className="inline-flex items-center gap-1.5 text-sm">
                    ¿Quitarlo?
                    <button type="button" onClick={() => void remove()} disabled={busy !== null} className="h-8 rounded-lg bg-red-600 px-3 text-sm font-medium text-white disabled:opacity-60">Sí, quitar</button>
                    <button type="button" onClick={() => setConfirmRemove(false)} className="h-8 rounded-lg border border-border px-3 text-sm hover:bg-accent">No</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmRemove(true)} disabled={busy !== null} className="h-8 rounded-lg border border-border px-3 text-sm text-red-700 hover:bg-red-500/10 disabled:opacity-60 dark:text-red-400">Quitar</button>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">Este gasto no tiene comprobante.</p>
          {canManage && (
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy !== null} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-60">
              {busy === "upload" && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Subir comprobante
            </button>
          )}
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-label="Elegir el comprobante"
        accept="image/jpeg,image/png,image/webp,image/heic,application/pdf,.heic"
        onChange={(ev) => {
          const file = ev.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {has && canManage && <p className="mt-2 text-[11px] text-muted-foreground">Si lo cambiás, el archivo anterior queda guardado pero deja de mostrarse. Imagen o PDF, hasta 10 MB.</p>}
      {error && <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-400">{error}</p>}
    </Section>
  );
}
