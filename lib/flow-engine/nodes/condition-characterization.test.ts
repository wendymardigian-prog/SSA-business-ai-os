/**
 * Caracterizacion del nodo `condition` ANTES de sumar el nodo `branch`
 * ("Condiciones").
 *
 * Fija, tal cual esta hoy, que salida (`handle:true` / `handle:false`) devuelve
 * el nodo para cada contexto, y la semantica de los seis operadores viejos
 * (`equals`, `not_equals`, `contains`, `exists`, `gt`, `lt`). La conversion
 * "Convertir a Condiciones" y el evaluador tipado tienen que dar EXACTAMENTE lo
 * mismo con estas tablas.
 *
 * Supabase simulado: el nodo hace una sola consulta (el contacto con sus tags y
 * campos personalizados) y, para las secuencias, otra. La tabla de contextos
 * vive en `condition-fixtures.ts` porque los tests de "Convertir a
 * Condiciones" la reusan.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getConditionOperator } from "../registry/registry";
import type { FlowExecutionContext, FlowNode } from "../types";
import { conditionNode } from "./condition";
import { CONDITION_CASES, contactWith, context, fakeSupabase, type Cond, type Contact } from "./condition-fixtures";

beforeAll(async () => {
  // Registra operadores y campos, como hace el motor al arrancar.
  await import("../registry");
});

async function run(
  conditions: Cond[],
  logic: "and" | "or",
  ctx: FlowExecutionContext,
  contact: Contact = contactWith(),
  enrollments: unknown[] = [],
) {
  const { client } = fakeSupabase(contact, enrollments);
  return conditionNode.execute({
    supabase: client,
    node: { id: "n", type: "condition", data: {}, position: { x: 0, y: 0 } } as unknown as FlowNode,
    data: { conditions, logic } as never,
    context: ctx,
    sessionId: "s",
    runtime: { executeFlow: async () => undefined },
  });
}

describe("condition: tabla de contextos -> salida", () => {
  it.each(CONDITION_CASES)("$name", async ({ conditions, logic, ctx, contact, enrollments, out }) => {
    const result = await run(conditions, logic as "and" | "or", ctx ?? context(), contact === undefined ? contactWith() : contact, enrollments);
    expect(result).toBe(out);
  });

  it("carga el contacto UNA sola vez aunque haya varias condiciones", async () => {
    const { client, queries } = fakeSupabase(contactWith());
    await conditionNode.execute({
      supabase: client,
      node: { id: "n", type: "condition", data: {}, position: { x: 0, y: 0 } } as unknown as FlowNode,
      data: { conditions: [{ field: "tag:vip", operator: "equals", value: "true" }, { field: "presupuesto", operator: "gt", value: "1" }, { field: "platform", operator: "equals", value: "whatsapp" }], logic: "and" } as never,
      context: context(),
      sessionId: "s",
      runtime: { executeFlow: async () => undefined },
    });
    expect(queries).toEqual(["contacts"]);
  });
});

describe("los seis operadores viejos: tabla de valores -> resultado", () => {
  // [operador, actual, esperado, resultado]
  const TABLE: Array<[string, string | undefined, string, boolean]> = [
    ["equals", "a", "a", true],
    ["equals", "a", "A", false], // distingue mayusculas
    ["equals", " a", "a", false], // no recorta espacios
    ["equals", undefined, "", false],
    ["not_equals", "a", "b", true],
    ["not_equals", "a", "a", false],
    ["not_equals", undefined, "a", true], // lo que no existe es "distinto"
    ["contains", "hola mundo", "mundo", true],
    ["contains", "hola mundo", "Mundo", false], // distingue mayusculas
    ["contains", "hola", "", true], // todo texto contiene el vacio
    ["contains", undefined, "a", false],
    ["exists", "x", "", true],
    ["exists", "", "", false],
    ["exists", undefined, "", false],
    ["exists", "0", "", true],
    ["gt", "12", "9", true], // numerico, no por texto
    ["gt", "9", "12", false],
    ["gt", "5", "5", false],
    ["gt", "abc", "1", false], // NaN > n es false
    ["gt", undefined, "1", false],
    ["gt", "", "-1", true], // Number("") === 0 : se cuela, tal cual hoy
    ["lt", "9", "12", true],
    ["lt", "12", "9", false],
    ["lt", "5", "5", false],
    ["lt", "abc", "1", false],
    ["lt", undefined, "1", false],
    ["lt", "", "1", true], // Number("") === 0 : se cuela, tal cual hoy
  ];

  it.each(TABLE)("%s(%j, %j) = %s", (operator, actual, expected, result) => {
    expect(getConditionOperator(operator)!.evaluate(actual, expected)).toBe(result);
  });

  it("son exactamente estos seis y ninguno mas", async () => {
    const { listConditionOperators } = await import("../registry/registry");
    expect(listConditionOperators().map((o) => o.operator).sort()).toEqual(["contains", "equals", "exists", "gt", "lt", "not_equals"]);
  });
});
