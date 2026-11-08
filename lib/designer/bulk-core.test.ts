import { describe, expect, it, vi } from "vitest";
import { blockersMessage, countGenerationAudienceCore, generateManyCore, parseAudienceQuery, resolveContactAudience, type BulkDeps, type BulkEnv } from "./bulk-core";
import { MAX_GENERATE_MANY } from "./jobs/generate-many";
import { DIEGO, LUCIA, OTHER_WS, TEMPLATE, TOMAS, USER, WS, generationDb, generationRow, templateDoc } from "./testing/generation-fixtures";

const NOW = new Date("2026-11-08T02:00:00.000Z");
const BATCH = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

/** Una plantilla que se arma con los datos del contacto: sirve «para varios» (nada propio que completar a mano). */
const BULK_TEMPLATE = { doc: templateDoc("Se otorga el presente a {{contact.display_name}} · {{design.issued_on}} · {{design.code}}"), custom_vars: [] };

const envOf = (db: ReturnType<typeof generationDb>): BulkEnv => ({ service: db.client, user: db.client, workspaceId: WS, userId: USER, timeZone: "America/Argentina/Buenos_Aires" });

function deps(ids: string[], total = ids.length) {
  return {
    audience: vi.fn(async (..._a: unknown[]) => ({ ids, total })),
    schedule: vi.fn(async (..._a: unknown[]) => ({ id: "j1" })),
    now: () => NOW,
    newBatchId: () => BATCH,
  };
}
const asDeps = (d: ReturnType<typeof deps>) => d as unknown as BulkDeps;

describe("los filtros de Contactos como parámetros de URL", () => {
  it("lee los repetidos como lista y se queda solo con las claves de los filtros", () => {
    const out = parseAudienceQuery("?tag=a&tag=b&q=Ana&inventada=1");
    expect(out.q).toBe("Ana");
    expect(out.inventada).toBeUndefined();
    expect(out.tag).toEqual(["a", "b"]);
  });

  it("lo que no es texto o es larguísimo es «sin filtros»", () => {
    expect(parseAudienceQuery(undefined)).toEqual({});
    expect(parseAudienceQuery({ q: "x" })).toEqual({});
    expect(parseAudienceQuery(`q=${"x".repeat(5000)}`)).toEqual({});
  });
});

describe("countGenerationAudience (F51)", () => {
  it("«N cumplen · M ya tienen uno válido»; con «saltear» prendida, esos no se generan", async () => {
    const db = generationDb({ template: BULK_TEMPLATE, designs: [generationRow({ subject_contact_id: LUCIA })] });
    const d = deps([LUCIA, DIEGO, TOMAS]);
    const skip = await countGenerationAudienceCore(envOf(db), { templateId: TEMPLATE, audienceParams: "tag=cohorte", skipExisting: true }, asDeps(d));
    expect(skip).toEqual({ ok: true, data: { total: 3, existing: 1, willGenerate: 2, limit: MAX_GENERATE_MANY, over: false, blockers: [] } });
    const noSkip = await countGenerationAudienceCore(envOf(db), { templateId: TEMPLATE, audienceParams: "tag=cohorte", skipExisting: false }, asDeps(d));
    expect(noSkip).toMatchObject({ ok: true, data: { total: 3, existing: 1, willGenerate: 3 } });
  });

  it("una anulada o fallida no cuenta como «ya tiene uno válido»", async () => {
    const db = generationDb({ template: BULK_TEMPLATE, designs: [generationRow({ status: "void", void_reason: "x" }), generationRow({ status: "failed", error: "x", subject_contact_id: DIEGO })] });
    const out = await countGenerationAudienceCore(envOf(db), { templateId: TEMPLATE, audienceParams: "", skipExisting: true }, asDeps(deps([LUCIA, DIEGO])));
    expect(out).toMatchObject({ ok: true, data: { existing: 0, willGenerate: 2 } });
  });

  it("avisa cuando son más de los que entran en una tanda", async () => {
    const ids = Array.from({ length: MAX_GENERATE_MANY }, (_, i) => `c${i}`);
    const out = await countGenerationAudienceCore(envOf(generationDb({ template: BULK_TEMPLATE })), { templateId: TEMPLATE, audienceParams: "", skipExisting: false }, asDeps(deps(ids, 1200)));
    expect(out).toMatchObject({ ok: true, data: { total: 1200, over: true, limit: 500 } });
  });

  it("avisa qué datos propios impiden generar para varios (sin valor por defecto, ninguno de la tanda lo tiene)", async () => {
    const db = generationDb();
    const out = await countGenerationAudienceCore(envOf(db), { templateId: TEMPLATE, audienceParams: "", skipExisting: false }, asDeps(deps([LUCIA])));
    expect(out).toMatchObject({ ok: true, data: { blockers: ["Nombre como lo quiere en el certificado"] } });
    expect(blockersMessage(["A", "B"])).toBe("Estos datos de la plantilla no tienen un valor por defecto: A, B. Poné uno en la plantilla, o generá de a una pieza.");
  });

  it("una plantilla de otro negocio o archivada no se cuenta", async () => {
    expect(await countGenerationAudienceCore(envOf(generationDb({ template: { ...BULK_TEMPLATE, workspace_id: OTHER_WS } })), { templateId: TEMPLATE, audienceParams: "", skipExisting: false }, asDeps(deps([LUCIA])))).toEqual({ ok: false, error: "La plantilla ya no existe." });
    expect(await countGenerationAudienceCore(envOf(generationDb({ template: { ...BULK_TEMPLATE, archived_at: "2026-11-01T00:00:00Z" } })), { templateId: TEMPLATE, audienceParams: "", skipExisting: false }, asDeps(deps([LUCIA])))).toMatchObject({ ok: false });
  });

  it("no lanza si la audiencia falla", async () => {
    const d = deps([]);
    d.audience.mockRejectedValue(new Error("boom"));
    expect(await countGenerationAudienceCore(envOf(generationDb({ template: BULK_TEMPLATE })), { templateId: TEMPLATE, audienceParams: "", skipExisting: false }, asDeps(d))).toEqual({ ok: false, error: "No pudimos contar a quiénes les toca. Probá de nuevo." });
  });
});

describe("generateMany (F51)", () => {
  const base = { templateId: TEMPLATE, audienceParams: "tag=cohorte", skipExisting: true, publish: true };

  it("con 3 contactos, uno con pieza válida y «saltear» prendida, encola para 2 (el job recibe la audiencia fijada)", async () => {
    const db = generationDb({ template: BULK_TEMPLATE, designs: [generationRow({ subject_contact_id: LUCIA })] });
    const d = deps([LUCIA, DIEGO, TOMAS]);
    const out = await generateManyCore(envOf(db), base, asDeps(d));
    expect(out).toEqual({ ok: true, data: { queued: 2 } });
    expect(d.schedule).toHaveBeenCalledTimes(1);
    const [, type, payload, at, key] = d.schedule.mock.calls[0] as [unknown, string, Record<string, unknown>, Date, string];
    expect(type).toBe("design_generate_many");
    expect(payload).toEqual({ workspaceId: WS, templateId: TEMPLATE, batchId: BATCH, userId: USER, contactIds: [LUCIA, DIEGO, TOMAS], skipExisting: true, publish: true, email: null, offset: 0, attempt: 0 });
    expect(at).toEqual(NOW);
    expect(key).toBe(`design_generate_many:${BATCH}:0`);
    // La acción no crea piezas: las crea el job.
    expect(db.rows("designs")).toHaveLength(1);
  });

  it("con el email pedido, viaja al job", async () => {
    const d = deps([LUCIA]);
    await generateManyCore(envOf(generationDb({ template: BULK_TEMPLATE })), { ...base, email: { subject: "Tu certificado", body: "Acá: {{design.link}}" } }, asDeps(d));
    expect((d.schedule.mock.calls[0][2] as { email: unknown }).email).toEqual({ subject: "Tu certificado", body: "Acá: {{design.link}}" });
  });

  it("un email mal armado se rechaza antes de encolar", async () => {
    const d = deps([LUCIA]);
    expect(await generateManyCore(envOf(generationDb({ template: BULK_TEMPLATE })), { ...base, email: { subject: "", body: "x" } }, asDeps(d))).toEqual({ ok: false, error: "Escribí el asunto del email." });
    expect(d.schedule).not.toHaveBeenCalled();
  });

  it("sin contactos con esos filtros, lo dice", async () => {
    const d = deps([]);
    expect(await generateManyCore(envOf(generationDb({ template: BULK_TEMPLATE })), base, asDeps(d))).toEqual({ ok: false, error: "No hay contactos con esos filtros." });
    expect(d.schedule).not.toHaveBeenCalled();
  });

  it("el máximo es 500 por tanda", async () => {
    const d = deps(Array.from({ length: 500 }, (_, i) => `c${i}`), 501);
    const out = await generateManyCore(envOf(generationDb({ template: BULK_TEMPLATE })), base, asDeps(d));
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining("el máximo es 500") });
    expect(d.schedule).not.toHaveBeenCalled();
    const exactly = deps(Array.from({ length: 500 }, (_, i) => `c${i}`), 500);
    expect(await generateManyCore(envOf(generationDb({ template: BULK_TEMPLATE })), { ...base, skipExisting: false }, asDeps(exactly))).toEqual({ ok: true, data: { queued: 500 } });
  });

  it("si todos ya tienen una válida y se saltean, no hay nada que generar", async () => {
    const db = generationDb({ template: BULK_TEMPLATE, designs: [generationRow({ subject_contact_id: LUCIA })] });
    const d = deps([LUCIA]);
    expect(await generateManyCore(envOf(db), base, asDeps(d))).toEqual({ ok: false, error: "Todos ya tienen una pieza válida: no hay nada para generar." });
    expect(d.schedule).not.toHaveBeenCalled();
  });

  it("con un dato propio sin valor por defecto no se encola (todas saldrían fallidas)", async () => {
    const d = deps([LUCIA]);
    const out = await generateManyCore(envOf(generationDb()), base, asDeps(d));
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining("Nombre como lo quiere en el certificado") });
    expect(d.schedule).not.toHaveBeenCalled();
  });

  it("repite un contacto una sola vez", async () => {
    const d = deps([LUCIA, LUCIA, DIEGO]);
    const out = await generateManyCore(envOf(generationDb({ template: BULK_TEMPLATE })), { ...base, skipExisting: false }, asDeps(d));
    expect(out).toEqual({ ok: true, data: { queued: 2 } });
    expect((d.schedule.mock.calls[0][2] as { contactIds: string[] }).contactIds).toEqual([LUCIA, DIEGO]);
  });

  it("una plantilla de otro negocio no se genera", async () => {
    const d = deps([LUCIA]);
    expect(await generateManyCore(envOf(generationDb({ template: { ...BULK_TEMPLATE, workspace_id: OTHER_WS } })), base, asDeps(d))).toEqual({ ok: false, error: "La plantilla ya no existe." });
  });

  it("nunca lanza: si no se puede agendar, devuelve un error", async () => {
    const d = deps([LUCIA]);
    d.schedule.mockRejectedValue(new Error("cola caída"));
    expect(await generateManyCore(envOf(generationDb({ template: BULK_TEMPLATE })), base, asDeps(d))).toEqual({ ok: false, error: "No se pudo preparar la tanda. Probá de nuevo." });
  });
});

describe("resolveContactAudience: los mismos filtros de Contactos, con el cliente de la persona", () => {
  it("lee los contactos con el planificador de Contactos y devuelve los ids y el total", async () => {
    const db = generationDb({
      contacts: [
        { id: LUCIA, workspace_id: WS, display_name: "Lucía Ferreyra", email: "lucia@ejemplo.com", phone: null, deleted_at: null, is_anonymous: false },
        { id: DIEGO, workspace_id: WS, display_name: "Diego Salas", email: null, phone: "+5491155550002", deleted_at: null, is_anonymous: false },
        { id: TOMAS, workspace_id: WS, display_name: "Tomás Ruiz", email: null, phone: null, deleted_at: "2026-11-01T00:00:00Z", is_anonymous: false },
      ],
    });
    const out = await resolveContactAudience(envOf(db), {}, NOW);
    expect(out.ids.sort()).toEqual([DIEGO, LUCIA].sort());
    expect(out.total).toBe(2);
  });
});
