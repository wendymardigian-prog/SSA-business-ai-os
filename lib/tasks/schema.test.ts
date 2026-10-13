import { describe, it, expect } from "vitest";
import { createTaskSchema, parseWith, updateTaskSchema } from "./schema";

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

describe("createTaskSchema (F8)", () => {
  it("acepta lo minimo y recorta el titulo", () => {
    const r = parseWith(createTaskSchema, { title: "  Enviar propuesta " });
    expect(r).toEqual({ ok: true, data: { title: "Enviar propuesta" } });
  });

  it("rechaza titulo vacio o de mas de 200", () => {
    expect(parseWith(createTaskSchema, { title: "   " })).toEqual({ ok: false, error: "El título no puede estar vacío." });
    const r = parseWith(createTaskSchema, { title: "x".repeat(201) });
    expect(r.ok).toBe(false);
  });

  it("rechaza estado o prioridad invalidos", () => {
    expect(parseWith(createTaskSchema, { title: "a", status: "hecho" }).ok).toBe(false);
    expect(parseWith(createTaskSchema, { title: "a", priority: "maxima" }).ok).toBe(false);
  });

  it("rechaza fechas mal formadas o imposibles", () => {
    expect(parseWith(createTaskSchema, { title: "a", due_date: "13/10/2026" }).ok).toBe(false);
    expect(parseWith(createTaskSchema, { title: "a", due_date: "2026-02-30" }).ok).toBe(false);
    expect(parseWith(createTaskSchema, { title: "a", due_date: "2026-10-13" }).ok).toBe(true);
  });

  it("rechaza inicio posterior al vencimiento", () => {
    const r = parseWith(createTaskSchema, { title: "a", start_date: "2026-10-20", due_date: "2026-10-13" });
    expect(r).toEqual({ ok: false, error: "La fecha de inicio no puede ser posterior al vencimiento." });
  });

  it("limita los seguidores a 20 y los deduplica", () => {
    const many = Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(parseWith(createTaskSchema, { title: "a", follower_ids: many }).ok).toBe(false);
    const r = parseWith(createTaskSchema, { title: "a", follower_ids: [ID, ID, ID2] });
    expect(r.ok && r.data.follower_ids).toEqual([ID, ID2]);
  });

  it("rechaza ids que no son uuid y descripcion de mas de 5000", () => {
    expect(parseWith(createTaskSchema, { title: "a", owner_id: "juan" }).ok).toBe(false);
    expect(parseWith(createTaskSchema, { title: "a", description: "x".repeat(5001) }).ok).toBe(false);
  });

  it("el proyecto se normaliza (texto + clave) y mas de 80 se rechaza", () => {
    const r = parseWith(createTaskSchema, { title: "a", project: "  Lanzamiento   Q4 " });
    expect(r.ok && r.data.project).toEqual({ project: "Lanzamiento Q4", project_key: "lanzamiento q4" });
    expect(parseWith(createTaskSchema, { title: "a", project: "x".repeat(81) }).ok).toBe(false);
  });

  it("no deja pasar campos que el cliente no puede escribir", () => {
    expect(parseWith(createTaskSchema, { title: "a", workspace_id: ID }).ok).toBe(false);
    expect(parseWith(createTaskSchema, { title: "a", source: "agent" }).ok).toBe(false);
    expect(parseWith(createTaskSchema, { title: "a", blocked_by: [] }).ok).toBe(false);
  });
});

describe("updateTaskSchema", () => {
  it("exige al menos un campo", () => {
    expect(parseWith(updateTaskSchema, {})).toEqual({ ok: false, error: "No hay nada para cambiar." });
  });
  it("permite limpiar fechas y responsable con null", () => {
    const r = parseWith(updateTaskSchema, { due_date: null, owner_id: null });
    expect(r).toEqual({ ok: true, data: { due_date: null, owner_id: null } });
  });
  it("valida la posicion", () => {
    expect(parseWith(updateTaskSchema, { position: Number.NaN }).ok).toBe(false);
    expect(parseWith(updateTaskSchema, { position: 1.5 }).ok).toBe(true);
  });
});
