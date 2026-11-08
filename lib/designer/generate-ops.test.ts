import { afterEach, describe, expect, it, vi } from "vitest";
import { registerDesignVariables } from "./extensions";
import { generateOneCore, previewGenerationCore, regenerateCore, retryFailedGenerationsCore, retryGenerationCore, validSubjectRef, type OpsDeps, type OpsEnv } from "./generate-ops";
import { DIEGO, FOREIGN_CONTACT, LUCIA, OTHER_WS, TEMPLATE, TOMAS, USER, WS, generationDb, generationRow, templateDoc } from "./testing/generation-fixtures";

const NOW = new Date("2026-11-08T02:00:00.000Z");
const LINKS = { link: "https://links.academia.test/d/CODE", pdfUrl: "p", zipUrl: "z" };

function deps() {
  return {
    now: () => NOW,
    enqueue: vi.fn(async (..._a: unknown[]) => undefined),
    publish: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { link: LINKS.link } })),
    notify: vi.fn(async (..._a: unknown[]) => true),
    audit: vi.fn(async (..._a: unknown[]) => "a1" as string | null),
    registered: vi.fn(async () => ({})),
    members: vi.fn(async (..._a: unknown[]) => [] as string[]),
    loadLinks: vi.fn(async (..._a: unknown[]) => LINKS),
  };
}
type Spies = ReturnType<typeof deps>;
const asDeps = (d: Spies) => d as unknown as OpsDeps;
const envOf = (db: ReturnType<typeof generationDb>): OpsEnv => ({ service: db.client, workspaceId: WS, userId: USER });

let undo: (() => void)[] = [];
afterEach(() => {
  for (const u of undo) u();
  undo = [];
});

const NAME = "Lucía Ferreyra de Salas";

describe("previewGeneration (F50)", () => {
  it("da los valores reales con lo puesto a mano, lo que falta y si ya tiene una válida", async () => {
    const old = generationRow();
    const db = generationDb({ designs: [old] });
    const out = await previewGenerationCore(envOf(db), { templateId: TEMPLATE, contactId: LUCIA, overrides: { nombre_en_el_certificado: NAME } }, asDeps(deps()));
    expect(out).toMatchObject({ ok: true, data: { missing: [], existingValid: { designId: old.id, code: old.code } } });
    if (!out.ok) throw new Error();
    expect(out.data.values).toMatchObject({ nombre_en_el_certificado: NAME, "contact.first_name": "Lucía", "design.issued_on": "7 de noviembre de 2026" });
  });

  it("sin el valor obligatorio, lo informa antes de confirmar", async () => {
    const out = await previewGenerationCore(envOf(generationDb()), { templateId: TEMPLATE, contactId: LUCIA, overrides: {} }, asDeps(deps()));
    expect(out).toMatchObject({ ok: true, data: { missing: [{ key: "nombre_en_el_certificado", label: "Nombre como lo quiere en el certificado" }], existingValid: null } });
  });

  it("no escribe nada ni encola nada", async () => {
    const db = generationDb();
    const d = deps();
    await previewGenerationCore(envOf(db), { templateId: TEMPLATE, contactId: LUCIA, overrides: { nombre_en_el_certificado: NAME } }, asDeps(d));
    expect(db.rows("designs")).toHaveLength(0);
    expect(d.enqueue).not.toHaveBeenCalled();
    expect(d.notify).not.toHaveBeenCalled();
  });

  it("una clave que no es de la plantilla ni del sistema se descarta, y el código no se puede pisar", async () => {
    const out = await previewGenerationCore(envOf(generationDb()), { templateId: TEMPLATE, contactId: LUCIA, overrides: { inventada: "x", "design.code": "AAAA-AAAA-AAAA", nombre_en_el_certificado: "Lu" } }, asDeps(deps()));
    if (!out.ok) throw new Error();
    expect(out.data.values).not.toHaveProperty("inventada");
    expect(out.data.values["design.code"]).toBe("");
  });

  it("un contacto de otro negocio no existe", async () => {
    const out = await previewGenerationCore(envOf(generationDb()), { templateId: TEMPLATE, contactId: FOREIGN_CONTACT, overrides: {} }, asDeps(deps()));
    expect(out).toEqual({ ok: false, error: "El contacto ya no existe." });
  });

  it("una plantilla de otro negocio no existe", async () => {
    const db = generationDb({ template: { workspace_id: OTHER_WS } });
    expect(await previewGenerationCore(envOf(db), { templateId: TEMPLATE, contactId: LUCIA, overrides: {} }, asDeps(deps()))).toEqual({ ok: false, error: "La plantilla ya no existe." });
  });
});

describe("generateOne (F50)", () => {
  const base = { templateId: TEMPLATE, contactId: LUCIA as string | null, overrides: { nombre_en_el_certificado: NAME }, publish: true };

  it("crea la pieza (source = manual, la persona de la SESIÓN como origen), publica y devuelve el link del dominio del negocio", async () => {
    const db = generationDb();
    const d = deps();
    const out = await generateOneCore(envOf(db), base, asDeps(d));
    expect(out).toMatchObject({ ok: true, data: { link: LINKS.link, status: "queued" } });
    if (!out.ok) throw new Error();
    expect(db.rows("designs")[0]).toMatchObject({ id: out.data.designId, template_id: TEMPLATE, source: "manual", source_ref: { kind: "user", user_id: USER }, subject_contact_id: LUCIA, status: "queued" });
    expect(d.publish).toHaveBeenCalledTimes(1);
    expect(d.enqueue).toHaveBeenCalledTimes(1);
    expect(d.loadLinks).toHaveBeenCalledWith(db.client, WS, out.data.code);
  });

  it("sin pedir publicar, no publica", async () => {
    const d = deps();
    await generateOneCore(envOf(generationDb()), { ...base, publish: false }, asDeps(d));
    expect(d.publish).not.toHaveBeenCalled();
  });

  it("generar sin un valor obligatorio lo pide ANTES de crear nada (ni fila ni aviso)", async () => {
    const db = generationDb();
    const d = deps();
    const out = await generateOneCore(envOf(db), { ...base, overrides: {} }, asDeps(d));
    expect(out).toEqual({ ok: false, error: "Falta: Nombre como lo quiere en el certificado" });
    expect(db.rows("designs")).toHaveLength(0);
    expect(d.notify).not.toHaveBeenCalled();
    expect(d.enqueue).not.toHaveBeenCalled();
  });

  it("si ya tiene una válida avisa con el texto del tipo, sin crear otra", async () => {
    const old = generationRow();
    const db = generationDb({ designs: [old] });
    const out = await generateOneCore(envOf(db), base, asDeps(deps()));
    expect(out).toEqual({ ok: false, error: `Ya tiene un certificado válido (código ${old.code}): ¿reemplazarlo?` });
    expect(db.rows("designs")).toHaveLength(1);
  });

  it("con «reemplazarlo» confirmado, anula la anterior", async () => {
    const old = generationRow();
    const db = generationDb({ designs: [old] });
    const out = await generateOneCore(envOf(db), { ...base, replaceExisting: true }, asDeps(deps()));
    expect(out.ok).toBe(true);
    expect(db.rows("designs").find((r) => r.id === old.id)).toMatchObject({ status: "void" });
    expect(db.rows("designs").filter((r) => r.status !== "void")).toHaveLength(1);
  });

  it("guarda el email pedido (y lo valida antes de crear)", async () => {
    const db = generationDb();
    const out = await generateOneCore(envOf(db), { ...base, email: { subject: "Tu certificado", body: "Acá: {{design.link}}" } }, asDeps(deps()));
    expect(out.ok).toBe(true);
    expect((db.rows("designs")[0].source_ref as { email_request: unknown }).email_request).toEqual({ subject: "Tu certificado", body: "Acá: {{design.link}}" });
    const bad = generationDb();
    expect(await generateOneCore(envOf(bad), { ...base, email: { subject: " ", body: "x" } }, asDeps(deps()))).toEqual({ ok: false, error: "Escribí el asunto del email." });
    expect(bad.rows("designs")).toHaveLength(0);
  });

  it("sin a quién emitir, no hace nada", async () => {
    const db = generationDb();
    expect(await generateOneCore(envOf(db), { ...base, contactId: null }, asDeps(deps()))).toEqual({ ok: false, error: "Elegí para quién es la pieza." });
    expect(db.rows("designs")).toHaveLength(0);
  });

  it("un origen que ningún módulo registró no se acepta (el navegador no inventa orígenes)", async () => {
    const out = await generateOneCore(envOf(generationDb()), { ...base, contactId: null, subjectRef: { module: "tienda", type: "pedido", id: "1", label: "Pedido 1" } }, asDeps(deps()));
    expect(out).toEqual({ ok: false, error: "Ese origen no está disponible." });
  });

  it("un origen registrado por un módulo sí, y no pide contacto", async () => {
    undo.push(registerDesignVariables({ group: "prueba", label: "Prueba", source: "Registro de prueba", vars: [{ key: "prueba.nombre", label: "Nombre de prueba", sample: "x" }] }));
    expect(validSubjectRef({ module: "prueba", type: "registro", id: "r-1", label: "Registro de Ana" })).toEqual({ module: "prueba", type: "registro", id: "r-1", label: "Registro de Ana" });
    const db = generationDb();
    const out = await generateOneCore(envOf(db), { ...base, contactId: null, subjectRef: { module: "prueba", type: "registro", id: "r-1", label: "Registro de Ana" } }, asDeps(deps()));
    expect(out.ok).toBe(true);
    expect(db.rows("designs")[0]).toMatchObject({ subject_contact_id: null, subject_ref: { module: "prueba", id: "r-1" } });
  });

  it("validSubjectRef descarta lo que no tiene la forma esperada", () => {
    expect(validSubjectRef(null)).toBeNull();
    expect(validSubjectRef({ module: "x" })).toBeNull();
    expect(validSubjectRef({ module: "prueba", type: "t", id: "i", label: "x".repeat(300) })).toBeNull();
  });

  it("un email sin contacto no tiene a quién llegar", async () => {
    undo.push(registerDesignVariables({ group: "prueba", label: "Prueba", source: "Registro de prueba", vars: [] }));
    const out = await generateOneCore(envOf(generationDb()), { ...base, contactId: null, subjectRef: { module: "prueba", type: "registro", id: "r-1", label: "Registro" }, email: { subject: "x", body: "y" } }, asDeps(deps()));
    expect(out).toEqual({ ok: false, error: "Para mandar un email elegí un contacto." });
  });

  it("un contacto de otro negocio no existe y no se crea nada", async () => {
    const db = generationDb();
    expect(await generateOneCore(envOf(db), { ...base, contactId: FOREIGN_CONTACT }, asDeps(deps()))).toEqual({ ok: false, error: "El contacto ya no existe." });
    expect(db.rows("designs")).toHaveLength(0);
  });

  it("lo del navegador no pisa el negocio: la pieza sale con el workspace de la sesión", async () => {
    const db = generationDb();
    const out = await generateOneCore({ service: db.client, workspaceId: OTHER_WS, userId: USER }, base, asDeps(deps()));
    expect(out).toEqual({ ok: false, error: "La plantilla ya no existe." });
    expect(db.rows("designs")).toHaveLength(0);
  });

  it("si la pieza se crea pero no se puede encolar el archivo, avisa con status failed (se reintenta desde Generaciones)", async () => {
    const d = deps();
    d.enqueue.mockRejectedValue(new Error("cola caída"));
    const out = await generateOneCore(envOf(generationDb()), base, asDeps(d));
    expect(out).toMatchObject({ ok: true, data: { status: "failed" } });
  });
});

describe("retryGeneration (F54)", () => {
  const renderFailed = (over: Record<string, unknown> = {}) => generationRow({ id: "d2000000-1111-4111-8111-000000000001", status: "failed", error: "No se pudo armar el PDF (tiempo agotado).", attempts: 4, ...over });
  const dataFailed = (over: Record<string, unknown> = {}) =>
    generationRow({
      id: "d2000000-1111-4111-8111-000000000002",
      status: "failed",
      error: "Falta: Nombre como lo quiere en el certificado",
      values: { "contact.first_name": "Lucía", "design.issued_on": "1 de noviembre de 2026", "design.today": "1 de noviembre de 2026" },
      ...over,
    });

  it("una falla de render vuelve a armar el archivo con los mismos valores y el mismo documento", async () => {
    const failed = renderFailed();
    const db = generationDb({ designs: [failed] });
    const d = deps();
    const docBefore = JSON.stringify(db.rows("designs")[0].doc);
    const valuesBefore = JSON.stringify(db.rows("designs")[0].values);
    expect(await retryGenerationCore(envOf(db), { designId: failed.id as string }, asDeps(d))).toEqual({ ok: true, data: {} });
    expect(db.rows("designs")[0]).toMatchObject({ status: "queued", error: null, attempts: 0 });
    expect(JSON.stringify(db.rows("designs")[0].doc)).toBe(docBefore);
    expect(JSON.stringify(db.rows("designs")[0].values)).toBe(valuesBefore);
    expect(d.enqueue).toHaveBeenCalledTimes(1);
    expect(d.enqueue.mock.calls[0][1]).toEqual({ designId: failed.id, purpose: "generation" });
  });

  it("una falla de datos sin completar SIGUE pidiendo el dato y no cambia nada", async () => {
    const failed = dataFailed();
    const db = generationDb({ designs: [failed] });
    const d = deps();
    const before = JSON.stringify(db.rows("designs")[0]);
    const out = await retryGenerationCore(envOf(db), { designId: failed.id as string }, asDeps(d));
    expect(out).toEqual({ ok: true, data: { needs: [{ key: "nombre_en_el_certificado", label: "Nombre como lo quiere en el certificado" }] } });
    expect(JSON.stringify(db.rows("designs")[0])).toBe(before);
    expect(d.enqueue).not.toHaveBeenCalled();
    // Y lo vuelve a pedir la próxima vez, y la otra.
    expect(await retryGenerationCore(envOf(db), { designId: failed.id as string, values: { nombre_en_el_certificado: "   " } }, asDeps(d))).toMatchObject({ ok: true, data: { needs: [{ key: "nombre_en_el_certificado" }] } });
  });

  it("con el dato completo queda en cola, conserva la fecha de emisión y el código, y no vuelve a correr ninguna automatización", async () => {
    const failed = dataFailed({ source: "automation", source_ref: { kind: "automation", flow_id: "f1", session_id: "s1", node_id: "n1" } });
    const db = generationDb({ designs: [failed] });
    const d = deps();
    const out = await retryGenerationCore(envOf(db), { designId: failed.id as string, values: { nombre_en_el_certificado: NAME } }, asDeps(d));
    expect(out).toEqual({ ok: true, data: {} });
    const row = db.rows("designs")[0];
    expect(row).toMatchObject({ status: "queued", error: null, attempts: 0 });
    expect(row.values).toMatchObject({ nombre_en_el_certificado: NAME, "design.issued_on": "1 de noviembre de 2026", "design.code": failed.code });
    expect(d.enqueue).toHaveBeenCalledTimes(1);
    // El único trabajo que se encola es el render de ESTA pieza: ninguno de la automatización ni de un email.
    expect(d.enqueue.mock.calls[0][1]).toEqual({ designId: failed.id, purpose: "generation" });
    expect(d.notify).not.toHaveBeenCalled();
  });

  it("una pieza que no está fallida no se reintenta", async () => {
    for (const status of ["ready", "queued", "rendering", "void"]) {
      const row = generationRow({ id: "d2000000-1111-4111-8111-000000000009", status, void_reason: status === "void" ? "x" : null });
      const out = await retryGenerationCore(envOf(generationDb({ designs: [row] })), { designId: row.id as string }, asDeps(deps()));
      expect(out).toEqual({ ok: false, error: "Esa pieza no está fallida." });
    }
  });

  it("dos reintentos a la vez: encola uno solo (el segundo ya no la encuentra fallida)", async () => {
    const failed = renderFailed();
    const db = generationDb({ designs: [failed] });
    const d = deps();
    const [a, b] = await Promise.all([retryGenerationCore(envOf(db), { designId: failed.id as string }, asDeps(d)), retryGenerationCore(envOf(db), { designId: failed.id as string }, asDeps(d))]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(d.enqueue).toHaveBeenCalledTimes(1);
  });

  it("si la persona ya tiene otra válida (plantilla con verificación), no deja dos", async () => {
    const failed = renderFailed();
    const other = generationRow({ status: "ready" });
    const db = generationDb({ designs: [failed, other] });
    const d = deps();
    const out = await retryGenerationCore(envOf(db), { designId: failed.id as string }, asDeps(d));
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining(`código ${other.code}`) });
    expect(db.rows("designs").find((r) => r.id === failed.id)?.status).toBe("failed");
    expect(d.enqueue).not.toHaveBeenCalled();
  });

  it("si no se puede encolar, vuelve a quedar fallida con un motivo claro", async () => {
    const failed = renderFailed();
    const db = generationDb({ designs: [failed] });
    const d = deps();
    d.enqueue.mockRejectedValue(new Error("cola caída"));
    const out = await retryGenerationCore(envOf(db), { designId: failed.id as string }, asDeps(d));
    expect(out.ok).toBe(false);
    expect(db.rows("designs")[0]).toMatchObject({ status: "failed", error: "No se pudo preparar el archivo. Tocá «Reintentar» para armarlo de nuevo." });
  });

  it("una pieza de otro negocio no existe", async () => {
    const failed = renderFailed();
    const db = generationDb({ designs: [failed] });
    expect(await retryGenerationCore({ ...envOf(db), workspaceId: OTHER_WS }, { designId: failed.id as string }, asDeps(deps()))).toEqual({ ok: false, error: "No encontramos esa pieza." });
  });

  it("completar con una clave que la plantilla no tiene no sirve: se descarta y sigue faltando", async () => {
    const failed = dataFailed();
    const db = generationDb({ designs: [failed] });
    const out = await retryGenerationCore(envOf(db), { designId: failed.id as string, values: { inventada: "x" } }, asDeps(deps()));
    expect(out).toMatchObject({ ok: true, data: { needs: [{ key: "nombre_en_el_certificado" }] } });
  });
});

describe("retryFailedGenerations (F54)", () => {
  it("reencola las de render y cuenta las de datos, que se piden una por una", async () => {
    const r1 = generationRow({ status: "failed", error: "No se pudo armar el PDF.", subject_contact_id: LUCIA });
    const r2 = generationRow({ status: "failed", error: "El servicio de render no respondió.", subject_contact_id: DIEGO });
    const data = generationRow({ status: "failed", error: "Falta: Nombre como lo quiere en el certificado", subject_contact_id: TOMAS, values: {} });
    const ready = generationRow({ status: "ready", subject_contact_id: TOMAS });
    const db = generationDb({ designs: [r1, r2, data, ready] });
    const d = deps();
    const out = await retryFailedGenerationsCore(envOf(db), { templateId: TEMPLATE }, asDeps(d));
    expect(out).toEqual({ ok: true, data: { retried: 2, needData: 1 } });
    expect(d.enqueue).toHaveBeenCalledTimes(2);
    expect(db.rows("designs").find((r) => r.id === data.id)?.status).toBe("failed");
  });

  it("de otra plantilla o de otro negocio no toca nada", async () => {
    const otra = generationRow({ status: "failed", error: "x", template_id: "otra" });
    const ajena = generationRow({ status: "failed", error: "x", workspace_id: OTHER_WS });
    const db = generationDb({ designs: [otra, ajena] });
    const d = deps();
    expect(await retryFailedGenerationsCore(envOf(db), { templateId: TEMPLATE }, asDeps(d))).toEqual({ ok: true, data: { retried: 0, needData: 0 } });
    expect(d.enqueue).not.toHaveBeenCalled();
  });
});

describe("regenerate: volver a generar (F47)", () => {
  it("crea una nueva con los datos de HOY y anula la anterior con «Reemplazado por <código>»", async () => {
    const old = generationRow({ values: { nombre_en_el_certificado: "Nombre de ayer", "contact.first_name": "Lucía", "design.issued_on": "1 de noviembre de 2026" } });
    const db = generationDb({ designs: [old] });
    // Los datos de hoy: el contacto cambió de nombre y la plantilla cambió de texto.
    db.rows("contacts")[0].display_name = "Lucía Ferreyra Salas";
    db.rows("design_templates")[0].doc = templateDoc("Texto NUEVO {{nombre_en_el_certificado}} {{design.code}}");
    const d = deps();
    const out = await regenerateCore(envOf(db), { designId: old.id as string }, asDeps(d));
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error();
    const fresh = db.rows("designs").find((r) => r.id === out.data.designId);
    expect(fresh).toMatchObject({ status: "queued", subject_contact_id: LUCIA, source: "manual", source_ref: { kind: "user", user_id: USER } });
    // Lo propio se conserva; el contacto, la fecha y el documento son los de hoy.
    expect(fresh?.values).toMatchObject({ nombre_en_el_certificado: "Nombre de ayer", "contact.display_name": "Lucía Ferreyra Salas", "design.issued_on": "7 de noviembre de 2026" });
    expect(JSON.stringify(fresh?.doc)).toContain("Texto NUEVO");
    // La anterior queda anulada, y su documento NO cambia (copia congelada).
    const oldRow = db.rows("designs").find((r) => r.id === old.id);
    expect(oldRow).toMatchObject({ status: "void", void_reason: `Reemplazado por ${out.data.code}` });
    expect(JSON.stringify(oldRow?.doc)).toBe(JSON.stringify(templateDoc()));
    expect(db.rows("designs").filter((r) => r.status !== "void")).toHaveLength(1);
    expect(d.enqueue).toHaveBeenCalledTimes(1);
    expect(d.audit.mock.calls.map((c) => (c[0] as { action: string }).action)).toContain("design.regenerated");
  });

  it("mantiene la publicación de la pieza anterior", async () => {
    const old = generationRow({ published: true });
    const d = deps();
    await regenerateCore(envOf(generationDb({ designs: [old] })), { designId: old.id as string }, asDeps(d));
    expect(d.publish).toHaveBeenCalledTimes(1);
    const notPublished = deps();
    await regenerateCore(envOf(generationDb({ designs: [generationRow({ id: "d3000000-1111-4111-8111-000000000001", published: false })] })), { designId: "d3000000-1111-4111-8111-000000000001" }, asDeps(notPublished));
    expect(notPublished.publish).not.toHaveBeenCalled();
  });

  it("solo una pieza lista o anulada; una fallida se reintenta", async () => {
    for (const status of ["failed", "queued", "rendering"]) {
      const row = generationRow({ status });
      expect(await regenerateCore(envOf(generationDb({ designs: [row] })), { designId: row.id as string }, asDeps(deps()))).toEqual({ ok: false, error: "Solo se puede volver a generar una pieza lista o anulada." });
    }
  });

  it("una anulada también se puede volver a generar (no queda una válida de más)", async () => {
    const old = generationRow({ status: "void", void_reason: "Nombre mal escrito" });
    const db = generationDb({ designs: [old] });
    const out = await regenerateCore(envOf(db), { designId: old.id as string }, asDeps(deps()));
    expect(out.ok).toBe(true);
    expect(db.rows("designs").filter((r) => r.status !== "void")).toHaveLength(1);
  });

  it("sin a quién volver a generarla (el contacto se borró), lo dice", async () => {
    const old = generationRow({ subject_contact_id: null });
    expect(await regenerateCore(envOf(generationDb({ designs: [old] })), { designId: old.id as string }, asDeps(deps()))).toMatchObject({ ok: false, error: expect.stringContaining("no tiene a quién") });
  });

  it("si el contacto ya no existe, no crea nada", async () => {
    const old = generationRow();
    const db = generationDb({ designs: [old], contacts: [] });
    expect(await regenerateCore(envOf(db), { designId: old.id as string }, asDeps(deps()))).toEqual({ ok: false, error: "El contacto ya no existe." });
    expect(db.rows("designs")).toHaveLength(1);
  });

  it("una pieza de otro negocio no existe", async () => {
    const old = generationRow();
    expect(await regenerateCore({ ...envOf(generationDb({ designs: [old] })), workspaceId: OTHER_WS }, { designId: old.id as string }, asDeps(deps()))).toEqual({ ok: false, error: "No encontramos esa pieza." });
  });
});
