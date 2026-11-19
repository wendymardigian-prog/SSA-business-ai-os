// @plantilla-quitar(servicios)
"use client";

import { SERVICE_TRIGGER_TYPES, type ServiceTriggerConfig } from "@/lib/services/automation";
import { serviceTriggerFilters } from "@/lib/services/service-picker";
import { ServiceKeySelect, ServiceVariantSelect } from "./service-key-select";
import { useServicePicker } from "./use-service-picker";
import { ANCHORS_KNOWN_AHEAD, MAX_OFFSET_HOURS, PERIODIC_PRESETS, RELATIVE_ANCHORS, periodicConfigProblems, relativeConfigProblems, relativeUnit, type RelativeAnchor } from "@/lib/services/relative-triggers";
import { MAX_THRESHOLD, METRIC_HINTS, METRIC_LABELS, METRICS, isMetric, metricConfigProblems } from "@/lib/services/metric-trigger";

const ANCHOR_LABELS: Record<RelativeAnchor, string> = {
  service_created: "la creación del servicio",
  service_start: "el inicio del servicio",
  service_end: "el fin del servicio",
  phase_start: "el inicio de una fase",
  item_completed: "completar un paso",
};

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
  const relative = triggerType === "service_relative";
  const periodic = triggerType === "service_phase_periodic";
  const metric = triggerType === "service_metric_reached";
  const raw = c as Record<string, unknown>;
  const anchor = (raw.anchor as RelativeAnchor | undefined) ?? null;
  // En horas (00460) el número va en `offset_hours` y `offset_days` queda vacío: el barrido diario no lo toma.
  const hours = relativeUnit(raw) === "hours";
  const offsetKey = hours ? "offset_hours" : "offset_days";
  const maxOffset = hours ? MAX_OFFSET_HOURS : 365;
  const offset = typeof raw[offsetKey] === "number" ? (raw[offsetKey] as number) : null;
  const canBefore = anchor === null || ANCHORS_KNOWN_AHEAD.includes(anchor);
  const every = typeof raw.every_days === "number" ? raw.every_days : null;
  const metricKey = isMetric(raw.metric) ? raw.metric : null;
  const threshold = typeof raw.threshold === "number" ? raw.threshold : null;
  const setRaw = (patch: Record<string, unknown>) => set(patch as Partial<ServiceTriggerConfig>);
  const problems = relative ? relativeConfigProblems(raw) : periodic ? periodicConfigProblems(raw) : metric ? metricConfigProblems(raw) : [];

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
      {relative && (
        <div className="space-y-3">
          <div>
            <label htmlFor="svt-anchor" className={labelClass}>Desde qué momento se cuenta</label>
            <select
              id="svt-anchor"
              value={anchor ?? ""}
              onChange={(e) => {
                const next = (e.target.value || null) as RelativeAnchor | null;
                // «Antes» solo con el inicio o el fin: con otra ancla pasa a «después».
                const flip = next !== null && !ANCHORS_KNOWN_AHEAD.includes(next) && offset !== null && offset < 0;
                setRaw({ anchor: next, phase_key: null, item_key: null, ...(flip ? { [offsetKey]: -offset } : {}) });
              }}
              className={inputClass}
            >
              <option value="">Elegí…</option>
              {RELATIVE_ANCHORS.map((a) => (
                <option key={a} value={a}>
                  {ANCHOR_LABELS[a]}
                </option>
              ))}
            </select>
          </div>
          {anchor === "phase_start" && (
            <div>
              <label htmlFor="svt-rel-phase" className={labelClass}>Qué fase</label>
              <ServiceKeySelect id="svt-rel-phase" kind="phase" options={picker} scope={{ productId: c.product_id ?? null, variantId: c.variant_id ?? null }} value={c.phase_key ?? null} onChange={(phase_key) => set({ phase_key })} emptyLabel="Elegí una fase" />
            </div>
          )}
          {anchor === "item_completed" && (
            <div>
              <label htmlFor="svt-rel-step" className={labelClass}>Qué paso</label>
              <ServiceKeySelect id="svt-rel-step" kind="step" options={picker} scope={{ productId: c.product_id ?? null, variantId: c.variant_id ?? null }} value={c.item_key ?? null} onChange={(item_key) => set({ item_key })} emptyLabel="Elegí un paso" />
            </div>
          )}
          <div>
            <span className={labelClass}>Cuándo</span>
            <div className="grid grid-cols-[5rem_1fr_1fr] gap-2">
              <input
                aria-label={hours ? "Cantidad de horas" : "Cantidad de días"}
                type="number"
                min={0}
                max={maxOffset}
                value={offset === null ? "" : Math.abs(offset)}
                onChange={(e) => {
                  const n = e.target.value === "" ? null : Math.max(0, Math.min(maxOffset, Math.floor(Number(e.target.value))));
                  setRaw({ [offsetKey]: n === null ? null : (offset !== null && offset < 0 ? -n : n) });
                }}
                className={inputClass}
              />
              <select
                aria-label="Días u horas"
                value={hours ? "hours" : "days"}
                onChange={(e) => {
                  const toHours = e.target.value === "hours";
                  if (toHours === hours) return;
                  const n = offset === null ? null : Math.max(-(toHours ? MAX_OFFSET_HOURS : 365), Math.min(toHours ? MAX_OFFSET_HOURS : 365, offset));
                  setRaw(toHours ? { unit: "hours", offset_hours: n, offset_days: null } : { unit: null, offset_days: n, offset_hours: null });
                }}
                className={inputClass}
              >
                <option value="days">días</option>
                <option value="hours">horas</option>
              </select>
              <select
                aria-label="Antes o después"
                value={offset !== null && offset < 0 ? "before" : "after"}
                onChange={(e) => setRaw({ [offsetKey]: offset === null ? null : e.target.value === "before" ? -Math.abs(offset) : Math.abs(offset) })}
                className={inputClass}
              >
                <option value="after">después</option>
                <option value="before" disabled={!canBefore}>antes</option>
              </select>
            </div>
            <p className={hintClass}>
              {hours
                ? "0 = en el momento. Se revisa cada hora y sale dentro de la hora que toca; si al publicar ya pasó, no se manda. El inicio cuenta desde las 00:00 del primer día y el fin desde las 24:00 del último (hora del negocio). Un solo envío por servicio."
                : "0 = el mismo día. Se manda una vez por servicio, en la hora del negocio."}
              {!canBefore && " «Antes» solo con el inicio o el fin: lo demás no se sabe de antemano."}
            </p>
          </div>
        </div>
      )}
      {metric && (
        <div className="space-y-3">
          <div>
            <label htmlFor="svt-metric" className={labelClass}>Qué cifra</label>
            <select id="svt-metric" value={metricKey ?? ""} onChange={(e) => setRaw({ metric: e.target.value || null })} className={inputClass}>
              <option value="">Elegí…</option>
              {METRICS.map((m) => (
                <option key={m} value={m}>
                  {METRIC_LABELS[m]}
                </option>
              ))}
            </select>
            {metricKey && <p className={hintClass}>{METRIC_HINTS[metricKey]}</p>}
          </div>
          <div>
            <label htmlFor="svt-threshold" className={labelClass}>Llega a</label>
            <input id="svt-threshold" type="number" inputMode="numeric" min={1} max={MAX_THRESHOLD} value={threshold ?? ""} placeholder="Ej.: 500" onChange={(e) => setRaw({ threshold: e.target.value ? Math.max(1, Math.min(MAX_THRESHOLD, Math.floor(Number(e.target.value)))) : null })} className={inputClass} />
            <p className={hintClass}>Salta en el momento en que la cifra pasa ese número, una sola vez por servicio. Si ya estaba arriba cuando publicás, no le escribe.</p>
          </div>
        </div>
      )}
      {periodic && (
        <div className="space-y-3">
          <div>
            <label htmlFor="svt-per-phase" className={labelClass}>Qué fase</label>
            <ServiceKeySelect id="svt-per-phase" kind="phase" options={picker} scope={{ productId: c.product_id ?? null, variantId: c.variant_id ?? null }} value={c.phase_key ?? null} onChange={(phase_key) => set({ phase_key })} emptyLabel="Elegí una fase" />
          </div>
          <div>
            <label htmlFor="svt-every" className={labelClass}>Cada cuántos días</label>
            <div className="flex flex-wrap gap-1">
              {PERIODIC_PRESETS.map((n) => (
                <button key={n} type="button" onClick={() => setRaw({ every_days: n })} className={`h-8 rounded-lg border px-2.5 text-xs ${every === n ? "border-primary-edge bg-accent" : "border-border hover:bg-accent"}`}>
                  {n === 1 ? "Todos los días" : `Cada ${n}`}
                </button>
              ))}
              <input id="svt-every" type="number" min={1} max={90} value={every ?? ""} onChange={(e) => setRaw({ every_days: e.target.value ? Math.max(1, Math.min(90, Math.floor(Number(e.target.value)))) : null })} className="h-8 w-20 rounded-lg border border-border bg-card px-2 text-sm" />
            </div>
            <p className={hintClass}>Cuenta los días de la fase sin las pausas. La primera vez es el día N, no el primero.</p>
          </div>
        </div>
      )}
      {problems.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-warn">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {!relative && !periodic && fields.phase && (
        <div>
          <label htmlFor="svt-phase" className={labelClass}>Qué fase</label>
          <ServiceKeySelect id="svt-phase" kind="phase" options={picker} scope={{ productId: c.product_id ?? null, variantId: c.variant_id ?? null }} value={c.phase_key ?? null} onChange={(phase_key) => set({ phase_key })} emptyLabel="Cualquier fase" />
        </div>
      )}
      {!relative && !periodic && fields.step && (
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
      {!relative && !periodic && !metric && <p className={hintClass}>Lo que dejes vacío no filtra.</p>}
    </div>
  );
}
