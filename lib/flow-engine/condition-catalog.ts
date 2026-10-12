/**
 * El catalogo de campos que se pueden comparar en un camino condicional
 * ("Condiciones"): que hay, de que tipo, con que opciones.
 *
 * Puro y sin Supabase: el SERVIDOR junta los datos (el esquema del disparador,
 * los tags, las secuencias, los campos personalizados) y esta funcion los
 * ordena y agrupa. La pantalla (navegador) importa este modulo directo.
 *
 * Tres familias, en este orden en el selector:
 *   - del disparador ("Del formulario", "De la reunión"...): lo que aporta
 *     `TriggerDefinition.variableSchema`, que es asincronico y corre en el
 *     servidor;
 *   - "De pasos anteriores": lo que dejan los nodos que estan ANTES en el mismo
 *     camino (`NodeDefinition.outputs`, en `node-outputs.ts`);
 *   - "Del contacto": sus tags, sus secuencias, su temperatura, sus campos
 *     personalizados, y los datos de llamadas y ventas que ya tenia el nodo viejo.
 */

import {
  type ConditionFieldSpec,
  type ConditionGroup,
  type ConditionValueType,
  type FieldOption,
} from "./condition-eval";
import { CONDITION_FIELDS, splitConditionField } from "./condition-fields";
import { nodeOutputs, type RawFlowNode } from "./node-outputs";
import { LEAD_TEMPERATURES, LEAD_TEMPERATURE_LABELS } from "@/lib/contacts/fields";

// ------------------------------------------------------------
// Entrada y salida
// ------------------------------------------------------------

export type CustomFieldKind = "text" | "number" | "boolean" | "date" | "url" | "email";

export interface CatalogInput {
  /** Lo que aporta el disparador (`variableSchema`), ya resuelto por el servidor. */
  triggerSchema?: ConditionFieldSpec[];
  /** Solo los nodos que estan antes en el mismo camino (ver `upstreamOf`). */
  upstreamNodes?: Array<RawFlowNode & { id?: string }>;
  customFields?: Array<{ slug: string; name: string; type: CustomFieldKind | string }>;
  tags?: Array<{ name: string }>;
  sequences?: Array<{ id: string; name: string }>;
}

export interface ConditionFieldGroup {
  label: string;
  fields: ConditionFieldSpec[];
}

export const GROUP_TRIGGER_DEFAULT = "Del disparador";
export const GROUP_UPSTREAM = "De pasos anteriores";
export const GROUP_CONTACT = "Del contacto";
export const GROUP_CALLS = "De sus llamadas";
export const GROUP_SALES = "De sus ventas";

const LEGACY_GROUP_LABELS = { contact: GROUP_CONTACT, calls: GROUP_CALLS, sales: GROUP_SALES } as const;

/** El tipo de un campo personalizado del CRM en el evaluador. `url` y `email` se comparan como texto. */
export function customFieldValueType(type: string): ConditionValueType {
  switch (type) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    default:
      return "text";
  }
}

// ------------------------------------------------------------
// El catalogo
// ------------------------------------------------------------

function pushUnique(map: Map<string, ConditionFieldSpec[]>, label: string, spec: ConditionFieldSpec, seen: Set<string>) {
  // Una misma ruta aparece una sola vez: gana la primera familia que la declara.
  if (seen.has(spec.path)) return;
  seen.add(spec.path);
  const list = map.get(label) ?? [];
  list.push({ ...spec, group: label });
  map.set(label, list);
}

/**
 * Todos los campos que se pueden comparar en este punto del flujo, agrupados.
 * Un grupo sin campos no aparece.
 */
export function availableConditionFields(input: CatalogInput): ConditionFieldGroup[] {
  const groups = new Map<string, ConditionFieldSpec[]>();
  const seen = new Set<string>();

  // 1. Del disparador, en el orden en que los declaro y con SU grupo.
  for (const spec of input.triggerSchema ?? []) {
    pushUnique(groups, spec.group ?? GROUP_TRIGGER_DEFAULT, spec, seen);
  }

  // 2. De pasos anteriores.
  for (const node of input.upstreamNodes ?? []) {
    for (const spec of nodeOutputs(node)) {
      const stepLabel = (node.data as { label?: unknown } | undefined)?.label;
      const label = typeof stepLabel === "string" && stepLabel.trim() ? `${spec.label} · ${stepLabel.trim()}` : spec.label;
      pushUnique(groups, GROUP_UPSTREAM, { ...spec, label }, seen);
    }
  }

  // 3. Del contacto.
  const tagOptions: FieldOption[] = uniqueBy(input.tags ?? [], (t) => t.name).map((t) => ({ value: t.name, label: t.name }));
  pushUnique(groups, GROUP_CONTACT, { path: "contact.tags", label: "Tags del contacto", type: "multi_select", options: tagOptions }, seen);

  const sequenceOptions: FieldOption[] = (input.sequences ?? []).map((s) => ({ value: s.id, label: s.name }));
  pushUnique(
    groups,
    GROUP_CONTACT,
    { path: "contact.sequences", label: "Secuencias en las que está", type: "multi_select", options: sequenceOptions, hint: "Cuenta la inscripción viva, aunque esté pausada porque respondió." },
    seen,
  );

  pushUnique(
    groups,
    GROUP_CONTACT,
    {
      path: "contact.lead_temperature",
      label: "Temperatura del lead",
      type: "single_select",
      options: LEAD_TEMPERATURES.map((t) => ({ value: t, label: LEAD_TEMPERATURE_LABELS[t] })),
    },
    seen,
  );

  // El nodo viejo: los campos de siempre (canal, suscripto, llamadas, ventas...), con su tipo.
  for (const option of CONDITION_FIELDS) {
    if (option.prefix === "") continue; // el campo personalizado sin prefijo: salen abajo, uno por uno
    if (option.prefix === "variable:") continue; // lo que se puede comparar de una variable ya sale de "pasos anteriores"
    const legacy = option.prefix === "tag:" || option.prefix === "sequence:"; // cubiertos por contact.tags / contact.sequences
    pushUnique(
      groups,
      LEGACY_GROUP_LABELS[option.group],
      {
        path: option.prefix,
        label: option.label,
        type: option.valueType,
        ...(option.options ? { options: option.options } : {}),
        ...(option.argument !== "none" ? { argument: { kind: option.argument, label: option.argumentLabel, placeholder: option.argumentPlaceholder } } : {}),
        ...(option.hint ? { hint: option.hint } : {}),
        ...(legacy ? { legacy: true } : {}),
      },
      seen,
    );
  }

  for (const field of input.customFields ?? []) {
    pushUnique(groups, GROUP_CONTACT, { path: field.slug, label: field.name, type: customFieldValueType(field.type) }, seen);
  }

  // Orden de los grupos: los del disparador, pasos anteriores, contacto, llamadas, ventas.
  const triggerGroups = [...groups.keys()].filter((label) => ![GROUP_UPSTREAM, GROUP_CONTACT, GROUP_CALLS, GROUP_SALES].includes(label));
  const order = [...triggerGroups, GROUP_UPSTREAM, GROUP_CONTACT, GROUP_CALLS, GROUP_SALES];
  return order.filter((label) => (groups.get(label)?.length ?? 0) > 0).map((label) => ({ label, fields: groups.get(label)! }));
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Todos los campos del catalogo en una lista plana. */
export function flattenFields(groups: ConditionFieldGroup[]): ConditionFieldSpec[] {
  return groups.flatMap((g) => g.fields);
}

/**
 * El campo del catalogo que corresponde a la ruta de una condicion guardada.
 * Los que llevan argumento (`has_active_sale:abc`) se reconocen por su prefijo.
 */
export function findFieldSpec(fields: ConditionFieldSpec[] | ConditionFieldGroup[], path: string): ConditionFieldSpec | undefined {
  const flat: ConditionFieldSpec[] = fields.length > 0 && "fields" in (fields[0] as object) ? flattenFields(fields as ConditionFieldGroup[]) : (fields as ConditionFieldSpec[]);
  const exact = flat.find((f) => f.path === path);
  if (exact) return exact;
  return flat.find((f) => f.argument && path.startsWith(f.path));
}

// ------------------------------------------------------------
// Que hay ANTES de un nodo
// ------------------------------------------------------------

export interface GraphNodeLike extends RawFlowNode {
  id: string;
}
export interface GraphEdgeLike {
  source: string;
  target: string;
}

/**
 * Los nodos que se ejecutan ANTES de `nodeId` en su mismo camino: sus
 * ancestros. Un nodo de otro camino (la rama de al lado) no cuenta: nunca corre
 * antes que este. Del mas cercano al disparador al mas cercano al nodo. Un
 * ciclo no cuelga la busqueda.
 */
export function upstreamOf<N extends GraphNodeLike>(graph: { nodes: N[]; edges: GraphEdgeLike[] }, nodeId: string): N[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = incoming.get(edge.target) ?? [];
    list.push(edge.source);
    incoming.set(edge.target, list);
  }

  // Busqueda hacia atras; la distancia ordena (el mas lejano primero).
  const distance = new Map<string, number>();
  let frontier = [nodeId];
  let depth = 0;
  const visited = new Set<string>([nodeId]);
  while (frontier.length > 0) {
    depth += 1;
    const next: string[] = [];
    for (const current of frontier) {
      for (const parent of incoming.get(current) ?? []) {
        if (visited.has(parent)) continue;
        visited.add(parent);
        distance.set(parent, depth);
        next.push(parent);
      }
    }
    frontier = next;
  }

  return [...distance.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => byId.get(id))
    .filter((n): n is N => n !== undefined);
}

// ------------------------------------------------------------
// Condiciones que quedaron colgadas
// ------------------------------------------------------------

/** Las rutas cuyo catalogo es dinamico: si ya no estan, la condicion quedo colgada. */
const DYNAMIC_PREFIXES = ["answer.", "form.", "submission.", "booking.", "sale.", "payment."];

function isCatalogOwned(path: string): boolean {
  // Los del contacto (tags, secuencias, temperatura) siempre estan.
  if (path.startsWith("contact.")) return false;
  if (DYNAMIC_PREFIXES.some((p) => path.startsWith(p))) return true;
  // Un campo personalizado (sin prefijo): puede haberse borrado.
  return splitConditionField(path).prefix === "";
}

export interface StaleCondition {
  index: number;
  field: string;
  /** Lo que se le muestra a la persona. */
  message: string;
}

/**
 * Las condiciones de un grupo cuyo campo YA NO esta en el catalogo: una
 * pregunta que se saco del formulario, un campo personalizado borrado. Se
 * muestran con un aviso ("Esta pregunta ya no existe en el formulario") en vez
 * de desaparecer, porque en la ejecucion no se cumplen.
 *
 * Solo se miran las familias que el catalogo conoce por completo (`answer.*`,
 * datos del disparador, campos personalizados); un `variable:` o un campo
 * viejo con prefijo no se puede juzgar desde aca y nunca se marca.
 */
export function staleConditions(group: ConditionGroup, fields: ConditionFieldSpec[] | ConditionFieldGroup[]): StaleCondition[] {
  const out: StaleCondition[] = [];
  (group.conditions ?? []).forEach((condition, index) => {
    const path = String(condition?.field ?? "");
    if (!path || !isCatalogOwned(path)) return;
    if (findFieldSpec(fields, path)) return;
    out.push({
      index,
      field: path,
      message: path.startsWith("answer.") ? "Esta pregunta ya no existe en el formulario." : "Este campo ya no existe.",
    });
  });
  return out;
}
