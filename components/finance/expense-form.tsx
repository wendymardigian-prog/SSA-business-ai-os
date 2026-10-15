"use client";

import { useId, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { createExpense, updateExpense, uploadExpenseReceipt } from "@/lib/actions/finance-expenses";
import { createVendor } from "@/lib/actions/finance-vendors";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { fieldInput } from "@/components/content/dialog";
import { VendorCombobox, type CreateVendorResult } from "@/components/finance/vendor-combobox";
import type { ExpenseCategory } from "@/lib/finance/categories";
import {
  emptyDraft, fieldLocks, isHighAmountCents, parseAmountText, toCreateInput, toUpdateInput, validateDraft, draftFromExpense, type DraftCheck, type ExpenseDraft,
} from "@/lib/finance/expense-form";
import type { ExpenseRowLite } from "@/lib/finance/expense-rules";
import { formatUsd } from "@/lib/finance/format";
import { selectableVendors, type VendorLite } from "@/lib/finance/vendors";
import { categoryOptionGroups, receiptPickError } from "@/lib/finance/view";

/**
 * El formulario de un gasto, en un panel lateral (pantalla completa en el celular). Sirve para el alta, para
 * duplicar (`initial`) y para editar (`expense`). Valida lo evidente acá; el servidor vuelve a validar todo con las
 * mismas reglas (`planCreateExpense`, `planUpdateExpense`). El comprobante se sube DESPUÉS de guardar el gasto, así
 * no quedan archivos de gastos que no existen; el botón queda deshabilitado mientras sube.
 */
export type EditableExpense = ExpenseRowLite & { id: string; updated_at: string; receipt_name?: string | null };

type FieldKey = Extract<DraftCheck, { ok: false }>["field"];

export function ExpenseForm({
  mode,
  categories,
  vendors,
  members,
  today,
  expense,
  initial,
  onClose,
}: {
  mode: "create" | "edit";
  categories: ExpenseCategory[];
  vendors: VendorLite[];
  members: Array<{ id: string; name: string }>;
  today: string;
  expense?: EditableExpense;
  /** Un borrador de partida (duplicar). */
  initial?: ExpenseDraft;
  onClose: () => void;
}) {
  const router = useRouter();
  const uid = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<ExpenseDraft>(() => initial ?? (expense ? draftFromExpense(expense, today) : emptyDraft(today, categories)));
  const [extraVendors, setExtraVendors] = useState<VendorLite[]>([]);
  const [fieldError, setFieldError] = useState<{ field: FieldKey; message: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; receiptError: string } | null>(null);
  const [pending, start] = useTransition();

  const locks = useMemo(() => (mode === "edit" ? fieldLocks(expense ?? null) : fieldLocks(null)), [mode, expense]);
  const allVendors = useMemo(() => selectableVendors([...vendors, ...extraVendors], expense?.vendor_id), [vendors, extraVendors, expense?.vendor_id]);
  const groups = useMemo(() => categoryOptionGroups(categories, expense?.category_key), [categories, expense?.category_key]);
  const isAdjustment = expense?.origin === "adjustment";
  const parsedAmount = parseAmountText(draft.amountText, { allowNegative: isAdjustment });
  const high = parsedAmount.kind === "ok" && isHighAmountCents(parsedAmount.cents);
  const set = (patch: Partial<ExpenseDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setFieldError(null);
  };
  const id = (name: string) => `${uid}-${name}`;
  const errorFor = (field: FieldKey) => (fieldError?.field === field ? fieldError.message : null);

  async function createInline(name: string): Promise<CreateVendorResult> {
    const result = await createVendor({ name });
    if (result.ok) {
      const vendor: VendorLite = { id: result.id, name: result.name, archived_at: null, user_id: null };
      setExtraVendors((list) => [...list, vendor]);
      return { ok: true, vendor };
    }
    const existing = result.existingId ? ([...vendors, ...extraVendors].find((v) => v.id === result.existingId) ?? null) : null;
    return { ok: false, error: result.error, existing };
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setFormError(null);
    const check = validateDraft(draft, { mode, todayLocal: today, categories, row: expense ?? null });
    if (!check.ok) {
      setFieldError({ field: check.field, message: check.error });
      document.getElementById(id(check.field))?.focus();
      return;
    }
    const chosen = fileRef.current?.files?.[0];
    const pickError = chosen ? receiptPickError(chosen) : null;
    if (pickError) return setFormError(pickError);

    start(async () => {
      let expenseId: string;
      if (mode === "create") {
        const result = await createExpense(toCreateInput(draft, check.amountCents));
        if (!result.ok) return setFormError(result.error);
        expenseId = result.id;
      } else if (expense) {
        const result = await updateExpense(expense.id, toUpdateInput(draft, check.amountCents, expense), expense.updated_at);
        if (!result.ok) return setFormError(result.error);
        expenseId = expense.id;
      } else {
        return setFormError("No encontré el gasto que estás editando");
      }
      let receiptError: string | null = null;
      if (chosen) {
        const fd = new FormData();
        fd.set("expenseId", expenseId);
        fd.set("file", chosen);
        const uploaded = await uploadExpenseReceipt(fd);
        if (!uploaded.ok) receiptError = uploaded.error;
      }
      router.refresh();
      if (receiptError) return setSaved({ id: expenseId, receiptError });
      onClose();
    });
  }

  const title = mode === "edit" ? "Editar gasto" : initial ? "Duplicar gasto" : "Nuevo gasto";

  if (saved) {
    return (
      <Sheet title={title} onClose={onClose}>
        <div className="space-y-3 p-4 text-sm">
          <p role="status">El gasto se guardó.</p>
          <p role="alert" className="text-xs text-red-700 dark:text-red-400">El comprobante no se subió: {saved.receiptError}. Podés subirlo de nuevo desde la ficha del gasto.</p>
          <div className="flex gap-2">
            <Link href={`/dashboard/finanzas/gastos/${saved.id}`} className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Abrir el gasto</Link>
            <button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">Cerrar</button>
          </div>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title={title} onClose={onClose}>
      <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-4 p-4">
          <Field label="Concepto" htmlFor={id("concept")} error={errorFor("concept")} hint={locks.conceptReason}>
            <input
              id={id("concept")}
              className={fieldInput}
              maxLength={200}
              value={draft.concept}
              disabled={locks.concept}
              onChange={(e) => set({ concept: e.target.value })}
              placeholder="Ej.: Factura de la agencia de diseño"
              aria-invalid={!!errorFor("concept")}
              autoFocus={false}
            />
          </Field>

          <Field label="Proveedor (opcional)" htmlFor={id("vendor")} hint={locks.vendorReason}>
            <VendorCombobox id={id("vendor")} vendors={allVendors} value={draft.vendorId} onChange={(vendorId) => set({ vendorId })} onCreate={createInline} disabled={locks.vendor} />
          </Field>

          <Field label="Categoría" htmlFor={id("category")} error={errorFor("category")}>
            <select id={id("category")} className={fieldInput} value={draft.categoryKey} onChange={(e) => set({ categoryKey: e.target.value })} aria-invalid={!!errorFor("category")}>
              {groups.map((g) => (
                <optgroup key={g.group} label={g.label}>
                  {g.options.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>

          <div className="space-y-2">
            <Field
              label="Monto (USD)"
              htmlFor={id("amount")}
              error={errorFor("amount")}
              hint={
                locks.amountReason ??
                (expense?.status === "por_revisar" ? "Este gasto está por revisar: al guardarlo con un monto queda confirmado." : null)
              }
            >
              <input
                id={id("amount")}
                className={`${fieldInput} tabular-nums`}
                inputMode="decimal"
                value={draft.amountToConfirm ? "" : draft.amountText}
                disabled={locks.amount || draft.amountToConfirm}
                onChange={(e) => set({ amountText: e.target.value })}
                placeholder={draft.amountToConfirm ? "A confirmar" : "0,00"}
                aria-invalid={!!errorFor("amount")}
              />
            </Field>
            {parsedAmount.kind === "ok" && !draft.amountToConfirm && !locks.amount && (
              <p className="text-xs text-muted-foreground" aria-live="polite">Se guarda como {formatUsd(parsedAmount.cents)}</p>
            )}
            {high && !locks.amount && (
              <p role="status" className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /> ¿Seguro? Es un monto muy alto.
              </p>
            )}
            {mode === "create" && (
              <div className="flex items-center gap-2">
                <Switch
                  label="Monto a confirmar"
                  checked={draft.amountToConfirm}
                  onChange={(v) => set({ amountToConfirm: v, paid: v ? false : draft.paid, amountText: v ? "" : draft.amountText })}
                />
                <span className="text-sm">Monto a confirmar</span>
                <span className="text-xs text-muted-foreground">(queda «Por revisar» hasta que lo cargues)</span>
              </div>
            )}
          </div>

          <Field label="Fecha programada" htmlFor={id("date")} error={errorFor("date")} hint={locks.dateReason}>
            <input id={id("date")} type="date" className={fieldInput} value={draft.scheduledDate} disabled={locks.scheduledDate} onChange={(e) => set({ scheduledDate: e.target.value })} aria-invalid={!!errorFor("date")} />
          </Field>

          <Field label="Responsable (opcional)" htmlFor={id("responsible")}>
            <select id={id("responsible")} className={fieldInput} value={draft.responsibleId ?? ""} onChange={(e) => set({ responsibleId: e.target.value || null })}>
              <option value="">Sin responsable</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>

          <Field label="Notas (opcional)" htmlFor={id("notes")} hint={`${draft.notes.length}/2000`}>
            <textarea id={id("notes")} className={`${fieldInput} min-h-20`} maxLength={2000} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>

          {mode === "create" && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <Switch label="Ya está pagado" checked={draft.paid} onChange={(v) => set({ paid: v, amountToConfirm: v ? false : draft.amountToConfirm })} />
                <span className="text-sm">Ya está pagado</span>
              </div>
              {draft.paid && (
                <Field label="Fecha de pago" htmlFor={id("paidDate")} error={errorFor("paidDate")}>
                  <input id={id("paidDate")} type="date" max={today} className={fieldInput} value={draft.paidDate} onChange={(e) => set({ paidDate: e.target.value })} aria-invalid={!!errorFor("paidDate")} />
                </Field>
              )}
            </div>
          )}

          <Field
            label="Comprobante (opcional)"
            htmlFor={id("receipt")}
            hint={`Imagen o PDF, hasta 10 MB. Se sube después de guardar el gasto.${expense?.receipt_name ? ` Hoy tiene «${expense.receipt_name}»: si elegís otro, lo reemplaza.` : ""}`}
          >
            <input
              id={id("receipt")}
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,application/pdf,.heic"
              className="block w-full text-sm file:mr-3 file:h-8 file:rounded-lg file:border file:border-border file:bg-background file:px-3 file:text-sm"
            />
          </Field>
        </div>

        <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-border bg-background p-3">
          {formError && <p role="alert" className="mr-auto min-w-0 flex-1 text-xs text-red-700 dark:text-red-400">{formError}</p>}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">Cancelar</button>
            <button type="submit" disabled={pending} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {pending ? "Guardando…" : mode === "edit" ? "Guardar cambios" : "Guardar gasto"}
            </button>
          </div>
        </div>
      </form>
    </Sheet>
  );
}

function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor: string; error?: string | null; hint?: string | null; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="text-xs font-medium">{label}</label>
      {children}
      {error ? <p role="alert" className="text-[11px] text-red-700 dark:text-red-400">{error}</p> : hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
