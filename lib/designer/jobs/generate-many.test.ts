import { describe, expect, it, vi } from "vitest";
import { createGeneration, type CreateGenerationResult, type GenerationDeps } from "../generate-core";
import { DIEGO, LUCIA, TEMPLATE, TOMAS, USER, WS, generationDb, generationRow, interceptFrom, templateDoc } from "../testing/generation-fixtures";
import { GENERATE_MANY_RETRY_MS, parseGenerateManyPayload, runGenerateMany, type GenerateManyDeps, type GenerateManyPayload } from "./generate-many";

const BATCH = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const NOW = new Date("2026-11-08T02:00:00.000Z");
const BULK_TEMPLATE = { doc: templateDoc("Se otorga el presente a {{contact.display_name}} · {{design.issued_on}} · {{design.code}}"), custom_vars: [] };

const payload = (over: Partial<GenerateManyPayload> = {}): GenerateManyPayload => ({
  workspaceId: WS,
  templateId: TEMPLATE,
  batchId: BATCH,
  userId: USER,
  contactIds: [LUCIA, DIEGO, TOMAS],
  skipExisting: true,
  publish: false,
  email: null,
  offset: 0,
  attempt: 0,
  ...over,
});

function deps(over: Partial<GenerateManyDeps> = {}) {
  const spies = {
    now: vi.fn(() => NOW),
    enqueue: vi.fn(async (..._a: unknown[]) => undefined),
    publish: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { link: "x" } })),
    notify: vi.fn(async (..._a: unknown[]) => true),
    audit: vi.fn(async (..._a: unknown[]) => "a1" as string | null),
    registered: vi.fn(async () => ({})),
    members: vi.fn(async (..._a: unknown[]) => [] as string[]),
    schedule: vi.fn(async (..._a: unknown[]) => ({ id: "j" })),
  };
  return { ...spies, ...over } as typeof spies & GenerateManyDeps;
}

const run = (db: ReturnType<typeof generationDb>, p: object, d: ReturnType<typeof deps>) => runGenerateMany(db.client, p as Record<string, unknown>, d as unknown as GenerateManyDeps);
const batchRows = (db: ReturnType<typeof generationDb>) => db.rows("designs").filter((r) => (r.source_ref as { batch_id?: string } | null)?.batch_id === BATCH);

describe("el job «Generar para varios» (F51)", () => {
  it("con 3 contactos, uno con pieza válida y «saltear» prendida, genera 2 y cada una queda en cola con su render", async () => {
    const db = generationDb({ template: BULK_TEMPLATE, designs: [generationRow({ subject_contact_id: LUCIA })] });
    const d = deps();
    const out = await run(db, payload(), d);
    expect(out).toEqual({ status: "done", created: 2, failed: 0, skipped: 1, errors: 0, retrying: 0 });
    const rows = batchRows(db);
    expect(rows.map((r) => r.subject_contact_id).sort()).toEqual([DIEGO, TOMAS].sort());
    for (const row of rows) expect(row).toMatchObject({ status: "queued", source: "bulk", source_ref: { kind: "bulk", batch_id: BATCH, user_id: USER }, created_by: USER });
    expect(d.enqueue).toHaveBeenCalledTimes(2);
    expect(d.schedule).not.toHaveBeenCalled();
  });

  it("sin «saltear», una plantilla con verificación reemplaza la anterior: una sola válida por persona", async () => {
    const old = generationRow({ subject_contact_id: LUCIA });
    const db = generationDb({ template: BULK_TEMPLATE, designs: [old] });
    const out = await run(db, payload({ skipExisting: false }), deps());
    expect(out).toMatchObject({ status: "done", created: 3, skipped: 0 });
    expect(db.rows("designs").find((r) => r.id === old.id)?.status).toBe("void");
    expect(db.rows("designs").filter((r) => r.subject_contact_id === LUCIA && r.status !== "void")).toHaveLength(1);
  });

  it("publica con link, manda lo pedido de email (queda guardado para cuando esté lista) y pasa quién lo pidió", async () => {
    const db = generationDb({ template: BULK_TEMPLATE });
    const d = deps();
    await run(db, payload({ publish: true, email: { subject: "Tu certificado", body: "Acá: {{design.link}}" }, contactIds: [LUCIA] }), d);
    expect(d.publish).toHaveBeenCalledTimes(1);
    expect((batchRows(db)[0].source_ref as { email_request: unknown }).email_request).toEqual({ subject: "Tu certificado", body: "Acá: {{design.link}}" });
  });

  it("si la cola corre el job dos veces, no genera dos certificados (se fija en lo que ya hizo el lote)", async () => {
    const db = generationDb({ template: BULK_TEMPLATE });
    const d = deps();
    await run(db, payload({ skipExisting: false }), d);
    expect(batchRows(db)).toHaveLength(3);
    const again = await run(db, payload({ skipExisting: false }), d);
    expect(again).toMatchObject({ status: "done", created: 0, skipped: 3 });
    expect(batchRows(db)).toHaveLength(3);
    expect(d.enqueue).toHaveBeenCalledTimes(3);
  });

  it("en tandas de 10, con tiempo límite: lo que no entra queda para una vuelta siguiente (con su offset y su clave)", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `c0000100-1111-4111-8111-${String(i).padStart(12, "0")}`);
    const db = generationDb({
      template: BULK_TEMPLATE,
      contacts: ids.map((id, i) => ({ id, workspace_id: WS, display_name: `Persona ${i}`, email: null, phone: null, deleted_at: null })),
    });
    let clock = NOW.getTime();
    const d = deps({ now: () => new Date((clock += 30_000)) });
    const first = await run(db, payload({ contactIds: ids, skipExisting: false }), d);
    // La primera tanda siempre entra; con 30 s por lectura del reloj solo caben dos antes de pasar los 40 s.
    expect(first.status).toBe("continued");
    const made = batchRows(db).length;
    expect(made).toBeGreaterThanOrEqual(10);
    expect(made).toBeLessThan(25);
    expect(d.schedule).toHaveBeenCalledTimes(1);
    const [, type, next, , key] = d.schedule.mock.calls[0] as [unknown, string, GenerateManyPayload, Date, string];
    expect(type).toBe("design_generate_many");
    expect(next.offset).toBe(made);
    expect(next.contactIds).toEqual(ids);
    expect(key).toBe(`design_generate_many:${BATCH}:${made}`);
    // Y la vuelta siguiente termina el resto sin repetir a nadie.
    clock = NOW.getTime();
    const second = await run(db, next as unknown as Record<string, unknown>, deps({ now: () => NOW }));
    expect(second.status).toBe("done");
    expect(batchRows(db)).toHaveLength(25);
    expect(new Set(batchRows(db).map((r) => r.subject_contact_id)).size).toBe(25);
  });

  it("un error que se arregla reintentando deja a ESE contacto para después (1 min), y el resto sigue", async () => {
    const db = generationDb({ template: BULK_TEMPLATE });
    const d = deps();
    const create = vi.fn(async (client: Parameters<typeof createGeneration>[0], input: Parameters<typeof createGeneration>[1], gd?: GenerationDeps): Promise<CreateGenerationResult> => {
      if (input.contactId === DIEGO) return { ok: false, reason: "error", error: "la base se cayó", retryable: true };
      return createGeneration(client, input, gd);
    });
    const out = await run(db, payload({ skipExisting: false }), { ...d, create } as never);
    expect(out).toMatchObject({ status: "done", created: 2, retrying: 1, errors: 0 });
    expect(d.schedule).toHaveBeenCalledTimes(1);
    const [, , next, at, key] = d.schedule.mock.calls[0] as [unknown, string, GenerateManyPayload, Date, string];
    expect(next).toMatchObject({ contactIds: [DIEGO], offset: 0, attempt: 1 });
    expect(at.getTime()).toBe(NOW.getTime() + GENERATE_MANY_RETRY_MS[0]);
    expect(key).toBe(`design_generate_many:${BATCH}:r1`);
  });

  it("tras tres pasadas deja de reintentar y lo cuenta como error", async () => {
    const db = generationDb({ template: BULK_TEMPLATE });
    const d = deps();
    const create = vi.fn(async (): Promise<CreateGenerationResult> => ({ ok: false, reason: "error", error: "x", retryable: true }));
    const out = await run(db, payload({ contactIds: [DIEGO], attempt: 3 }), { ...d, create } as never);
    expect(out).toMatchObject({ created: 0, retrying: 0, errors: 1 });
    expect(d.schedule).not.toHaveBeenCalled();
  });

  it("un error que no se arregla (el contacto ya no existe) no frena a los demás", async () => {
    const db = generationDb({ template: BULK_TEMPLATE, contacts: [{ id: LUCIA, workspace_id: WS, display_name: "Lucía", deleted_at: null }, { id: TOMAS, workspace_id: WS, display_name: "Tomás", deleted_at: null }] });
    const out = await run(db, payload({ skipExisting: false }), deps());
    expect(out).toMatchObject({ status: "done", created: 2, errors: 1, retrying: 0 });
  });

  it("lo que falta de datos queda como pieza fallida con su motivo (y avisa), sin frenar al resto", async () => {
    // Esta plantilla pide el email del contacto en el texto: Tomás no tiene.
    const db = generationDb({ template: { doc: templateDoc("Para {{contact.display_name}} ({{contact.email}})"), custom_vars: [] } });
    const d = deps();
    const out = await run(db, payload({ skipExisting: false }), d);
    expect(out).toMatchObject({ status: "done", created: 2, failed: 1 });
    expect(batchRows(db).find((r) => r.subject_contact_id === TOMAS)).toMatchObject({ status: "failed", error: "Falta: Email" });
    expect(d.notify).toHaveBeenCalledTimes(1);
  });

  it("si no puede revisar qué se hizo en el lote, no genera nada (duplicaría) y se repite más tarde", async () => {
    const db = generationDb({ template: BULK_TEMPLATE });
    interceptFrom(db, (table, original) => {
      const builder = original(table) as { select: (...a: unknown[]) => unknown };
      if (table !== "designs") return builder;
      return { ...builder, select: () => ({ eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) }) }) };
    });
    const d = deps();
    const out = await run(db, payload(), d);
    expect(out).toMatchObject({ status: "continued", created: 0 });
    expect(db.rows("designs")).toHaveLength(0);
    const [, , next, at] = d.schedule.mock.calls[0] as [unknown, string, GenerateManyPayload, Date];
    expect(next.attempt).toBe(1);
    expect(at.getTime()).toBe(NOW.getTime() + GENERATE_MANY_RETRY_MS[0]);
  });

  it("un reagendado que ya estaba pendiente (clave repetida) no es un error", async () => {
    const db = generationDb({ template: BULK_TEMPLATE });
    const d = deps();
    d.schedule.mockRejectedValue(Object.assign(new Error("dup"), { code: "23505" }));
    const create = vi.fn(async (): Promise<CreateGenerationResult> => ({ ok: false, reason: "error", error: "x", retryable: true }));
    const out = await run(db, payload({ contactIds: [DIEGO] }), { ...d, create } as never);
    expect(out).toMatchObject({ retrying: 1, errors: 0 });
  });

  it("nunca lanza: un job con datos que no tienen la forma esperada se descarta anotado", async () => {
    const db = generationDb({ template: BULK_TEMPLATE });
    expect(await run(db, { workspaceId: "no-es-uuid" }, deps())).toEqual({ status: "invalid" });
    expect(await run(db, { ...payload(), contactIds: "x" }, deps())).toEqual({ status: "invalid" });
    expect(await run(db, { ...payload(), contactIds: Array.from({ length: 501 }, (_, i) => `c0000100-1111-4111-8111-${String(i).padStart(12, "0")}`) }, deps())).toEqual({ status: "invalid" });
  });
});

describe("parseGenerateManyPayload", () => {
  it("acepta lo que arma la acción y se queda con ids válidos, sin repetir", () => {
    expect(parseGenerateManyPayload({ ...payload(), contactIds: [LUCIA, LUCIA, "no-es-uuid", DIEGO] })?.contactIds).toEqual([LUCIA, DIEGO]);
  });

  it("lo que no se entiende toma el valor de siempre", () => {
    const p = parseGenerateManyPayload({ ...payload(), offset: -3, attempt: "x", email: { subject: 1 }, skipExisting: "si", userId: "nadie" });
    expect(p).toMatchObject({ offset: 0, attempt: 0, email: null, skipExisting: false, userId: null });
  });
});
