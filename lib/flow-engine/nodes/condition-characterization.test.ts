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
 * campos personalizados) y, para las secuencias, otra.
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { getConditionOperator } from "../registry/registry";
import type { FlowExecutionContext, FlowNode } from "../types";
import { conditionNode } from "./condition";

beforeAll(async () => {
  // Registra operadores y campos, como hace el motor al arrancar.
  await import("../registry");
});

type Contact = Record<string, unknown> | null;

/** Cliente falso: `contacts` devuelve `contact`; las secuencias, `enrollments`. */
function fakeSupabase(contact: Contact, enrollments: unknown[] = []) {
  const queries: string[] = [];
  const client = {
    from(table: string) {
      queries.push(table);
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      Object.assign(chain, {
        select: self,
        eq: self,
        in: self,
        // contacts: `.single()`. sequence_enrollments: `.limit()`.
        single: async () => ({ data: contact, error: null }),
        limit: async () => ({ data: enrollments, error: null }),
      });
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
  return { client, queries };
}

const contactWith = (extra: Record<string, unknown> = {}) => ({
  id: "c-1",
  is_subscribed: true,
  contact_tags: [{ tag_id: "t1", tags: { name: "vip" } }, { tag_id: "t2", tags: null }],
  contact_custom_fields: [
    { field_id: "f1", value: "5000", custom_field_definitions: { slug: "presupuesto" } },
    { field_id: "f2", value: "", custom_field_definitions: { slug: "vacio" } },
    { field_id: "f3", value: "x", custom_field_definitions: null },
  ],
  ...extra,
});

const context = (variables?: Record<string, unknown>, platform: FlowExecutionContext["platform"] = "whatsapp"): FlowExecutionContext =>
  ({ workspaceId: "ws-1", contactId: "c-1", channelId: "ch-1", conversationId: "", flowId: "f", triggerId: "t", incomingMessage: {}, variables, platform }) as unknown as FlowExecutionContext;

type Cond = { field: string; operator: string; value: string };

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
  const T = "handle:true";
  const F = "handle:false";

  const CASES: Array<{ name: string; conditions: Cond[]; logic?: "and" | "or"; ctx?: FlowExecutionContext; contact?: Contact; enrollments?: unknown[]; out: string }> = [
    // Tags
    { name: "tag: el contacto lo tiene, `equals true`", conditions: [{ field: "tag:vip", operator: "equals", value: "true" }], out: T },
    { name: "tag: no lo tiene, `equals true`", conditions: [{ field: "tag:otro", operator: "equals", value: "true" }], out: F },
    { name: "tag: no lo tiene, `equals false` se cumple", conditions: [{ field: "tag:otro", operator: "equals", value: "false" }], out: T },
    { name: "tag: un tag sin nombre cargado (relacion null) no rompe", conditions: [{ field: "tag:vip", operator: "equals", value: "true" }], contact: contactWith({ contact_tags: [{ tag_id: "t", tags: null }] }), out: F },
    // Variables del flow
    { name: "variable: texto igual", conditions: [{ field: "variable:plan", operator: "equals", value: "pro" }], ctx: context({ plan: "pro" }), out: T },
    { name: "variable: numero (se vuelve texto) con gt", conditions: [{ field: "variable:n", operator: "gt", value: "9" }], ctx: context({ n: 12 }), out: T },
    { name: "variable: no existe, `exists` no se cumple", conditions: [{ field: "variable:nada", operator: "exists", value: "" }], ctx: context({}), out: F },
    { name: "variable: sin variables en el contexto no rompe", conditions: [{ field: "variable:nada", operator: "exists", value: "" }], ctx: context(undefined), out: F },
    // HOY una ruta con punto NO funciona: las respuestas viven en variables.answer.<clave>
    // y el resolver busca la clave de primer nivel "answer.x". El `branch` lo arregla; esto no se toca.
    { name: "variable: `answer.x` (con punto) HOY no se resuelve aunque exista anidada", conditions: [{ field: "variable:answer.x", operator: "equals", value: "A" }], ctx: context({ answer: { x: "A" } }), out: F },
    { name: "variable: la clave de primer nivel con punto SI se resuelve", conditions: [{ field: "variable:answer.x", operator: "equals", value: "A" }], ctx: context({ "answer.x": "A" }), out: T },
    // Campo personalizado (campo sin prefijo = slug)
    { name: "campo personalizado: igual", conditions: [{ field: "presupuesto", operator: "equals", value: "5000" }], out: T },
    { name: "campo personalizado: mayor que, comparacion numerica", conditions: [{ field: "presupuesto", operator: "gt", value: "900" }], out: T },
    { name: "campo personalizado: el contacto no lo tiene, `exists` no", conditions: [{ field: "inexistente", operator: "exists", value: "" }], out: F },
    { name: "campo personalizado: valor vacio, `exists` no", conditions: [{ field: "vacio", operator: "exists", value: "" }], out: F },
    { name: "campo personalizado: definicion null se ignora", conditions: [{ field: "x", operator: "exists", value: "" }], out: F },
    // Campos fijos
    { name: "platform: igual", conditions: [{ field: "platform", operator: "equals", value: "whatsapp" }], out: T },
    { name: "platform: distinto", conditions: [{ field: "platform", operator: "equals", value: "instagram" }], out: F },
    { name: "is_subscribed true", conditions: [{ field: "is_subscribed", operator: "equals", value: "true" }], out: T },
    { name: "is_subscribed false", conditions: [{ field: "is_subscribed", operator: "equals", value: "true" }], contact: contactWith({ is_subscribed: false }), out: F },
    // Secuencias
    { name: "sequence: inscripta", conditions: [{ field: "sequence:s1", operator: "equals", value: "true" }], enrollments: [{ id: "e" }], out: T },
    { name: "sequence: no inscripta", conditions: [{ field: "sequence:s1", operator: "equals", value: "true" }], enrollments: [], out: F },
    // Sin contacto
    { name: "sin contacto: siempre `false`, aunque la condicion fuera a cumplirse", conditions: [{ field: "platform", operator: "equals", value: "whatsapp" }], contact: null, out: F },
    { name: "sin contacto y sin condiciones: `false`", conditions: [], contact: null, out: F },
    // and / or
    { name: "and: las dos se cumplen", conditions: [{ field: "tag:vip", operator: "equals", value: "true" }, { field: "presupuesto", operator: "gt", value: "100" }], logic: "and", out: T },
    { name: "and: una falla", conditions: [{ field: "tag:vip", operator: "equals", value: "true" }, { field: "presupuesto", operator: "gt", value: "99999" }], logic: "and", out: F },
    { name: "or: una se cumple", conditions: [{ field: "tag:otro", operator: "equals", value: "true" }, { field: "presupuesto", operator: "gt", value: "100" }], logic: "or", out: T },
    { name: "or: ninguna", conditions: [{ field: "tag:otro", operator: "equals", value: "true" }, { field: "presupuesto", operator: "gt", value: "99999" }], logic: "or", out: F },
    // Lista vacia
    { name: "lista vacia con `and`: se cumple (every de nada)", conditions: [], logic: "and", out: T },
    { name: "lista vacia con `or`: no se cumple (some de nada)", conditions: [], logic: "or", out: F },
    // Raros
    { name: "operador desconocido: no se cumple", conditions: [{ field: "platform", operator: "inventado", value: "whatsapp" }], out: F },
    { name: "logic ausente se trata como `or` (todo lo que no sea \"and\")", conditions: [{ field: "tag:otro", operator: "equals", value: "true" }, { field: "tag:vip", operator: "equals", value: "true" }], logic: undefined, out: T },
  ];

  it.each(CASES)("$name", async ({ conditions, logic, ctx, contact, enrollments, out }) => {
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
