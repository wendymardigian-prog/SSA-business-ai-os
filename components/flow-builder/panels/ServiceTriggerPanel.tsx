// @plantilla-quitar(servicios)
"use client";

import { SERVICE_TRIGGER_TYPES, type ServiceTriggerConfig } from "@/lib/services/automation";
import { serviceTriggerFilters } from "@/lib/services/service-picker";
import { ServiceKeySelect, ServiceVariantSelect } from "./service-key-select";
import { useServicePicker } from "./use-service-picker";

const inputClass = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring";
const labelClass = "mb-2 block text-xs font-semibold text-foreground";
const hintClass = "mt-1 text-[11px] text-muted-foreground";

export const isServiceTrigger = (t: string) => (SERVICE_TRIGGER_TYPES as readonly string[]).includes(t);

/**
 * Los filtros de los disparadores de Servicios (F122): producto › variante (o cualquiera) y, segun el disparador, la
 * fase o el paso con su nombre, o los dias antes del fin. Un filtro vacio deja pasar todo (`serviceEventMatches`). Se
 * escriben en el nodo y, si el nodo trae su `config` (lo arma el Camino del cliente), tambien ahi: lo de `config` gana
 * al publicar.
 */
export function ServiceTriggerPanel({ triggerType, data, onChange }: { triggerType: string; data: Record<string, unknown>; onChange: (data: Record<string, unknown>) => void }) {
  const picker = useServicePicker();
  const nodeConfig = (data.config && typeof data.config === "object" ? data.config : null) as Record<string, unknown> | null;
  const c = { ...data, ...(nodeConfig ?? {}) } as ServiceTriggerConfig & Record<string, unknown>;
  const fields = serviceTriggerFilters(triggerType);
  const set = (patch: Partial<ServiceTriggerConfig>) => {
    const next: Record<string, unknown> = { ...data, ...patch };
    if (nodeConfig) next.config = { ...nodeConfig, ...patch };
    onChange(next);
  };
  const products = picker?.products ?? [];

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="svt-product" className={labelClass}>De qué producto</label>
        <select id="svt-product" value={c.product_id ?? ""} onChange={(e) => set({ product_id: e.target.value || null, variant_id: null, phase_key: null, item_key: null })} className={inputClass}>
          <option value="">{picker === undefined ? "Cargando…" : "Cualquier producto"}</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          {c.product_id && !products.some((p) => p.id === c.product_id) && picker && <option value={c.product_id}>(producto sin camino o archivado)</option>}
        </select>
      </div>
      <div>
        <label htmlFor="svt-variant" className={labelClass}>Variante</label>
        <ServiceVariantSelect id="svt-variant" options={picker} productId={c.product_id ?? null} value={c.variant_id ?? null} onChange={(variant_id) => set({ variant_id, phase_key: null, item_key: null })} />
      </div>
      {fields.phase && (
        <div>
          <label htmlFor="svt-phase" className={labelClass}>Qué fase</label>
          <ServiceKeySelect id="svt-phase" kind="phase" options={picker} scope={{ productId: c.product_id ?? null, variantId: c.variant_id ?? null }} value={c.phase_key ?? null} onChange={(phase_key) => set({ phase_key })} emptyLabel="Cualquier fase" />
        </div>
      )}
      {fields.step && (
        <div>
          <label htmlFor="svt-step" className={labelClass}>Qué paso</label>
          <ServiceKeySelect id="svt-step" kind="step" options={picker} scope={{ productId: c.product_id ?? null, variantId: c.variant_id ?? null }} value={c.item_key ?? null} onChange={(item_key) => set({ item_key })} emptyLabel="Cualquier paso" />
        </div>
      )}
      {fields.days && (
        <div>
          <label htmlFor="svt-days" className={labelClass}>Cuántos días antes del fin</label>
          <input id="svt-days" type="number" min={1} max={365} value={c.days_before ?? ""} onChange={(e) => set({ days_before: e.target.value ? Math.max(1, Math.min(365, Math.floor(Number(e.target.value)))) : null })} className={inputClass} />
          <p className={hintClass}>Vacío: con cualquier aviso de «está por terminar».</p>
        </div>
      )}
      <p className={hintClass}>Lo que dejes vacío no filtra.</p>
    </div>
  );
}
