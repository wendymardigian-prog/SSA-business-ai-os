// @plantilla-quitar(servicios)
"use client";

import { useEffect, useState } from "react";
import { loadSalesTriggerOptions } from "@/lib/actions/sales-automation";
import type { ServiceActionData, ServiceActionType } from "@/lib/flow-engine/nodes/service-action-detail";

const inputClass = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring";
const labelClass = "mb-2 block text-xs font-semibold text-foreground";
const hintClass = "mt-1 text-[11px] text-muted-foreground";

/**
 * El panel de las cinco acciones de Servicios (F25). Todas actúan sobre el servicio que trae el evento o, si no trae
 * ninguno, el activo más reciente del contacto (del producto elegido, si se elige uno). El paso y la fase se eligen
 * por su clave (la que se ve en el Camino del cliente de la variante).
 */
export function ServiceActionPanel({ type, data: raw, onChange }: { type: ServiceActionType; data: Record<string, unknown>; onChange: (data: Record<string, unknown>) => void }) {
  const data = raw as ServiceActionData & Record<string, unknown>;
  const [products, setProducts] = useState<Array<{ id: string; name: string }> | null>(null);

  useEffect(() => {
    let alive = true;
    loadSalesTriggerOptions()
      .then((res) => alive && setProducts(res.products))
      .catch(() => alive && setProducts([]));
    return () => {
      alive = false;
    };
  }, []);

  const set = (patch: Partial<ServiceActionData>) => onChange({ ...data, ...patch });

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="svc-product" className={labelClass}>Sobre qué servicio</label>
        <select id="svc-product" value={data.productId ?? ""} onChange={(e) => set({ productId: e.target.value || null })} className={inputClass}>
          <option value="">{products === null ? "Cargando…" : "El del evento, o el activo más reciente"}</option>
          {(products ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              El activo más reciente de {p.name}
            </option>
          ))}
        </select>
        <p className={hintClass}>Si el disparador es de un servicio, se usa ese. Si el contacto no tiene uno activo, el paso se saltea y queda anotado.</p>
      </div>

      {type === "svc_complete_step" && (
        <div>
          <label htmlFor="svc-item" className={labelClass}>Qué paso se completa</label>
          <input id="svc-item" value={data.itemKey ?? ""} onChange={(e) => set({ itemKey: e.target.value.trim() || null })} placeholder="Clave del paso" className={inputClass} />
          <p className={hintClass}>La clave del paso en el Camino del cliente. Si ese paso ya está hecho, no pasa nada.</p>
        </div>
      )}

      {type === "svc_change_phase" && (
        <div>
          <label htmlFor="svc-phase" className={labelClass}>A qué fase pasa</label>
          <input id="svc-phase" value={data.phaseKey ?? ""} onChange={(e) => set({ phaseKey: e.target.value.trim() || null })} placeholder="Clave de la fase" className={inputClass} />
        </div>
      )}

      {type === "svc_extend_service" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="svc-n" className={labelClass}>Cuánto</label>
            <input id="svc-n" type="number" min={1} value={data.n ?? ""} onChange={(e) => set({ n: e.target.value ? Math.max(1, Math.floor(Number(e.target.value))) : null })} className={inputClass} />
          </div>
          <div>
            <label htmlFor="svc-unit" className={labelClass}>Unidad</label>
            <select id="svc-unit" value={data.unit ?? "days"} onChange={(e) => set({ unit: e.target.value === "months" ? "months" : "days" })} className={inputClass}>
              <option value="days">Días</option>
              <option value="months">Meses</option>
            </select>
          </div>
          <div className="col-span-2">
            <label htmlFor="svc-from" className={labelClass}>Desde</label>
            <select id="svc-from" value={data.from ?? "current_end"} onChange={(e) => set({ from: e.target.value === "today" ? "today" : "current_end" })} className={inputClass}>
              <option value="current_end">La fecha de fin de hoy</option>
              <option value="today">Hoy</option>
            </select>
          </div>
        </div>
      )}

      {type === "svc_pause_service" && (
        <>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={data.cutAccess !== false} onChange={(e) => set({ cutAccess: e.target.checked })} />
            Cortar los accesos al portal mientras dure la pausa
          </label>
          <div>
            <label htmlFor="svc-resume" className={labelClass}>Reanudar solo el (opcional)</label>
            <input id="svc-resume" type="date" value={data.resumeOn ?? ""} onChange={(e) => set({ resumeOn: e.target.value || null })} className={inputClass} />
          </div>
        </>
      )}

      {(type === "svc_change_phase" || type === "svc_extend_service" || type === "svc_pause_service") && (
        <div>
          <label htmlFor="svc-reason" className={labelClass}>Motivo</label>
          <input id="svc-reason" value={data.reason ?? ""} onChange={(e) => set({ reason: e.target.value })} placeholder="Automatización" className={inputClass} />
          <p className={hintClass}>Queda en el historial del servicio. Admite variables.</p>
        </div>
      )}
    </div>
  );
}
