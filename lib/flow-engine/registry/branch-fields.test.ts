/**
 * Los campos tipados que solo usa el nodo `branch`: tags, secuencias,
 * temperatura, la respuesta del formulario y lo que deja el disparador en las
 * variables. Cada uno devuelve su valor REAL (lista, numero), no texto.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { MissingFieldError } from "../condition-eval";
import type { FlowExecutionContext } from "../types";
import { getTrigger, matchConditionField } from "./registry";
import { variablePathValue } from "./conditions";

beforeAll(async () => {
  await import("./index");
});

const WS = "ws-1";
const ctx = (variables: Record<string, unknown> = {}): FlowExecutionContext =>
  ({ workspaceId: WS, contactId: "c-1", channelId: "", conversationId: "", flowId: "f", triggerId: "t", incomingMessage: {}, variables }) as unknown as FlowExecutionContext;

function world() {
  return memoryDb(
    {
      form_versions: [
        { id: "v1", form_id: "form-1", definition: { fields: [{ key: "facturacion", type: "single_select" }, { key: "intereses", type: "multi_select" }, { key: "edad", type: "number" }, { key: "nombre-completo", type: "short_text" }] } },
        { id: "v2", form_id: "form-1", definition: { fields: [{ key: "facturacion", type: "single_select" }] } },
      ],
      form_submissions: [
        { id: "sub-1", workspace_id: WS, form_id: "form-1", form_version_id: "v1", answers: { facturacion: { value: "Más de USD 10.000" }, intereses: { value: ["CRM", "Ads"] }, edad: { value: 42 }, "nombre-completo": { value: "Ana" } } },
        { id: "sub-viejo", workspace_id: WS, form_id: "form-1", form_version_id: "v2", answers: { facturacion: { value: "x" } } },
        { id: "sub-otro-ws", workspace_id: "otro", form_id: "form-1", form_version_id: "v1", answers: { edad: { value: 99 } } },
      ],
      sequence_enrollments: [
        { id: "e1", contact_id: "c-1", sequence_id: "seq-1", status: "active", sequences: { workspace_id: WS } },
        { id: "e2", contact_id: "c-1", sequence_id: "seq-2", status: "completed", sequences: { workspace_id: WS } },
        { id: "e3", contact_id: "c-1", sequence_id: "seq-3", status: "paused", sequences: { workspace_id: WS } },
        { id: "e4", contact_id: "c-2", sequence_id: "seq-9", status: "active", sequences: { workspace_id: WS } },
      ],
    },
    { joins: {} },
  );
}

async function typed(field: string, opts: { db?: ReturnType<typeof world>; variables?: Record<string, unknown>; contact?: Record<string, unknown>; memo?: Map<string, Promise<unknown>> } = {}) {
  const match = matchConditionField(field);
  if (!match) throw new Error(`campo no registrado: ${field}`);
  const db = opts.db ?? world();
  return match.definition.resolveTyped!({ supabase: db.client, argument: match.argument, context: ctx(opts.variables), contact: opts.contact ?? {}, memo: opts.memo });
}

describe("contact.*", () => {
  it("contact.tags: los nombres, ignorando las filas sin tag", async () => {
    const contact = { contact_tags: [{ tags: { name: "vip" } }, { tags: null }, { tags: { name: "frio" } }] };
    expect(await typed("contact.tags", { contact })).toEqual(["vip", "frio"]);
    expect(await typed("contact.tags", { contact: {} })).toEqual([]);
  });
  it("contact.lead_temperature: el valor o vacio", async () => {
    expect(await typed("contact.lead_temperature", { contact: { lead_temperature: "hot" } })).toBe("hot");
    expect(await typed("contact.lead_temperature", { contact: { lead_temperature: null } })).toBeUndefined();
  });
  it("contact.sequences: los ids de las vivas (activas o pausadas) del contacto", async () => {
    const ids = (await typed("contact.sequences")) as string[];
    expect(ids.sort()).toEqual(["seq-1", "seq-3"]);
  });
});

// @plantilla-desde(formularios)
describe("answer.*: la respuesta real, con la version con la que se respondio", () => {
  const vars = (id: string) => ({ submission: { id } });

  it("devuelve cada valor con su tipo", async () => {
    expect(await typed("answer.facturacion", { variables: vars("sub-1") })).toBe("Más de USD 10.000");
    expect(await typed("answer.intereses", { variables: vars("sub-1") })).toEqual(["CRM", "Ads"]);
    expect(await typed("answer.edad", { variables: vars("sub-1") })).toBe(42);
    expect(await typed("answer.nombre_completo", { variables: vars("sub-1") })).toBe("Ana");
  });

  it("una pregunta que no esta en LA VERSION de esa respuesta lanza MissingFieldError (aunque exista en la vigente)", async () => {
    await expect(typed("answer.edad", { variables: vars("sub-viejo") })).rejects.toBeInstanceOf(MissingFieldError);
  });

  it("una pregunta de la version que no se respondio es vacia", async () => {
    expect(await typed("answer.intereses", { variables: vars("sub-viejo") }).catch((e) => e)).toBeInstanceOf(MissingFieldError);
    const db = world();
    db.rows("form_submissions").push({ id: "sub-vacia", workspace_id: WS, form_id: "form-1", form_version_id: "v1", answers: {} });
    expect(await typed("answer.edad", { db, variables: vars("sub-vacia") })).toBeUndefined();
  });

  it("no lee la respuesta de otro workspace: cae al texto de la variable", async () => {
    expect(await typed("answer.edad", { variables: { ...vars("sub-otro-ws"), answer: { edad: "7" } } })).toBe("7");
  });

  it("sin id de respuesta usa el texto de la variable", async () => {
    expect(await typed("answer.facturacion", { variables: { answer: { facturacion: "algo" } } })).toBe("algo");
    expect(await typed("answer.facturacion", { variables: {} })).toBeUndefined();
  });

  it("carga la respuesta UNA sola vez por corrida aunque se pidan varias preguntas", async () => {
    const db = world();
    const loose = db.client as unknown as { from: (t: string) => unknown };
    const original = loose.from.bind(db.client);
    const reads: string[] = [];
    loose.from = (table: string) => {
      reads.push(table);
      return original(table);
    };
    const memo = new Map<string, Promise<unknown>>();
    await typed("answer.facturacion", { db, variables: vars("sub-1"), memo });
    await typed("answer.edad", { db, variables: vars("sub-1"), memo });
    await typed("answer.intereses", { db, variables: vars("sub-1"), memo });
    expect(reads.filter((t) => t === "form_submissions")).toHaveLength(1);
    expect(reads.filter((t) => t === "form_versions")).toHaveLength(1);
  });

  it("para el nodo viejo (texto), una pregunta inexistente es 'sin valor' y no lanza", async () => {
    const match = matchConditionField("answer.edad")!;
    const db = world();
    const text = await match.definition.resolve({ supabase: db.client, argument: match.argument, context: ctx(vars("sub-viejo")), contact: {} });
    expect(text).toBeUndefined();
    const multi = matchConditionField("answer.intereses")!;
    expect(await multi.definition.resolve({ supabase: db.client, argument: multi.argument, context: ctx(vars("sub-1")), contact: {} })).toBe("CRM, Ads");
  });
});
// @plantilla-hasta(formularios)

describe("form.* / submission.* / booking.* / sale.* / payment.*: lo que deja el disparador", () => {
  const variables = {
    form: { name: "Aplicación" },
    submission: { id: "s", score: "9", nps_category: "promoter" },
    booking: { status: "scheduled", answers: { x: "1" } },
    sale: { status: "Pagada" },
    payment: { method: "Transferencia" },
    "flat.key": "plano",
  };
  it.each([
    ["form.name", "Aplicación"], // @plantilla-quitar(formularios)
    ["submission.score", "9"], // @plantilla-quitar(formularios)
    ["submission.nps_category", "promoter"], // @plantilla-quitar(formularios)
    ["booking.status", "scheduled"],
    ["booking.answers.x", "1"],
    ["sale.status", "Pagada"], // @plantilla-quitar(ventas)
    ["payment.method", "Transferencia"], // @plantilla-quitar(ventas)
  ])("%s", async (field, expected) => {
    expect(await typed(field, { variables })).toBe(expected);
  });
  it("lo que no esta es vacio, sin lanzar", async () => {
    expect(await typed("booking.nada", { variables })).toBeUndefined();
    expect(await typed("form.name", { variables: {} })).toBeUndefined(); // @plantilla-quitar(formularios)
  });
  it("variablePathValue: clave plana con punto, anidada, objetos y arrays raros", () => {
    expect(variablePathValue({ "a.b": "plana" }, "a.b")).toBe("plana");
    expect(variablePathValue({ a: { b: 3 } }, "a.b")).toBe(3);
    expect(variablePathValue({ a: { b: { c: 1 } } }, "a.b")).toBeUndefined();
    expect(variablePathValue({ a: ["x", "y"] }, "a")).toEqual(["x", "y"]);
    expect(variablePathValue({ a: [1] }, "a")).toBeUndefined();
    expect(variablePathValue(undefined, "a")).toBeUndefined();
  });
});

describe("el registro", () => {
  it("las rutas con punto se reconocen por prefijo y las exactas, por nombre", () => {
    expect(matchConditionField("answer.facturacion")).toMatchObject({ argument: "facturacion", definition: { prefix: "answer." } }); // @plantilla-quitar(formularios)
    expect(matchConditionField("contact.tags")?.definition.prefix).toBe("contact.tags");
    expect(matchConditionField("booking.answers.x")?.argument).toBe("answers.x");
  });
  it("lo de siempre sigue resolviendo igual", () => {
    expect(matchConditionField("tag:vip")?.definition.prefix).toBe("tag:");
    expect(matchConditionField("variable:answer.x")?.definition.prefix).toBe("variable:");
    expect(matchConditionField("presupuesto")).toBeUndefined();
  });
});

describe("variableSchema de los triggers", () => {
  it("los de Formularios, Agenda y Ventas lo declaran; el resto no", () => {
    for (const type of ["form_submitted", "survey_answered", "contract_signed", "booking_created", "booking_before_start", "sale_created", "payment_status_changed"]) { // @plantilla-quitar(formularios,ventas)
    // @plantilla-sin(formularios,ventas): for (const type of ["booking_created", "booking_before_start"]) {
      expect(typeof getTrigger(type)?.variableSchema, type).toBe("function");
    }
    expect(getTrigger("keyword")?.variableSchema).toBeUndefined();
  });

  // @plantilla-desde(formularios)
  it("form_submitted lee la version PUBLICADA de los formularios elegidos (y el borrador si nunca se publico)", async () => {
    const db = memoryDb({
      forms: [
        { id: "form-pub", workspace_id: WS, current_version_id: "v1", draft_definition: { fields: [{ key: "borrador", type: "short_text", label: "Borrador", id: "x", required: false }] } },
        { id: "form-nuevo", workspace_id: WS, current_version_id: null, draft_definition: { fields: [{ key: "solo_borrador", type: "number", label: "Solo borrador", id: "y", required: false }] } },
        { id: "form-ajeno", workspace_id: "otro", current_version_id: null, draft_definition: { fields: [{ key: "ajeno", type: "short_text", label: "Ajeno", id: "z", required: false }] } },
      ],
      form_versions: [{ id: "v1", definition: { fields: [{ key: "publicada", type: "single_select", label: "Publicada", id: "p", required: true, options: ["A", "B"] }] } }],
    });
    const schema = getTrigger("form_submitted")!.variableSchema!;
    const pub = await schema({ form_ids: ["form-pub"] }, { supabase: db.client, workspaceId: WS });
    expect(pub.map((s) => s.path)).toEqual(["form.name", "answer.publicada"]);
    expect(pub[1]).toMatchObject({ type: "single_select", options: [{ value: "A", label: "A" }, { value: "B", label: "B" }] });

    const draft = await schema({ form_ids: ["form-nuevo"] }, { supabase: db.client, workspaceId: WS });
    expect(draft.map((s) => s.path)).toEqual(["form.name", "answer.solo_borrador"]);

    // Otro workspace: no se ve.
    expect((await schema({ form_ids: ["form-ajeno"] }, { supabase: db.client, workspaceId: WS })).map((s) => s.path)).toEqual(["form.name"]);
    // Sin formularios o con una config rota: solo lo general, sin lanzar.
    expect((await schema({}, { supabase: db.client, workspaceId: WS })).map((s) => s.path)).toEqual(["form.name"]);
    expect((await schema({ form_ids: "todos" }, { supabase: db.client, workspaceId: WS })).map((s) => s.path)).toEqual(["form.name"]);
  });
  // @plantilla-hasta(formularios)

  // @plantilla-desde(formularios)
  it("survey_answered suma puntaje y categoria NPS", async () => {
    const db = memoryDb({ forms: [], form_versions: [] });
    const out = await getTrigger("survey_answered")!.variableSchema!({}, { supabase: db.client, workspaceId: WS });
    expect(out.map((s) => s.path)).toEqual(["form.name", "submission.score", "submission.nps_category"]);
  });
  // @plantilla-hasta(formularios)
});
