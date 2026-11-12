// @plantilla-quitar(servicios)
/**
 * F122 (decision 463): en Automatizaciones nada de Servicios se elige escribiendo una clave o un id. Los pasos de
 * Servicios y los filtros de sus disparadores eligen de listas: producto › variante (o "Cualquier variante de este
 * producto") y despues la fase o el paso con su nombre. Se guarda la clave como siempre (el formato del flujo no
 * cambia). Una clave que ya no existe se avisa en el panel y frena la publicacion. Puro.
 */

export interface PickerVariantInput {
  id: string;
  name: string;
  archived?: boolean;
  journeyTemplate: unknown;
}
export interface PickerProductInput {
  id: string;
  name: string;
  variants: PickerVariantInput[];
}

export interface PickerStep {
  key: string;
  name: string;
  kind: string;
}
export interface PickerPhase {
  key: string;
  name: string;
  steps: PickerStep[];
}
export interface PickerVariant {
  id: string;
  name: string;
  phases: PickerPhase[];
}
export interface PickerProduct {
  id: string;
  name: string;
  variants: PickerVariant[];
}
export interface ServicePickerOptions {
  products: PickerProduct[];
}

const PHASE_KEY = /^ph_[a-z0-9]{6}$/;
const ITEM_KEY = /^it_[a-z0-9]{6}$/;
const text = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v.trim() : fallback);

/** Las fases y los pasos de una plantilla guardada, leida con cuidado (una plantilla rota no rompe la lista). */
function readTemplate(raw: unknown): PickerPhase[] {
  const phases = (raw && typeof raw === "object" ? (raw as { phases?: unknown }).phases : null) as unknown;
  if (!Array.isArray(phases)) return [];
  return phases
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object" && typeof (p as { key?: unknown }).key === "string" && PHASE_KEY.test((p as { key: string }).key))
    .map((p, i) => ({
      key: p.key as string,
      name: text(p.name, `Fase ${i + 1}`),
      steps: (Array.isArray(p.items) ? p.items : [])
        .filter((it): it is Record<string, unknown> => !!it && typeof it === "object" && typeof (it as { key?: unknown }).key === "string" && ITEM_KEY.test((it as { key: string }).key))
        .map((it, j) => ({ key: it.key as string, name: text(it.name, `Paso ${j + 1}`), kind: text(it.kind, "checkbox") })),
    }));
}

/** Producto › variante › fases › pasos, desde `product_variants.journey_template`. Sin variantes archivadas ni caminos vacios. */
export function servicePickerOptions(products: readonly PickerProductInput[]): ServicePickerOptions {
  return {
    products: products
      .map((p) => ({
        id: p.id,
        name: p.name,
        variants: p.variants
          .filter((v) => !v.archived)
          .map((v) => ({ id: v.id, name: v.name, phases: readTemplate(v.journeyTemplate) }))
          .filter((v) => v.phases.length > 0),
      }))
      .filter((p) => p.variants.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name, "es")),
  };
}

export interface PickerScope {
  productId?: string | null;
  variantId?: string | null;
}

/** Las variantes que entran con lo elegido (todas las de un producto, o una, o todas si no se eligio producto). */
export function variantsInScope(o: ServicePickerOptions, s: PickerScope): Array<{ product: PickerProduct; variant: PickerVariant }> {
  const out: Array<{ product: PickerProduct; variant: PickerVariant }> = [];
  for (const p of o.products) {
    if (s.productId && p.id !== s.productId) continue;
    for (const v of p.variants) if (!s.variantId || v.id === s.variantId) out.push({ product: p, variant: v });
  }
  return out;
}

export interface PickerGroup<T> {
  label: string;
  options: T[];
}

/** Las fases para elegir, agrupadas por "Producto · Variante" (una lista con su nombre, nunca una clave). */
export function phaseGroups(o: ServicePickerOptions, s: PickerScope): PickerGroup<{ key: string; label: string }>[] {
  return variantsInScope(o, s).map(({ product, variant }) => ({
    label: `${product.name} · ${variant.name}`,
    options: variant.phases.map((ph) => ({ key: ph.key, label: ph.name })),
  }));
}

/** Los pasos para elegir, agrupados por "Producto · Variante", con su fase. Opcionalmente, solo los de una fase. */
export function stepGroups(o: ServicePickerOptions, s: PickerScope & { phaseKey?: string | null }): PickerGroup<{ key: string; label: string }>[] {
  return variantsInScope(o, s)
    .map(({ product, variant }) => ({
      label: `${product.name} · ${variant.name}`,
      options: variant.phases
        .filter((ph) => !s.phaseKey || ph.key === s.phaseKey)
        .flatMap((ph) => ph.steps.map((st) => ({ key: st.key, label: `${ph.name} › ${st.name}` }))),
    }))
    .filter((g) => g.options.length > 0);
}

/**
 * El aviso de una clave guardada que ya no existe en el camino ("Este paso ya no existe en el camino de <variante> ·
 * Elegí otro"). Null si no hay clave o si existe. Con el producto elegido se busca en sus variantes (o en la elegida);
 * sin producto, en todas.
 */
export function staleKeyMessage(o: ServicePickerOptions, s: PickerScope & { phaseKey?: string | null; itemKey?: string | null }): string | null {
  const scope = variantsInScope(o, s);
  const where = scope.length === 1 ? scope[0].variant.name : s.productId ? o.products.find((p) => p.id === s.productId)?.name ?? "este producto" : "ningún producto";
  if (s.itemKey && !scope.some(({ variant }) => variant.phases.some((ph) => ph.steps.some((st) => st.key === s.itemKey)))) {
    return `Este paso ya no existe en el camino de ${where} · Elegí otro`;
  }
  if (s.phaseKey && !scope.some(({ variant }) => variant.phases.some((ph) => ph.key === s.phaseKey))) {
    return `Esta fase ya no existe en el camino de ${where} · Elegí otra`;
  }
  return null;
}

/** El nombre de una clave guardada, para mostrarla en el panel y en el detalle del paso. */
export function keyLabel(o: ServicePickerOptions, key: string | null | undefined): string | null {
  if (!key) return null;
  for (const p of o.products)
    for (const v of p.variants)
      for (const ph of v.phases) {
        if (ph.key === key) return ph.name;
        const st = ph.steps.find((x) => x.key === key);
        if (st) return `${ph.name} › ${st.name}`;
      }
  return null;
}

// ── La validacion de publicar ───────────────────────────────────────────────
const ACTION_STEP = "svc_complete_step";
const ACTION_PHASE = "svc_change_phase";

interface NodeLike {
  type?: unknown;
  data?: Record<string, unknown> | null;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** Lo que un nodo de Servicios guardo con clave, para validarlo. */
function nodeKeys(n: NodeLike): (PickerScope & { phaseKey?: string | null; itemKey?: string | null; label: string }) | null {
  const d = (n.data ?? {}) as Record<string, unknown>;
  if (n.type === ACTION_STEP || d.actionType === ACTION_STEP) return { productId: str(d.productId), variantId: str(d.variantId), itemKey: str(d.itemKey), label: "«Completar un paso»" };
  if (n.type === ACTION_PHASE || d.actionType === ACTION_PHASE) return { productId: str(d.productId), variantId: str(d.variantId), phaseKey: str(d.phaseKey), label: "«Cambiar de fase»" };
  const trigger = str(d.triggerType);
  if (trigger && (trigger.startsWith("service_") || trigger.startsWith("program_") || trigger.startsWith("challenge_"))) {
    const c = { ...(d.config && typeof d.config === "object" ? (d.config as Record<string, unknown>) : {}), ...d };
    if (!str(c.phase_key) && !str(c.item_key)) return null;
    return { productId: str(c.product_id), variantId: str(c.variant_id), phaseKey: str(c.phase_key), itemKey: str(c.item_key), label: "El disparador" };
  }
  return null;
}

/**
 * Los problemas de publicar: un paso o un disparador de Servicios cuya clave guardada ya no existe en el camino. Un
 * flujo sin nodos de Servicios no tiene ninguno (y no pide leer nada).
 */
export function serviceKeyProblems(nodes: readonly unknown[], o: ServicePickerOptions): string[] {
  const out: string[] = [];
  for (const raw of nodes) {
    const k = nodeKeys((raw ?? {}) as NodeLike);
    if (!k) continue;
    if (!k.itemKey && !k.phaseKey) {
      if (k.label !== "El disparador") out.push(`${k.label}: elegí ${k.label === "«Cambiar de fase»" ? "la fase" : "el paso"} de la lista.`);
      continue;
    }
    const msg = staleKeyMessage(o, k);
    if (msg) out.push(`${k.label}: ${msg}.`);
  }
  return out;
}

/** Si el flujo tiene algun nodo de Servicios con clave (para no leer los caminos si no hace falta). */
export function graphUsesServiceKeys(nodes: readonly unknown[]): boolean {
  return nodes.some((n) => nodeKeys((n ?? {}) as NodeLike) !== null);
}

/** Que filtros ofrece cada disparador de Servicios, segun lo que trae su evento (`app_servicio.emit`). */
export function serviceTriggerFilters(triggerType: string): { phase: boolean; step: boolean; days: boolean } {
  return {
    phase: triggerType === "service_phase_started" || triggerType === "service_phase_completed",
    step: triggerType === "service_item_completed" || triggerType === "service_item_overdue",
    days: triggerType === "service_ending_soon",
  };
}
