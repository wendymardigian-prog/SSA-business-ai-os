"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { SaleModal } from "@/components/sales/sale-modal";
import { fieldInput } from "@/components/content/dialog";
import { VendorCombobox, type CreateVendorResult } from "@/components/finance/vendor-combobox";
import { createRecurringTemplate, updateRecurringTemplate } from "@/lib/actions/finance-recurring";
import { createVendor } from "@/lib/actions/finance-vendors";
import type { ExpenseCategory } from "@/lib/finance/categories";
import { LEAD_DAYS_MAX } from "@/lib/finance/recurring";
import { buildRecurringInput, previewPaymentDates, recurringDraftError, type RecurringDraft } from "@/lib/finance/recurring-form";
import { selectableVendors, type VendorLite } from "@/lib/finance/vendors";
import { categoryOptionGroups, formatCivilDate } from "@/lib/finance/view";

const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const FREQUENCIES: Array<{ value: RecurringDraft["frequency"]; label: string }> = [
  { value: "weekly", label: "Semanal" },
  { value: "biweekly", label: "Quincenal" },
  { value: "monthly", label: "Mensual" },
  { value: "yearly", label: "Anual" },
];

/**
 * Crear o editar una plantilla de gasto recurrente. Valida lo evidente con la MISMA función que el servidor
 * (`normalizeTemplate`) y muestra las próximas tres fechas de pago antes de guardar. Si el cambio reinicia el
 * anclaje (cambia la regla de fechas o la anticipación) lo avisa: los gastos ya creados no se tocan.
 */
export function RecurringFormDialog({
  initial,
  categories,
  vendors,
  members,
  today,
  onClose,
}: {
  initial: RecurringDraft;
  categories: ExpenseCategory[];
  vendors: VendorLite[];
  members: Array<{ id: string; name: string }>;
  today: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const editing = !!initial.id;
  const [draft, setDraft] = useState<RecurringDraft>(initial);
  const [extraVendors, setExtraVendors] = useState<VendorLite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [anchorNotice, setAnchorNotice] = useState(false);
  const [pending, start] = useTransition();

  const allVendors = useMemo(() => selectableVendors([...vendors, ...extraVendors], initial.vendorId), [vendors, extraVendors, initial.vendorId]);
  const groups = useMemo(() => categoryOptionGroups(categories, initial.categoryKey), [categories, initial.categoryKey]);
  const preview = useMemo(() => previewPaymentDates(draft, today, 3), [draft, today]);
  const set = (patch: Partial<RecurringDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setError(null);
  };

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
    const invalid = recurringDraftError(draft, today);
    if (invalid) return setError(invalid);
    const built = buildRecurringInput(draft);
    if (!built.ok) return setError(built.error);
    start(async () => {
      if (draft.id) {
        const result = await updateRecurringTemplate(draft.id, built.input, draft.updatedAt ?? null);
        if (!result.ok) return setError(result.error);
        router.refresh();
        if (result.anchorReset) return setAnchorNotice(true);
        return onClose();
      }
      const result = await createRecurringTemplate(built.input);
      if (!result.ok) return setError(result.error);
      router.refresh();
      onClose();
    });
  }

  const title = editing ? "Editar gasto recurrente" : "Nuevo gasto recurrente";

  if (anchorNotice) {
    return (
      <SaleModal
        title={title}
        label={title}
        onClose={onClose}
        footer={<button type="button" onClick={onClose} className="ml-auto h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Entendido</button>}
      >
        <p role="status" className="text-sm font-medium">Los cambios se guardaron.</p>
        <p className="text-sm text-muted-foreground">Los gastos que ya se crearon no cambian; los nuevos salen con la regla nueva desde hoy.</p>
      </SaleModal>
    );
  }

  return (
    <SaleModal
      title={title}
      label={title}
      onClose={onClose}
      footer={
        <>
          {error && <p role="alert" className="mr-auto min-w-0 flex-1 text-xs text-red-700 dark:text-red-400">{error}</p>}
          <button type="button" onClick={onClose} className="ml-auto h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">Cancelar</button>
          <button type="submit" form={id("form")} disabled={pending} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {pending ? "Guardando…" : editing ? "Guardar cambios" : "Crear plantilla"}
          </button>
        </>
      }
    >
      <form id={id("form")} onSubmit={submit} noValidate className="space-y-4">
        <Field label="Concepto" htmlFor={id("concept")}>
          <input id={id("concept")} className={fieldInput} maxLength={200} value={draft.concept} onChange={(e) => set({ concept: e.target.value })} placeholder="Ej.: Google Workspace" />
        </Field>

        <Field label="Proveedor (opcional)" htmlFor={id("vendor")}>
          <VendorCombobox id={id("vendor")} vendors={allVendors} value={draft.vendorId} onChange={(vendorId) => set({ vendorId })} onCreate={createInline} />
        </Field>

        <Field label="Categoría" htmlFor={id("category")}>
          <select id={id("category")} className={fieldInput} value={draft.categoryKey} onChange={(e) => set({ categoryKey: e.target.value })}>
            {groups.map((g) => (
              <optgroup key={g.group} label={g.label}>
                {g.options.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>

        <Choice
          legend="Monto"
          name={id("amountType")}
          value={draft.amountType}
          onChange={(amountType) => set({ amountType })}
          options={[
            { value: "fixed", label: "Fijo" },
            { value: "variable", label: "Variable" },
          ]}
          hint={draft.amountType === "variable" ? "Cada vez que toca, el gasto se crea «Por revisar» y cargás el monto real." : undefined}
        />
        <Field label={draft.amountType === "variable" ? "Monto estimado en USD (opcional)" : "Monto en USD"} htmlFor={id("amount")} hint={draft.amountType === "variable" ? "Solo sirve para calcular cuánto equivale por mes." : undefined}>
          <input id={id("amount")} className={`${fieldInput} tabular-nums`} inputMode="decimal" value={draft.amountText} onChange={(e) => set({ amountText: e.target.value })} placeholder="0,00" />
        </Field>

        <Choice
          legend="Cobro"
          name={id("chargeMode")}
          value={draft.chargeMode}
          onChange={(chargeMode) => set({ chargeMode })}
          options={[
            { value: "automatic", label: "Débito automático" },
            { value: "manual", label: "Lo pago a mano" },
          ]}
          hint={
            draft.chargeMode === "automatic"
              ? "El gasto se crea el día del cobro y queda pagado solo."
              : "El gasto se crea programado y lo marcás como pagado cuando lo pagás."
          }
        />
        {draft.chargeMode === "manual" && (
          <Field label="Crear con anticipación (días)" htmlFor={id("lead")} hint={`De 0 a ${LEAD_DAYS_MAX}. Con 5, el gasto aparece 5 días antes de la fecha de pago.`}>
            <input id={id("lead")} className={`${fieldInput} w-28 tabular-nums`} inputMode="numeric" value={draft.leadDays} onChange={(e) => set({ leadDays: e.target.value })} />
          </Field>
        )}

        <div className="space-y-3 rounded-lg border border-border p-3">
          <Field label="Frecuencia" htmlFor={id("frequency")}>
            <select id={id("frequency")} className={fieldInput} value={draft.frequency} onChange={(e) => set({ frequency: e.target.value as RecurringDraft["frequency"] })}>
              {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </Field>
          {draft.frequency === "weekly" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Día de la semana" htmlFor={id("weeklyDay")}>
                <select id={id("weeklyDay")} className={fieldInput} value={draft.weeklyDay} onChange={(e) => set({ weeklyDay: Number(e.target.value) })}>
                  {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </Field>
              <Field label="Cada cuántas semanas" htmlFor={id("weeklyInterval")} hint="1 = todas las semanas.">
                <input id={id("weeklyInterval")} className={`${fieldInput} tabular-nums`} inputMode="numeric" value={draft.weeklyInterval} onChange={(e) => set({ weeklyInterval: e.target.value })} />
              </Field>
            </div>
          )}
          {draft.frequency === "biweekly" && <p className="text-sm text-muted-foreground">Se paga el 15 y el último día de cada mes.</p>}
          {draft.frequency === "monthly" && (
            <Field label="Día del mes" htmlFor={id("monthlyDay")} hint="Del 1 al 31. En los meses más cortos se usa el último día.">
              <input id={id("monthlyDay")} className={`${fieldInput} w-28 tabular-nums`} inputMode="numeric" value={draft.monthlyDay} onChange={(e) => set({ monthlyDay: e.target.value })} />
            </Field>
          )}
          {draft.frequency === "yearly" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Mes" htmlFor={id("yearlyMonth")}>
                <select id={id("yearlyMonth")} className={fieldInput} value={draft.yearlyMonth} onChange={(e) => set({ yearlyMonth: Number(e.target.value) })}>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </Field>
              <Field label="Día" htmlFor={id("yearlyDay")}>
                <input id={id("yearlyDay")} className={`${fieldInput} tabular-nums`} inputMode="numeric" value={draft.yearlyDay} onChange={(e) => set({ yearlyDay: e.target.value })} />
              </Field>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Empieza el" htmlFor={id("start")}>
              <input id={id("start")} type="date" className={fieldInput} value={draft.startDate} onChange={(e) => set({ startDate: e.target.value })} />
            </Field>
            <Field label="Termina el (opcional)" htmlFor={id("end")}>
              <input id={id("end")} type="date" className={fieldInput} value={draft.endDate} onChange={(e) => set({ endDate: e.target.value })} />
            </Field>
          </div>

          <div aria-live="polite">
            <p className="text-xs font-medium">Próximas fechas de pago</p>
            {preview.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">Completá la frecuencia y las fechas para ver cuándo se paga.</p>
            ) : (
              <ul className="mt-1 space-y-0.5 text-sm">
                {preview.map((p) => (
                  <li key={p.date}>
                    <span className="font-medium">{formatCivilDate(p.date)}</span>
                    {p.createdOn && <span className="text-xs text-muted-foreground"> · el gasto se crea el {formatCivilDate(p.createdOn)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <Field label="Responsable (opcional)" htmlFor={id("responsible")}>
          <select id={id("responsible")} className={fieldInput} value={draft.responsibleId ?? ""} onChange={(e) => set({ responsibleId: e.target.value || null })}>
            <option value="">Sin responsable</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>

        <Field label="Notas (opcional)" htmlFor={id("notes")} hint={`${draft.notes.length}/2000`}>
          <textarea id={id("notes")} className={`${fieldInput} min-h-20`} maxLength={2000} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
        </Field>

        {editing && <p className="text-[11px] text-muted-foreground">Si cambiás la frecuencia, las fechas o la anticipación, los gastos que ya se crearon no cambian: los nuevos salen con la regla nueva desde hoy.</p>}
      </form>
    </SaleModal>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-xs font-medium">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Choice<T extends string>({
  legend, name, value, onChange, options, hint,
}: {
  legend: string;
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  hint?: string;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm focus-within:ring-2 focus-within:ring-ring ${value === o.value ? "border-primary bg-primary/10 font-medium text-primary" : "border-border hover:bg-accent"}`}
          >
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
            {o.label}
          </label>
        ))}
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </fieldset>
  );
}
