import { describe, expect, it } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import { assignSetterIfEmpty } from "./setter";

describe("assignSetterIfEmpty", () => {
  it("asigna solo si el contacto no tenía setter, en su workspace y vivo", async () => {
    const db = fakeDb({ "contacts:update": { data: [{ id: "c1" }] } });
    expect(await assignSetterIfEmpty(db.client, "ws1", "c1", "u1")).toBe(true);
    const write = db.writesTo("contacts")[0];
    expect(write.values).toEqual({ setter_id: "u1" });
  });

  it("si ya tenía setter no cambia nada y lo dice", async () => {
    const db = fakeDb({ "contacts:update": { data: [] } });
    expect(await assignSetterIfEmpty(db.client, "ws1", "c1", "u1")).toBe(false);
  });

  it("un error de la base se avisa, no se toma como 'no hizo falta'", async () => {
    const db = fakeDb({ "contacts:update": { data: null, error: { message: "boom" } } });
    await expect(assignSetterIfEmpty(db.client, "ws1", "c1", "u1")).rejects.toThrow("boom");
  });
});
