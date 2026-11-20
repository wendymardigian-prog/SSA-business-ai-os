import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { CANVAS_DRAFT_BLOCK, canvasDraftBlock, recordStepEditorVersion } from "./step-editor-versions";

const flow = (over: Record<string, unknown> = {}) => ({ id: "f1", status: "published", draft_nodes: null, version: 3, name: "Bienvenida", viewport: null, ...over });

describe("editores de pasos y el borrador del lienzo", () => {
  it("con cambios sin publicar en el lienzo no deja guardar", async () => {
    const db = memoryDb({ flows: [flow({ draft_nodes: [] })] });
    expect(await canvasDraftBlock(db.client as never, "f1")).toBe(CANVAS_DRAFT_BLOCK);
  });
  it("sin borrador, o sin publicar, se guarda", async () => {
    expect(await canvasDraftBlock(memoryDb({ flows: [flow()] }).client as never, "f1")).toBeNull();
    expect(await canvasDraftBlock(memoryDb({ flows: [flow({ status: "draft", draft_nodes: [] })] }).client as never, "f1")).toBeNull();
  });
  it("cada guardado de una publicada queda en el historial", async () => {
    const db = memoryDb({ flows: [flow()], flow_versions: [] });
    await recordStepEditorVersion(db.client as never, { flowId: "f1", nodes: [{ id: "a" }], edges: [], userId: "u1" });
    expect(db.rows("flows")[0]).toMatchObject({ version: 4 });
    expect(db.rows("flow_versions")[0]).toMatchObject({ flow_id: "f1", version: 4, published_by: "u1", name: "Bienvenida" });
  });
  it("una apagada no suma versiones", async () => {
    const db = memoryDb({ flows: [flow({ status: "draft" })], flow_versions: [] });
    await recordStepEditorVersion(db.client as never, { flowId: "f1", nodes: [], edges: [], userId: null });
    expect(db.rows("flow_versions")).toHaveLength(0);
  });
});
