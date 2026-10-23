/** «Agregar etiqueta» y «Quitar etiqueta» (auditoria de automatizaciones). */
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { addTagNode, removeTagNode } from "./tag";

const ctx = { workspaceId: "ws", contactId: "c1", flowId: "f", channelId: "", conversationId: "", triggerId: "", incomingMessage: {}, variables: { answer: { interes: "Curso" } } };

function world() {
  return memoryDb({ tags: [{ id: "t-vip", workspace_id: "ws", name: "vip" }], contact_tags: [{ contact_id: "c1", tag_id: "t-vip" }] });
}

describe("etiquetas", () => {
  it("«Agregar etiqueta» del lienzo (actionType sin action) AGREGA, con variables", async () => {
    const db = world();
    await addTagNode.execute({ supabase: db.client, data: { tagName: " {{answer.interes}} " } as never, node: { id: "n", type: "action", data: { actionType: "addTag" } } as never, context: ctx as never, sessionId: "s", runtime: {} as never });
    const tag = db.rows("tags").find((t) => t.name === "Curso");
    expect(tag).toBeTruthy();
    expect(db.rows("contact_tags").some((ct) => ct.tag_id === tag!.id)).toBe(true);
    expect(db.rows("contact_tags").some((ct) => ct.tag_id === "t-vip")).toBe(true);
  });

  it("«Quitar etiqueta» quita y no crea etiquetas que no existen", async () => {
    const db = world();
    await removeTagNode.execute({ supabase: db.client, data: { tagName: "vip" } as never, node: { id: "n", type: "action", data: { actionType: "removeTag" } } as never, context: ctx as never, sessionId: "s", runtime: {} as never });
    expect(db.rows("contact_tags")).toHaveLength(0);
    await removeTagNode.execute({ supabase: db.client, data: { tagName: "nueva" } as never, node: { id: "n", type: "action", data: { actionType: "removeTag" } } as never, context: ctx as never, sessionId: "s", runtime: {} as never });
    expect(db.rows("tags").some((t) => t.name === "nueva")).toBe(false);
  });

  it("un nombre vacio o con una variable sin resolver no hace nada", async () => {
    const db = world();
    await addTagNode.execute({ supabase: db.client, data: { tagName: "  " } as never, node: { id: "n", type: "action", data: { actionType: "addTag" } } as never, context: ctx as never, sessionId: "s", runtime: {} as never });
    await addTagNode.execute({ supabase: db.client, data: { tagName: "{{nada}}" } as never, node: { id: "n", type: "action", data: { actionType: "addTag" } } as never, context: ctx as never, sessionId: "s", runtime: {} as never });
    expect(db.rows("tags")).toHaveLength(1);
  });
});
