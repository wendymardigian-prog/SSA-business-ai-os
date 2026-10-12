import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

const mocks = vi.hoisted(() => ({ member: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({ getMemberAction: mocks.member }));

import { getConditionCatalogInputs } from "./flow-conditions";

const FLOW = "22222222-2222-4222-8222-222222222222";
const FORM = "11111111-1111-4111-8111-111111111111";

const triggerNode = { id: "trigger", type: "trigger", data: { triggerType: "form_submitted", form_ids: [FORM] } };

function setup(opts: { can?: (k: string) => boolean; flow?: unknown } = {}) {
  const db = fakeDb({
    "flows:select": { data: opts.flow === undefined ? { id: FLOW, nodes: [triggerNode] } : opts.flow },
    "forms:select": {
      data: [
        {
          id: FORM,
          current_version_id: null,
          draft_definition: { fields: [{ id: "1", key: "facturacion", type: "single_select", label: "Facturación", required: true, options: ["Poco", "Mucho"] }] },
        },
      ],
    },
    "custom_field_definitions:select": { data: [{ slug: "presupuesto", name: "Presupuesto", type: "number" }] },
    "tags:select": { data: [{ name: "vip" }] },
    "sequences:select": { data: [{ id: "s1", name: "Bienvenida" }] },
  });
  mocks.member.mockResolvedValue({ workspace: { id: "ws1" }, supabase: db.client, can: opts.can ?? (() => true) });
  return db;
}

beforeEach(() => vi.clearAllMocks());

describe("getConditionCatalogInputs", () => {
  it("trae las preguntas del formulario del disparador, los tags, las secuencias y los campos personalizados", async () => {
    setup();
    const out = await getConditionCatalogInputs({ flowId: FLOW });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.inputs.triggerSchema.find((f) => f.path === "answer.facturacion")).toMatchObject({ type: "single_select", label: "Facturación" });
    expect(out.inputs.tags).toEqual([{ name: "vip" }]);
    expect(out.inputs.sequences).toEqual([{ id: "s1", name: "Bienvenida" }]);
    expect(out.inputs.customFields).toEqual([{ slug: "presupuesto", name: "Presupuesto", type: "number" }]);
  });

  it("el workspace sale de la sesion: todas las lecturas filtran por el", async () => {
    const db = setup();
    await getConditionCatalogInputs({ flowId: FLOW });
    for (const table of ["flows", "forms", "custom_field_definitions", "tags", "sequences"]) {
      const call = db.calls.find((c) => c.table === table)!;
      expect(call.filters, table).toContainEqual({ method: "eq", column: "workspace_id", value: "ws1" });
    }
  });

  it("si la pantalla manda su disparador (con cambios sin guardar), usa ese", async () => {
    const db = setup({ flow: { id: FLOW, nodes: [{ ...triggerNode, data: { triggerType: "form_submitted", form_ids: [] } }] } });
    await getConditionCatalogInputs({ flowId: FLOW, triggerData: { triggerType: "form_submitted", form_ids: [FORM] } });
    expect(db.calls.some((c) => c.table === "forms")).toBe(true);
  });

  it("sin la pregunta en el disparador guardado, no hay preguntas (pero si el resto)", async () => {
    setup({ flow: { id: FLOW, nodes: [{ ...triggerNode, data: { triggerType: "form_submitted", form_ids: [] } }] } });
    const out = await getConditionCatalogInputs({ flowId: FLOW });
    expect(out.ok && out.inputs.triggerSchema.some((f) => f.path.startsWith("answer."))).toBe(false);
  });

  it("sin permiso de ver automatizaciones, nada", async () => {
    const db = setup({ can: () => false });
    expect(await getConditionCatalogInputs({ flowId: FLOW })).toEqual({ ok: false, error: expect.stringMatching(/permiso/) });
    expect(db.calls).toHaveLength(0);
  });

  it("un flujo de otro workspace (no aparece con ese filtro) o un id raro no devuelve nada", async () => {
    setup({ flow: null });
    expect((await getConditionCatalogInputs({ flowId: FLOW })).ok).toBe(false);
    const db = setup();
    expect((await getConditionCatalogInputs({ flowId: "no-es-uuid" })).ok).toBe(false);
    expect(db.calls).toHaveLength(0);
  });
});
