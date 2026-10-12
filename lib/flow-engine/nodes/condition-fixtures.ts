/**
 * Datos de prueba compartidos por la caracterizacion del nodo `condition` y por
 * los tests de "Convertir a Condiciones": la MISMA tabla de contextos tiene que
 * dar las mismas salidas con el nodo viejo y con el `branch` convertido.
 * Supabase simulado: el nodo hace una sola consulta (el contacto con sus tags
 * y campos personalizados) y, para las secuencias, otra.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { ContactFlowContext } from "../types";

export type Contact = Record<string, unknown> | null;

/** Cliente falso: `contacts` devuelve `contact`; las secuencias, `enrollments`. */
export function fakeSupabase(contact: Contact, enrollments: unknown[] = []) {
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
        // El nodo `branch` anota el camino con un insert.
        insert: async () => ({ error: null }),
      });
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
  return { client, queries };
}

export const contactWith = (extra: Record<string, unknown> = {}) => ({
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

export const context = (variables?: Record<string, unknown>, platform: ContactFlowContext["platform"] = "whatsapp"): ContactFlowContext =>
  ({ workspaceId: "ws-1", contactId: "c-1", channelId: "ch-1", conversationId: "", flowId: "f", triggerId: "t", incomingMessage: {}, variables, platform }) as unknown as ContactFlowContext;

export type Cond = { field: string; operator: string; value: string };


export interface ConditionCase {
  name: string;
  conditions: Cond[];
  logic?: "and" | "or";
  ctx?: ContactFlowContext;
  contact?: Contact;
  enrollments?: unknown[];
  out: string;
}

export const CONDITION_CASES: ConditionCase[] = (() => {
  const T = "handle:true";
  const F = "handle:false";

  const CASES: ConditionCase[] = [
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
  return CASES;
})();
