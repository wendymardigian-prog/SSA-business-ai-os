import { describe, expect, it, vi } from "vitest";
import { createGeneration, findValidForContacts, generationName, type CreateGenerationInput, type GenerationDeps } from "./generate-core";
import { DESIGN_CODE_RE } from "./public-links";
import { DIEGO, FOREIGN_CONTACT, LUCIA, OTHER_WS, TEMPLATE, TOMAS, USER, WS, generationDb, generationRow, interceptFrom, templateDoc } from "./testing/generation-fixtures";

const NOW = new Date("2026-11-08T02:00:00.000Z");

function deps() {
  return {
    now: () => NOW,
    enqueue: vi.fn(async (..._a: unknown[]) => undefined),
    publish: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { link: "https://x.test/d/CODE" } })),
    notify: vi.fn(async (..._a: unknown[]) => true),
    audit: vi.fn(async (..._a: unknown[]) => "a1" as string | null),
    registered: vi.fn(async () => ({})),
    members: vi.fn(async (..._a: unknown[]) => [] as string[]),
  };
}
type Spies = ReturnType<typeof deps>;
const asDeps = (d: Spies) => d as unknown as GenerationDeps;

const input = (over: Partial<CreateGenerationInput> = {}): CreateGenerationInput => ({
  workspaceId: WS,
  templateId: TEMPLATE,
  contactId: LUCIA,
  overrides: { nombre_en_el_certificado: "Lucía Ferreyra de Salas" },
  policy: "fail",
  publish: false,
  source: "manual",
  sourceRef: { kind: "user", user_id: USER },
  actorUserId: USER,
  ...over,
});

describe("createGeneration: qué se guarda (F52)", () => {
  it("crea UNA fila de designs, en cola, con la copia del documento, los valores y de dónde salió", async () => {
    const db = generationDb();
    const d = deps();
    const out = await createGeneration(db.client, input(), asDeps(d));
    expect(out).toMatchObject({ ok: true, status: "queued", missing: [] });
    if (!out.ok) throw new Error("no se generó");
    expect(out.code).toMatch(DESIGN_CODE_RE);
    const rows = db.rows("designs");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: out.designId,
      workspace_id: WS,
      template_id: TEMPLATE,
      subject_contact_id: LUCIA,
      origin: "template",
      format: "carta_h",
      status: "queued",
      error: null,
      attempts: 0,
      source: "manual",
      source_ref: { kind: "user", user_id: USER },
      published: false,
      allow_download: true,
      created_by: USER,
      name: "Certificado del programa · Lucía Ferreyra",
    });
    expect(rows[0].values).toMatchObject({ nombre_en_el_certificado: "Lucía Ferreyra de Salas", "contact.first_name": "Lucía", "contact.display_name": "Lucía Ferreyra", "workspace.name": "Academia Ejemplo", "design.doc_type": "Certificado" });
  });

  it("encola el render de la generación una sola vez", async () => {
    const db = generationDb();
    const d = deps();
    const out = await createGeneration(db.client, input(), asDeps(d));
    if (!out.ok) throw new Error("no se generó");
    expect(d.enqueue).toHaveBeenCalledTimes(1);
    expect(d.enqueue.mock.calls[0][1]).toEqual({ designId: out.designId, purpose: "generation" });
  });

  it("con enqueueRender: false no encola nada (lo corre quien llama) y queda en cola igual", async () => {
    const db = generationDb();
    const d = deps();
    const out = await createGeneration(db.client, input({ enqueueRender: false }), asDeps(d));
    expect(out).toMatchObject({ ok: true, status: "queued" });
    expect(d.enqueue).not.toHaveBeenCalled();
  });

  it("editar la plantilla DESPUÉS no cambia el documento de lo emitido (copia congelada)", async () => {
    const db = generationDb();
    const out = await createGeneration(db.client, input(), asDeps(deps()));
    if (!out.ok) throw new Error("no se generó");
    const frozen = JSON.stringify(db.rows("designs")[0].doc);
    expect(frozen).toBe(JSON.stringify(templateDoc()));
    // La persona edita la plantilla.
    db.rows("design_templates")[0].doc = templateDoc("Texto NUEVO de la plantilla");
    expect(JSON.stringify(db.rows("designs")[0].doc)).toBe(frozen);
    expect(db.rows("designs")[0].code).toBe(out.code);
  });

  it("no comparte el objeto del documento con la plantilla", async () => {
    const db = generationDb();
    await createGeneration(db.client, input(), asDeps(deps()));
    expect(db.rows("designs")[0].doc).not.toBe(db.rows("design_templates")[0].doc);
  });

  it("deja el historial: «design.generated» con quién y de qué plantilla", async () => {
    const db = generationDb();
    const d = deps();
    const out = await createGeneration(db.client, input(), asDeps(d));
    if (!out.ok) throw new Error("no se generó");
    const call = d.audit.mock.calls.find((c) => (c[0] as { action: string }).action === "design.generated")?.[0] as { entityId: string; entityType: string; performedBy: string; workspaceId: string; metadata: Record<string, unknown> };
    expect(call).toMatchObject({ entityType: "design", entityId: out.designId, performedBy: USER, workspaceId: WS });
    expect(call.metadata).toMatchObject({ template_id: TEMPLATE, source: "manual" });
  });

  it("una automatización queda sin persona: source = automation y la corrida como origen", async () => {
    const db = generationDb();
    const ref = { kind: "automation", flow_id: "f1", session_id: "s1", node_id: "step-1" } as const;
    const out = await createGeneration(db.client, input({ source: "automation", sourceRef: ref, actorUserId: null }), asDeps(deps()));
    expect(out).toMatchObject({ ok: true });
    expect(db.rows("designs")[0]).toMatchObject({ source: "automation", source_ref: ref, created_by: null });
  });

  it("guarda el email que hay que mandar al quedar lista, junto con de dónde salió", async () => {
    const db = generationDb();
    await createGeneration(db.client, input({ email: { subject: "Tu certificado", body: "Acá está: {{design.link}}" } }), asDeps(deps()));
    expect(db.rows("designs")[0].source_ref).toEqual({ kind: "user", user_id: USER, email_request: { subject: "Tu certificado", body: "Acá está: {{design.link}}" } });
  });

  it("se puede crear para un registro de un módulo, sin contacto", async () => {
    const db = generationDb();
    const subjectRef = { module: "prueba", type: "registro", id: "r-1", label: "Registro de Ana" };
    const out = await createGeneration(db.client, input({ contactId: null, subjectRef, sourceRef: { kind: "module", module: "prueba", id: "r-1" }, source: "module", actorUserId: null }), asDeps(deps()));
    expect(out).toMatchObject({ ok: true, status: "queued" });
    expect(db.rows("designs")[0]).toMatchObject({ subject_contact_id: null, subject_ref: subjectRef, name: "Certificado del programa · Registro de Ana" });
  });
});

describe("createGeneration: código y fecha de emisión (F56)", () => {
  it("el código de los valores es el de la fila, el mismo del link, y nunca queda vacío", async () => {
    const db = generationDb();
    const out = await createGeneration(db.client, input(), asDeps(deps()));
    if (!out.ok) throw new Error("no se generó");
    const row = db.rows("designs")[0];
    expect((row.values as Record<string, string>)["design.code"]).toBe(out.code);
    expect(row.code).toBe(out.code);
  });

  it("si no se pudo guardar el código en los valores, la pieza igual se crea sin un código vacío guardado", async () => {
    const db = generationDb();
    let updates = 0;
    interceptFrom(db, (table, original) => {
      const builder = original(table) as { update: (...a: unknown[]) => unknown };
      if (table !== "designs") return builder;
      const update = builder.update.bind(builder);
      builder.update = (...args: unknown[]) => {
        updates += 1;
        if (updates === 1) return { eq: () => Promise.resolve({ data: null, error: { message: "boom" } }) };
        return update(...args);
      };
      return builder;
    });
    const out = await createGeneration(db.client, input(), asDeps(deps()));
    expect(out).toMatchObject({ ok: true, status: "queued" });
    expect(db.rows("designs")[0].values).not.toHaveProperty("design.code");
  });

  it("la fecha de emisión es la de creación en la zona del negocio, con el formato de la plantilla", async () => {
    const db = generationDb();
    await createGeneration(db.client, input(), asDeps(deps()));
    // A las 02:00 UTC del 8 todavía es 7 en Buenos Aires.
    expect((db.rows("designs")[0].values as Record<string, string>)["design.issued_on"]).toBe("7 de noviembre de 2026");
    const db2 = generationDb({ template: { date_format: "short" }, workspace: { timezone: "UTC" } });
    await createGeneration(db2.client, input(), asDeps(deps()));
    expect((db2.rows("designs")[0].values as Record<string, string>)["design.issued_on"]).toBe("08/11/2026");
  });
});

describe("createGeneration: si falta un dato (F55)", () => {
  it("con «No generar y avisarme» queda fallida con «Falta: …», no encola y avisa a quien genera", async () => {
    const db = generationDb();
    const d = deps();
    const out = await createGeneration(db.client, input({ overrides: {}, source: "automation", sourceRef: { kind: "automation", flow_id: "f", session_id: "s", node_id: "n" }, actorUserId: null }), asDeps(d));
    expect(out).toMatchObject({ ok: true, status: "failed", missing: [{ key: "nombre_en_el_certificado", label: "Nombre como lo quiere en el certificado" }] });
    expect(db.rows("designs")[0]).toMatchObject({ status: "failed", error: "Falta: Nombre como lo quiere en el certificado" });
    expect(d.enqueue).not.toHaveBeenCalled();
    expect(d.notify).toHaveBeenCalledTimes(1);
    const notice = d.notify.mock.calls[0][0] as { type: string; entityType: string; entityId: string; workspaceId: string; body: string; metadata: Record<string, unknown> };
    expect(notice).toMatchObject({ type: "design_generation_failed", entityType: "design_template", entityId: TEMPLATE, workspaceId: WS });
    expect(notice.body).toContain("Falta: Nombre como lo quiere en el certificado");
    expect(JSON.stringify(notice.metadata)).not.toContain("lucia@ejemplo.com");
  });

  it("el aviso le llega a CADA persona que puede generar (también a un rol que no es Owner ni Admin), una vez por persona", async () => {
    const d = deps();
    d.members.mockResolvedValue(["u-owner", "u-rol-propio"]);
    await createGeneration(generationDb().client, input({ overrides: {} }), asDeps(d));
    expect(d.members).toHaveBeenCalledWith(expect.anything(), WS, "designer.generate");
    const notices = d.notify.mock.calls.map((c) => c[0] as { recipientId?: string; perRecipient?: boolean; type: string });
    expect(notices.map((n) => n.recipientId)).toEqual(["u-owner", "u-rol-propio"]);
    expect(notices.every((n) => n.perRecipient === true && n.type === "design_generation_failed")).toBe(true);
  });

  it("si no se puede saber quiénes pueden generar, el aviso queda para Owner y Admin (sin destinatario)", async () => {
    const d = deps();
    await createGeneration(generationDb().client, input({ overrides: {} }), asDeps(d));
    expect(d.notify).toHaveBeenCalledTimes(1);
    expect(d.notify.mock.calls[0][0]).not.toHaveProperty("recipientId");
  });

  it("«Usar el valor de la plantilla» y «Dejarlo vacío» generan igual", async () => {
    for (const policy of ["template_default", "empty"] as const) {
      const db = generationDb();
      const d = deps();
      const out = await createGeneration(db.client, input({ overrides: {}, policy }), asDeps(d));
      expect(out).toMatchObject({ ok: true, status: "queued" });
      expect(d.notify).not.toHaveBeenCalled();
      expect(d.enqueue).toHaveBeenCalledTimes(1);
      expect((db.rows("designs")[0].values as Record<string, string>).nombre_en_el_certificado).toBe(policy === "empty" ? "" : "Ana Pérez");
    }
  });

  it("un aviso que falla nunca tumba la generación", async () => {
    const db = generationDb();
    const d = deps();
    d.notify.mockRejectedValue(new Error("campana caída"));
    const out = await createGeneration(db.client, input({ overrides: {} }), asDeps(d));
    expect(out).toMatchObject({ ok: true, status: "failed" });
  });
});

describe("createGeneration: «ya tiene una válida» (F47, F50)", () => {
  it("una plantilla con verificación devuelve la existente y no crea otra", async () => {
    const old = generationRow();
    const db = generationDb({ designs: [old] });
    const out = await createGeneration(db.client, input(), asDeps(deps()));
    expect(out).toEqual({ ok: false, reason: "existing", existing: { designId: old.id, code: old.code } });
    expect(db.rows("designs")).toHaveLength(1);
  });

  it("con replaceExisting crea la nueva y anula la anterior con «Reemplazado por <código nuevo>»", async () => {
    const old = generationRow();
    const db = generationDb({ designs: [old] });
    const d = deps();
    const out = await createGeneration(db.client, input({ replaceExisting: true }), asDeps(d));
    if (!out.ok) throw new Error("no se generó");
    expect(db.rows("designs")).toHaveLength(2);
    expect(db.rows("designs").find((r) => r.id === old.id)).toMatchObject({ status: "void", void_reason: `Reemplazado por ${out.code}`, voided_by: USER, voided_at: NOW.toISOString() });
    expect(db.rows("designs").filter((r) => r.status !== "void")).toHaveLength(1);
    expect(d.audit.mock.calls.map((c) => (c[0] as { action: string }).action)).toContain("design.voided");
  });

  it("una anulada o fallida no cuenta como válida", async () => {
    const db = generationDb({ designs: [generationRow({ status: "void", void_reason: "x" }), generationRow({ status: "failed", error: "Falta: algo" })] });
    expect(await createGeneration(db.client, input(), asDeps(deps()))).toMatchObject({ ok: true, status: "queued" });
  });

  it("la de otra persona o de otra plantilla no cuenta", async () => {
    const db = generationDb({ designs: [generationRow({ subject_contact_id: DIEGO }), generationRow({ template_id: "otra-plantilla" })] });
    expect(await createGeneration(db.client, input(), asDeps(deps()))).toMatchObject({ ok: true, status: "queued" });
  });

  it("una que se está armando no se puede reemplazar (volvería a quedar «lista»)", async () => {
    const db = generationDb({ designs: [generationRow({ status: "rendering" })] });
    const out = await createGeneration(db.client, input({ replaceExisting: true }), asDeps(deps()));
    expect(out).toMatchObject({ ok: false, reason: "error", retryable: false });
    expect(db.rows("designs")).toHaveLength(1);
  });

  it("si la nueva falla por un dato que falta, la anterior sigue válida", async () => {
    const old = generationRow();
    const db = generationDb({ designs: [old] });
    const out = await createGeneration(db.client, input({ replaceExisting: true, overrides: {} }), asDeps(deps()));
    expect(out).toMatchObject({ ok: true, status: "failed" });
    expect(db.rows("designs").find((r) => r.id === old.id)?.status).toBe("ready");
  });

  it("una plantilla SIN verificación no tiene «una sola»: se genera otra cada vez", async () => {
    const db = generationDb({ template: { verify: false, doc_type: null }, designs: [generationRow()] });
    const out = await createGeneration(db.client, input(), asDeps(deps()));
    expect(out).toMatchObject({ ok: true, status: "queued" });
    expect(db.rows("designs")).toHaveLength(2);
  });
});

describe("createGeneration: publicar con link", () => {
  it("publica por el único camino (publishDesignCore) con el negocio y la pieza", async () => {
    const db = generationDb();
    const d = deps();
    const out = await createGeneration(db.client, input({ publish: true }), asDeps(d));
    if (!out.ok) throw new Error("no se generó");
    expect(d.publish).toHaveBeenCalledTimes(1);
    expect(d.publish.mock.calls[0].slice(1)).toEqual([{ workspaceId: WS, userId: USER }, { designId: out.designId }]);
  });

  it("sin pedirlo no publica, y la pieza no queda con `published` por su cuenta", async () => {
    const db = generationDb();
    const d = deps();
    await createGeneration(db.client, input({ publish: false }), asDeps(d));
    expect(d.publish).not.toHaveBeenCalled();
    expect(db.rows("designs")[0].published).toBe(false);
  });

  it("si publicar falla, la pieza queda creada igual", async () => {
    const db = generationDb();
    const d = deps();
    d.publish.mockRejectedValue(new Error("x"));
    expect(await createGeneration(db.client, input({ publish: true }), asDeps(d))).toMatchObject({ ok: true, status: "queued" });
  });
});

describe("createGeneration: nunca lanza y no cruza negocios", () => {
  it("una plantilla de otro negocio no existe", async () => {
    const db = generationDb({ template: { workspace_id: OTHER_WS } });
    expect(await createGeneration(db.client, input(), asDeps(deps()))).toEqual({ ok: false, reason: "error", error: "La plantilla ya no existe.", retryable: false });
  });

  it("un contacto de otro negocio no existe, y no se crea nada", async () => {
    const db = generationDb();
    const out = await createGeneration(db.client, input({ contactId: FOREIGN_CONTACT }), asDeps(deps()));
    expect(out).toEqual({ ok: false, reason: "error", error: "El contacto ya no existe.", retryable: false });
    expect(db.rows("designs")).toHaveLength(0);
  });

  it("un contacto borrado no existe", async () => {
    const db = generationDb({ contacts: [{ id: LUCIA, workspace_id: WS, display_name: "Lucía", deleted_at: "2026-11-01T00:00:00Z" }] });
    expect(await createGeneration(db.client, input(), asDeps(deps()))).toMatchObject({ ok: false, reason: "error", error: "El contacto ya no existe." });
  });

  it("una plantilla archivada no genera", async () => {
    const db = generationDb({ template: { archived_at: "2026-11-02T00:00:00Z" } });
    expect(await createGeneration(db.client, input(), asDeps(deps()))).toMatchObject({ ok: false, reason: "error", retryable: false });
  });

  it("un documento inválido de la plantilla no genera", async () => {
    const db = generationDb({ template: { doc: { v: 1, nada: true } } });
    expect(await createGeneration(db.client, input(), asDeps(deps()))).toMatchObject({ ok: false, reason: "error", error: "El documento de la plantilla no es válido." });
  });

  it("un error de la base al crear devuelve un error que se puede reintentar, sin lanzar", async () => {
    const db = generationDb();
    interceptFrom(db, (table, original) => {
      const builder = original(table) as { select: (c: string) => unknown };
      return table === "designs" ? { insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: "boom" } }) }) }), select: (c: string) => builder.select(c) } : builder;
    });
    const out = await createGeneration(db.client, input(), asDeps(deps()));
    expect(out).toMatchObject({ ok: false, reason: "error", retryable: true });
  });

  it("una excepción inesperada tampoco sale: queda como error reintentable", async () => {
    const db = generationDb();
    const d = deps();
    d.registered.mockRejectedValue(new Error("explotó"));
    expect(await createGeneration(db.client, input(), asDeps(d))).toMatchObject({ ok: false, reason: "error", retryable: true });
  });

  it("si no se puede encolar el render, la pieza queda fallida con un motivo claro para reintentar", async () => {
    const db = generationDb();
    const d = deps();
    d.enqueue.mockRejectedValue(new Error("cola caída"));
    const out = await createGeneration(db.client, input(), asDeps(d));
    expect(out).toMatchObject({ ok: true, status: "failed", missing: [] });
    expect(db.rows("designs")[0]).toMatchObject({ status: "failed", error: "No se pudo preparar el archivo. Tocá «Reintentar» para armarlo de nuevo." });
  });

  it("sin plantilla o sin negocio, no hace nada", async () => {
    const db = generationDb();
    expect(await createGeneration(db.client, input({ templateId: "" }), asDeps(deps()))).toMatchObject({ ok: false, reason: "error" });
    expect(db.rows("designs")).toHaveLength(0);
  });
});

describe("helpers", () => {
  it("generationName arma «Plantilla · Persona» y respeta el tope de 200", () => {
    expect(generationName("Certificado", "Ana Pérez")).toBe("Certificado · Ana Pérez");
    expect(generationName("Certificado", null)).toBe("Certificado");
    expect(generationName("  ", "Ana")).toBe("Pieza · Ana");
    expect(generationName("x".repeat(300), "Ana")).toHaveLength(200);
  });

  it("findValidForContacts devuelve la más reciente válida por persona y deja afuera las anuladas", async () => {
    const recent = generationRow({ subject_contact_id: LUCIA, created_at: "2026-11-07T12:00:00.000Z" });
    const older = generationRow({ subject_contact_id: LUCIA, created_at: "2026-10-01T12:00:00.000Z" });
    const voided = generationRow({ subject_contact_id: DIEGO, status: "void", void_reason: "x" });
    const db = generationDb({ designs: [older, recent, voided] });
    const found = await findValidForContacts(db.client, WS, TEMPLATE, [LUCIA, DIEGO, TOMAS]);
    expect([...found.keys()]).toEqual([LUCIA]);
    expect(found.get(LUCIA)?.designId).toBe(recent.id);
  });
});
