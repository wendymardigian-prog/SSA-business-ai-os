"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { loadSalesTriggerOptions, type SalesTriggerOptions } from "@/lib/actions/sales-automation";
import { MEDIUMS, MEDIUM_LABELS, SOURCES, SOURCE_LABELS } from "@/lib/contacts/taxonomy";
import { ATTRIBUTION_TYPE_LABELS, ATTRIBUTION_TYPES, FINANCING_TYPE_LABELS, FINANCING_TYPES, PAYMENT_STATUS_LABELS, PAYMENT_STATUSES, PAYMENT_TYPE_LABELS, PAYMENT_TYPES, SALE_STATUS_LABELS, SALE_STATUSES } from "@/lib/sales/labels";
import { PAYMENT_METHODS } from "@/lib/sales/payment-methods";
import { describeSalesTrigger } from "@/lib/sales/automation/presets";
import { isRelativeSalesTrigger } from "@/lib/sales/automation/triggers";

/**
 * Los filtros de los seis triggers de Ventas dentro del panel del constructor de flujos (F37).
 * Todo se guarda PLANO en el nodo (`product_ids`, `to_status`, `offset_days`…): el publicador lo copia
 * tal cual a `triggers.config`. Vacío significa «cualquiera», nunca «ninguno».
 */

/** Todas las claves de filtro de Ventas: al cambiar de atajo se limpian para no arrastrar filtros viejos. */
export const SALES_FILTER_KEYS = [
  "product_ids", "variant_ids", "utm_sources", "utm_mediums", "utm_campaign_contains", "attribution_types", "vendedor_ids", "setter_ids",
  "financing_types", "min_amount", "max_amount", "from_status", "to_status", "reasons_contains", "payment_types", "payment_methods", "refund_scope",
  "min_delay_days", "offset_days", "at_time",
] as const;

const chip = (on: boolean) =>
  on
    ? "rounded-lg bg-emerald-500/15 px-2.5 py-1 text-xs text-emerald-600 dark:text-emerald-300"
    : "rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted";

const inputClass = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

type Option = { value: string; label: string };

interface FieldCtx {
  data: Record<string, unknown>;
  set: (key: string, value: unknown) => void;
  /** Ya llegaron las opciones (productos y equipo). */
  loaded: boolean;
}

function ChipsField({ ctx, label, field, items, hint }: { ctx: FieldCtx; label: string; field: string; items: Option[]; hint?: string }) {
  const selected = ((ctx.data[field] as string[] | undefined) ?? []).filter(Boolean);
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold text-foreground">{label}</label>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{ctx.loaded ? "No hay opciones todavía: vale para cualquiera." : "Cargando…"}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((o) => (
            <button key={o.value} type="button" onClick={() => ctx.set(field, toggle(selected, o.value))} className={chip(selected.includes(o.value))}>
              {o.label}
            </button>
          ))}
        </div>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">{hint ?? "Sin elegir nada, vale para cualquiera."}</p>
    </div>
  );
}

function TextField({ ctx, label, field, placeholder }: { ctx: FieldCtx; label: string; field: string; placeholder?: string }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold text-foreground">{label}</label>
      <input className={inputClass} value={(ctx.data[field] as string | undefined) ?? ""} placeholder={placeholder} onChange={(e) => ctx.set(field, e.target.value)} />
    </div>
  );
}

function NumField({ ctx, label, field, min, max, placeholder }: { ctx: FieldCtx; label: string; field: string; min?: number; max?: number; placeholder?: string }) {
  const value = ctx.data[field];
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold text-foreground">{label}</label>
      <input
        type="number"
        className={inputClass}
        min={min}
        max={max}
        placeholder={placeholder}
        value={value === undefined || value === null ? "" : String(value)}
        onChange={(e) => ctx.set(field, e.target.value === "" ? undefined : Number(e.target.value))}
      />
    </div>
  );
}

export function SalesTriggerPanel({ triggerType, data, onChange }: { triggerType: string; data: Record<string, unknown>; onChange: (data: Record<string, unknown>) => void }) {
  const [options, setOptions] = useState<SalesTriggerOptions | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadSalesTriggerOptions()
      .then((o) => { if (!cancelled) setOptions(o); })
      .catch(() => { if (!cancelled) setOptions({ products: [], members: [] }); });
    return () => { cancelled = true; };
  }, []);

  const list = (key: string): string[] => ((data[key] as string[] | undefined) ?? []).filter(Boolean);
  const set = (key: string, value: unknown) => {
    const next = { ...data };
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) delete next[key];
    else next[key] = value;
    onChange(next);
  };
  const ctx: FieldCtx = { data, set, loaded: options !== null };

  const productOptions: Option[] = useMemo(() => (options?.products ?? []).map((p) => ({ value: p.id, label: p.name })), [options]);
  const memberOptions: Option[] = useMemo(() => (options?.members ?? []).map((m) => ({ value: m.id, label: m.name })), [options]);

  const saleStatuses: Option[] = SALE_STATUSES.map((s) => ({ value: s, label: SALE_STATUS_LABELS[s] }));
  const paymentStatuses: Option[] = PAYMENT_STATUSES.filter((s) => s !== "refunded").map((s) => ({ value: s, label: PAYMENT_STATUS_LABELS[s] }));
  const paymentTypes: Option[] = PAYMENT_TYPES.map((t) => ({ value: t, label: PAYMENT_TYPE_LABELS[t] }));
  const methods: Option[] = PAYMENT_METHODS.map((m) => ({ value: m.key, label: m.name }));
  const sources: Option[] = SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] }));
  const mediums: Option[] = MEDIUMS.map((m) => ({ value: m, label: MEDIUM_LABELS[m] }));
  const relative = isRelativeSalesTrigger(triggerType);

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <p className="text-xs font-semibold text-foreground">{describeSalesTrigger(triggerType, data)}</p>

      {options === null && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Cargando…</div>
      )}

      {relative && (
        <div className="grid grid-cols-2 gap-3">
          <NumField ctx={ctx} label={triggerType === "payment_before_due" ? "Días antes" : "Días después"} field="offset_days" min={triggerType === "payment_before_due" ? 1 : 1} max={triggerType === "payment_before_due" ? 30 : 90} placeholder="3" />
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-foreground">A las</label>
            <input type="time" className={inputClass} value={(data.at_time as string | undefined) ?? "09:00"} onChange={(e) => set("at_time", e.target.value)} />
          </div>
          <p className="col-span-2 text-[11px] text-muted-foreground">
            La hora es la de la zona del negocio.{triggerType === "payment_after_due" ? " Solo se avisa si el pago sigue sin cobrarse." : ""} Si cambian la fecha del pago, el recordatorio se vuelve a agendar.
          </p>
        </div>
      )}

      {(triggerType === "sale_status_changed" || triggerType === "payment_status_changed") && (
        <>
          <ChipsField ctx={ctx} label="Desde el estado" field="from_status" items={triggerType === "sale_status_changed" ? saleStatuses : paymentStatuses} />
          <ChipsField ctx={ctx} label="Hacia el estado" field="to_status" items={triggerType === "sale_status_changed" ? saleStatuses : paymentStatuses} />
        </>
      )}

      {triggerType === "sale_created" && (
        <>
          <ChipsField ctx={ctx} label="Solo estos productos" field="product_ids" items={productOptions} />
          <ChipsField ctx={ctx} label="Financiamiento" field="financing_types" items={FINANCING_TYPES.map((f) => ({ value: f, label: FINANCING_TYPE_LABELS[f] }))} />
          <ChipsField ctx={ctx} label="Origen (source)" field="utm_sources" items={sources} />
          <ChipsField ctx={ctx} label="Medio (medium)" field="utm_mediums" items={mediums} />
          <TextField ctx={ctx} label="La campaña contiene" field="utm_campaign_contains" placeholder="octubre" />
          <ChipsField ctx={ctx} label="Tipo de atribución" field="attribution_types" items={ATTRIBUTION_TYPES.map((a) => ({ value: a, label: ATTRIBUTION_TYPE_LABELS[a] }))} />
          <ChipsField ctx={ctx} label="Vendedor" field="vendedor_ids" items={memberOptions} />
          <ChipsField ctx={ctx} label="Setter" field="setter_ids" items={memberOptions} />
          <div className="grid grid-cols-2 gap-3">
            <NumField ctx={ctx} label="Monto mínimo" field="min_amount" min={0} />
            <NumField ctx={ctx} label="Monto máximo" field="max_amount" min={0} />
          </div>
        </>
      )}

      {triggerType === "sale_status_changed" && (
        <>
          <ChipsField ctx={ctx} label="Solo estos productos" field="product_ids" items={productOptions} />
          <ChipsField ctx={ctx} label="Vendedor" field="vendedor_ids" items={memberOptions} />
          <ChipsField ctx={ctx} label="Origen (source)" field="utm_sources" items={sources} />
          <ChipsField ctx={ctx} label="Medio (medium)" field="utm_mediums" items={mediums} />
          <TextField ctx={ctx} label="La campaña contiene" field="utm_campaign_contains" placeholder="octubre" />
          <TextField ctx={ctx} label="El motivo de la cancelación contiene" field="reasons_contains" placeholder="arrepent" />
        </>
      )}

      {(triggerType === "payment_created" || triggerType === "payment_status_changed" || relative) && (
        <ChipsField ctx={ctx} label="Tipo de pago" field="payment_types" items={paymentTypes} />
      )}

      {(triggerType === "payment_created" || triggerType === "payment_status_changed") && (
        <ChipsField ctx={ctx} label="Método de pago" field="payment_methods" items={methods} />
      )}

      {triggerType === "payment_created" && list("payment_types").includes("refund") && (
        <ChipsField ctx={ctx} label="Alcance del reembolso" field="refund_scope" items={[{ value: "total", label: "Total" }, { value: "partial", label: "Parcial" }]} />
      )}

      {triggerType === "payment_status_changed" && (
        <div className="grid grid-cols-3 gap-3">
          <NumField ctx={ctx} label="Monto mínimo" field="min_amount" />
          <NumField ctx={ctx} label="Monto máximo" field="max_amount" />
          <NumField ctx={ctx} label="Atraso mínimo (días)" field="min_delay_days" />
        </div>
      )}

      {(triggerType === "payment_created" || triggerType === "payment_status_changed" || relative) && (
        <ChipsField ctx={ctx} label="Solo estos productos" field="product_ids" items={productOptions} />
      )}

      <p className="text-[11px] text-muted-foreground">
        Variables disponibles: {"{{sale.product_name}}"}, {"{{sale.final_amount}}"}, {"{{sale.balance}}"}, {"{{payment.amount}}"}, {"{{payment.due_date}}"}, {"{{payment.days_overdue}}"}, {"{{sale.utm_source}}"}…
        Un mismo cambio dispara el flujo una sola vez, aunque tenga dos triggers que coincidan.
      </p>
    </div>
  );
}
