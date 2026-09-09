/**
 * El registro en si: donde se anotan los tipos y desde donde el motor los pide.
 *
 * Es un modulo con estado a nivel de proceso. Los tipos se registran una sola
 * vez al importar `@/lib/flow-engine/registry`, que es el barrel que carga las
 * declaraciones. Registrar dos veces el mismo tipo es un error y se avisa: casi
 * siempre significa que alguien copio una definicion y se olvido de cambiarle
 * el nombre.
 */

import type {
  ConditionField,
  ConditionOperator,
  NodeDefinition,
  TriggerDefinition,
} from "./types";

const nodes = new Map<string, NodeDefinition<never>>();
const triggers = new Map<string, TriggerDefinition>();
const operators = new Map<string, ConditionOperator>();
const fields = new Map<string, ConditionField>();

/** type del canvas -> actionType -> tipo canonico. */
const aliasIndex = new Map<string, Map<string | undefined, string>>();

/**
 * Un nodo como viene del canvas.
 *
 * Deliberadamente laxo: el registro es justamente quien traduce lo que el
 * canvas guardo a un tipo conocido, asi que no puede exigir que ya venga bien
 * tipado.
 */
export interface RawNode {
  type: string;
  data?: unknown;
}

// ------------------------------------------------------------
// Alta
// ------------------------------------------------------------

export function registerNode<TData>(definition: NodeDefinition<TData>): void {
  if (nodes.has(definition.type)) {
    throw new Error(`El nodo "${definition.type}" ya estaba registrado`);
  }
  nodes.set(definition.type, definition as unknown as NodeDefinition<never>);

  for (const alias of definition.aliases ?? []) {
    let byAction = aliasIndex.get(alias.nodeType);
    if (!byAction) {
      byAction = new Map();
      aliasIndex.set(alias.nodeType, byAction);
    }
    if (byAction.has(alias.actionType)) {
      throw new Error(
        `El alias ${alias.nodeType}/${alias.actionType ?? "-"} ya apunta a "${byAction.get(alias.actionType)}"`
      );
    }
    byAction.set(alias.actionType, definition.type);
  }
}

export function registerTrigger(definition: TriggerDefinition): void {
  if (triggers.has(definition.type)) {
    throw new Error(`El trigger "${definition.type}" ya estaba registrado`);
  }
  triggers.set(definition.type, definition);
}

export function registerConditionOperator(definition: ConditionOperator): void {
  if (operators.has(definition.operator)) {
    throw new Error(`El operador "${definition.operator}" ya estaba registrado`);
  }
  operators.set(definition.operator, definition);
}

export function registerConditionField(definition: ConditionField): void {
  if (fields.has(definition.prefix)) {
    throw new Error(`El campo de condicion "${definition.prefix}" ya estaba registrado`);
  }
  fields.set(definition.prefix, definition);
}

// ------------------------------------------------------------
// Consulta
// ------------------------------------------------------------

/**
 * Traduce un nodo del canvas a su tipo canonico.
 *
 * Primero por tipo directo. Si no hay, por alias: asi entran los once nodos que
 * el panel guarda como `type: "action"` con el tipo real en `data.actionType`.
 */
export function resolveNodeType(node: RawNode): string | undefined {
  if (nodes.has(node.type)) return node.type;

  const byAction = aliasIndex.get(node.type);
  if (!byAction) return undefined;

  const actionType = (node.data as { actionType?: string } | undefined)?.actionType;
  return byAction.get(actionType) ?? byAction.get(undefined);
}

export function getNode(node: RawNode): NodeDefinition<never> | undefined {
  const type = resolveNodeType(node);
  return type ? nodes.get(type) : undefined;
}

export function getNodeByType(type: string): NodeDefinition<never> | undefined {
  return nodes.get(type);
}

export function listNodes(): NodeDefinition<never>[] {
  return [...nodes.values()];
}

export function getTrigger(type: string): TriggerDefinition | undefined {
  return triggers.get(type);
}

/** Todos los triggers de un alcance, del de mayor prioridad al de menor. */
export function listTriggers(scope?: TriggerDefinition["scope"]): TriggerDefinition[] {
  return [...triggers.values()]
    .filter((t) => scope === undefined || t.scope === scope)
    .sort((a, b) => b.priority - a.priority);
}

export function getConditionOperator(operator: string): ConditionOperator | undefined {
  return operators.get(operator);
}

export function listConditionOperators(): ConditionOperator[] {
  return [...operators.values()];
}

/**
 * Busca el resolver de un campo de condicion.
 *
 * Devuelve tambien el argumento: para "tag:interesado" el resolver es "tag:" y
 * el argumento "interesado". Para un campo exacto como "platform" el argumento
 * queda vacio.
 */
export function matchConditionField(
  field: string
): { definition: ConditionField; argument: string } | undefined {
  const exact = fields.get(field);
  if (exact) return { definition: exact, argument: "" };

  // De mas largo a mas corto: si un prefijo fuera prefijo de otro, ganar por
  // orden de registro elegiria el campo equivocado sin que nadie se entere.
  const byLength = [...fields.values()]
    .filter((d) => d.prefix.endsWith(":"))
    .sort((a, b) => b.prefix.length - a.prefix.length);

  for (const definition of byLength) {
    if (field.startsWith(definition.prefix)) {
      return { definition, argument: field.slice(definition.prefix.length) };
    }
  }
  return undefined;
}

export function listConditionFields(): ConditionField[] {
  return [...fields.values()];
}

/** Solo para los tests: deja el registro vacio. */
export function resetRegistry(): void {
  nodes.clear();
  triggers.clear();
  operators.clear();
  fields.clear();
  aliasIndex.clear();
}
