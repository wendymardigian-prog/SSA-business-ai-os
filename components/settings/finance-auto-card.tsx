"use client";

import { useId, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { runFinanceDailyNow, saveAutoExpenseSettings } from "@/lib/actions/finance-auto";
import { Switch } from "@/components/ui/switch";
import { fieldInput } from "@/components/content/dialog";
import {
  autoCloseDaysError, changedInputs, isAutoDirty, type AutoRowView, type AutoSectionId, type FinanceAutoData,
} from "@/lib/finance/auto-card";
import { categoryName, type ExpenseCategory } from "@/lib/finance/categories";
import { categoryOptionGroups } from "@/lib/finance/view";
import type { ChargeMode } from "@/lib/finance/settings";

/**
 * Ajustes > General > Finanzas > «Gastos automáticos»: las comisiones de cada procesador de pagos, la pauta de Meta y
 * a los cuántos días se cierra un mes. Encender un automático NO genera nada al instante: lo hace el trabajo
 * diario, y «Calcular ahora» lo adelanta. Sin `expenses.manage` esta sección no se muestra (la página de Ajustes ya lo
 * pide); `canManage` queda por si se reusa en una pantalla de solo lectura.
 */
const DEFAULT_CATEGORY: Record<AutoSectionId, string> = { processor_fees: "processor_fees", meta_ads: "ads_meta" };

type Status = { kind: "ok" | "error"; text: string } | null;

export function FinanceAutoCard({
  data,
  categories,
  canManage = true,
}: {
  data: FinanceAutoData;
  categories: ExpenseCategory[];
  canManage?: boolean;
}) {
  const router = useRouter();
  const [processor, setProcessor] = useState<AutoRowView[]>(data.processorRows);
  const [meta, setMeta] = useState<AutoRowView[]>(data.metaRows);
  const [days, setDays] = useState(String(data.autoCloseDays));
  const [baseline, setBaseline] = useState({ processor: data.processorRows, meta: data.metaRows, days: String(data.autoCloseDays) });
  const [status, setStatus] = useState<Status>(null);
  const [saving, startSave] = useTransition();
  const [running, startRun] = useTransition();

  const dirty = isAutoDirty({ processor, meta, days }, baseline);

  // Cuando el servidor manda datos nuevos (por ejemplo, después de guardar, con el proveedor que se creó solo), se
  // toman, salvo que la persona esté en medio de un cambio: lo que escribió no se pisa.
  const [seen, setSeen] = useState(data);
  if (data !== seen) {
    setSeen(data);
    if (!dirty) {
      setProcessor(data.processorRows);
      setMeta(data.metaRows);
      setDays(String(data.autoCloseDays));
      setBaseline({ processor: data.processorRows, meta: data.metaRows, days: String(data.autoCloseDays) });
    }
  }
  const daysError = autoCloseDaysError(days);

  function save() {
    if (daysError) return setStatus({ kind: "error", text: daysError });
    startSave(async () => {
      const result = await saveAutoExpenseSettings({
        processorFees: changedInputs(processor, baseline.processor),
        metaAds: changedInputs(meta, baseline.meta),
        autoCloseDays: Number(days),
      });
      if (!result.ok) return setStatus({ kind: "error", text: result.error });
      setBaseline({ processor, meta, days });
      setStatus({ kind: "ok", text: "Guardamos los gastos automáticos. No se genera nada al instante: lo hace el trabajo diario, o podés usar «Calcular ahora»." });
      router.refresh();
    });
  }

  function runNow() {
    setStatus(null);
    startRun(async () => {
      const result = await runFinanceDailyNow();
      if (!result.ok) return setStatus({ kind: "error", text: result.error });
      setStatus({
        kind: "ok",
        text: result.queued
          ? "Listo: el cálculo quedó en cola y se hace en un momento. Fijate en Gastos en un rato."
          : "Ya hay un cálculo en espera. No hace falta pedirlo de nuevo.",
      });
    });
  }

  return (
    <fieldset className="mt-8" disabled={!canManage}>
      <legend className="text-xs font-medium text-muted-foreground">Gastos automáticos</legend>
      <p className="mt-1 text-[11px] text-muted-foreground">
        El sistema crea solo los gastos de las comisiones de tus procesadores de pago y de la pauta de Meta. Encender uno no genera nada al instante: lo hace el trabajo diario. «Calcular ahora» lo adelanta. Apagar uno no borra los gastos que ya se crearon.
      </p>

      <div className="mt-4 space-y-6">
        <Section title="Comisiones de procesadores" hint="Una fila por método de pago. El monto sale de lo que cobraste en el mes, con la comisión que cargaste en Ventas.">
          {processor.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay métodos de pago. Cargalos en Ajustes → Ventas y cobranza.</p>
          ) : (
            processor.map((row) => (
              <AutoRow
                key={row.key}
                section="processor_fees"
                row={row}
                categories={categories}
                vendors={data.vendors}
                onChange={(next) => setProcessor((rows) => rows.map((r) => (r.key === row.key ? next : r)))}
              />
            ))
          )}
        </Section>

        <Section title="Pauta de Meta" hint="Una fila por cuenta publicitaria. El monto sale de lo que gastaste en anuncios, día por día.">
          {data.metaFailed ? (
            <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">No pudimos leer las cuentas de Meta. Recargá la página para volver a intentarlo.</p>
          ) : meta.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay cuentas publicitarias de Meta conectadas.{" "}
              <Link href="/dashboard/settings/integrations" className="font-medium text-primary underline-offset-2 hover:underline">Conectá Meta en Integraciones</Link>{" "}
              para automatizar la pauta.
            </p>
          ) : (
            meta.map((row) => (
              <AutoRow
                key={row.key}
                section="meta_ads"
                row={row}
                categories={categories}
                vendors={data.vendors}
                onChange={(next) => setMeta((rows) => rows.map((r) => (r.key === row.key ? next : r)))}
              />
            ))
          )}
        </Section>

        <Section title="Cierre del mes" hint="Cuando pasan estos días desde que termina un mes, el sistema lo cierra solo y los automáticos de ese mes dejan de cambiar. 0 = el mismo día que termina.">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="finance-auto-close" className="text-sm">Cerrar automáticamente a los</label>
            <input
              id="finance-auto-close"
              inputMode="numeric"
              value={days}
              onChange={(e) => {
                setDays(e.target.value);
                setStatus(null);
              }}
              aria-invalid={!!daysError}
              aria-describedby={daysError ? "finance-auto-close-error" : undefined}
              className={`${fieldInput} w-20 tabular-nums`}
            />
            <span className="text-sm">días de terminado el mes</span>
          </div>
          {daysError && <p id="finance-auto-close-error" role="alert" className="text-[11px] text-red-700 dark:text-red-400">{daysError}</p>}
        </Section>
      </div>

      {canManage && (
        <div className="mt-5 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving || !dirty || !!daysError}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Guardar
            </button>
            <button
              type="button"
              onClick={runNow}
              disabled={running || dirty}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-60"
            >
              {running && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Calcular ahora
            </button>
            {dirty && <span className="text-[11px] text-muted-foreground">Guardá los cambios antes de calcular.</span>}
          </div>
          {status && (
            <p role={status.kind === "error" ? "alert" : "status"} className={`text-xs ${status.kind === "error" ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>
              {status.text}
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

const CHARGE_OPTIONS: Array<{ value: ChargeMode; label: string }> = [
  { value: "automatic", label: "Se descuenta solo" },
  { value: "manual", label: "Se paga a mano" },
];

function AutoRow({
  section, row, categories, vendors, onChange,
}: {
  section: AutoSectionId;
  row: AutoRowView;
  categories: ExpenseCategory[];
  vendors: Array<{ id: string; name: string }>;
  onChange: (row: AutoRowView) => void;
}) {
  const uid = useId();
  const groups = useMemo(() => categoryOptionGroups(categories, row.categoryKey), [categories, row.categoryKey]);
  const defaultCategory = categoryName(categories, DEFAULT_CATEGORY[section]);
  const noteId = `${uid}-note`;
  const reason = row.lockedReason ?? row.note;
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start gap-3">
        <Switch label={`Automático para ${row.name}`} checked={row.enabled} disabled={row.locked} describedBy={reason ? noteId : undefined} onChange={(enabled) => onChange({ ...row, enabled })} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{row.name}</p>
          {reason && <p id={noteId} className={`text-[11px] ${row.locked ? "text-muted-foreground" : "text-amber-700 dark:text-amber-300"}`}>{reason}</p>}
        </div>
      </div>

      {row.enabled && (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label htmlFor={`${uid}-mode`} className="block text-xs font-medium">Cómo se cobra</label>
            <select id={`${uid}-mode`} className={fieldInput} value={row.chargeMode} onChange={(e) => onChange({ ...row, chargeMode: e.target.value as ChargeMode })}>
              {CHARGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor={`${uid}-category`} className="block text-xs font-medium">Categoría</label>
            <select id={`${uid}-category`} className={fieldInput} value={row.categoryKey ?? ""} onChange={(e) => onChange({ ...row, categoryKey: e.target.value || null })}>
              <option value="">Por defecto ({defaultCategory})</option>
              {groups.map((g) => (
                <optgroup key={g.group} label={g.label}>
                  {g.options.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor={`${uid}-vendor`} className="block text-xs font-medium">Proveedor</label>
            <select id={`${uid}-vendor`} className={fieldInput} value={row.vendorId ?? ""} onChange={(e) => onChange({ ...row, vendorId: e.target.value || null })}>
              <option value="">Automático: «{row.vendorDefaultName}»</option>
              {row.vendorId && !vendors.some((v) => v.id === row.vendorId) && <option value={row.vendorId}>Proveedor archivado</option>}
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
