import { beforeEach, describe, expect, it, vi } from "vitest";

const T = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const C = "c0000001-1111-4111-8111-cccccccccccc";
const D = "d0000001-1111-4111-8111-dddddddddddd";

const { getPermissionAction, createServiceClient, revalidatePath, ops, bulk, email, query, filterOptions } = vi.hoisted(() => ({
  getPermissionAction: vi.fn(),
  createServiceClient: vi.fn(async () => ({ servicio: true })),
  revalidatePath: vi.fn(),
  ops: {
    previewGenerationCore: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { values: {}, missing: [], existingValid: null } })),
    generateOneCore: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { designId: "d", code: "K8F2-WQ4M-7TQA", link: "https://x.test/d/K8F2-WQ4M-7TQA", status: "queued" as const } })),
    retryGenerationCore: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: {} })),
    retryFailedGenerationsCore: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { retried: 1, needData: 0 } })),
    regenerateCore: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { designId: "d2", code: "K8F2-WQ4M-7TQB" } })),
  },
  bulk: {
    countGenerationAudienceCore: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { total: 3, existing: 1, willGenerate: 2, limit: 500, over: false, blockers: [] } })),
    generateManyCore: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { queued: 2 } })),
  },
  email: { sendGenerationEmailCore: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { to: "a@b.co" } })) },
  filterOptions: { loadContactFilterOptions: vi.fn(async (..._a: unknown[]) => ({ options: { tag: [] }, customFields: [], hasAnonymous: false })) },
  query: {
    loadManyContextCore: vi.fn(async (..._a: unknown[]) => ({ template: { id: "t", name: "T", verify: true, docType: "certificado", docTypeLabel: null, noun: "certificado", archived: false } })),
    listGenerationsCore: vi.fn(async (..._a: unknown[]) => ({ rows: [], counts: {}, total: 0, page: 1, pages: 1, polling: false, template: {} })),
    generationDetailCore: vi.fn(async (..._a: unknown[]) => ({ id: "d" })),
    loadGenerateContextCore: vi.fn(async (..._a: unknown[]) => ({ template: { id: "t" } })),
    searchContactsCore: vi.fn(async (..._a: unknown[]) => []),
  },
}));

vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: (key: string) => getPermissionAction(key) }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => createServiceClient() }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/user-timezone", () => ({ resolveViewerTimezone: async (tz: string | null) => tz ?? "UTC" }));
vi.mock("@/lib/designer/generate-ops", () => ops);
vi.mock("@/lib/designer/bulk-core", () => bulk);
vi.mock("@/lib/designer/generation-email", () => email);
vi.mock("@/lib/designer/generations-query", () => query);
vi.mock("@/lib/contacts/filter-options-load", () => filterOptions);

import { countGenerationAudience, generateMany, generateOne, previewGeneration, regenerate, retryFailedGenerations, retryGeneration, sendGenerationEmail } from "./generate";
import { generationDetail, listGenerations, loadGenerateContext, loadGenerateManyContext, searchGenerateContacts } from "./generations";

/** Los contactos que la PERSONA ve con su sesión (la RLS de `contacts`); por defecto, todos. */
let visibleContacts: ((id: string) => boolean) = () => true;
const personaClient = {
  persona: true,
  from: () => {
    const filters: Record<string, unknown> = {};
    const chain = {
      select: () => chain,
      eq: (col: string, val: unknown) => ((filters[col] = val), chain),
      maybeSingle: async () => ({ data: visibleContacts(String(filters.id)) ? { id: filters.id } : null, error: null }),
    };
    return chain;
  },
};
const session = {
  workspace: { id: "ws-de-la-sesion", timezone: "America/Argentina/Buenos_Aires", custom_domain: null },
  user: { id: "user-de-la-sesion" },
  supabase: personaClient,
  can: (key: string) => ["designer.generate", "designer.view"].includes(key),
};

beforeEach(() => {
  vi.clearAllMocks();
  visibleContacts = () => true;
  getPermissionAction.mockResolvedValue(session);
});

describe("el alcance de leads (auditoría Ola 3)", () => {
  it("un contacto que la persona no ve con su sesión: ni vista previa ni generación, y el núcleo no se toca", async () => {
    visibleContacts = () => false;
    const err = { ok: false, error: "No encontramos ese contacto." };
    expect(await previewGeneration({ templateId: T, contactId: C, overrides: {} })).toEqual(err);
    expect(await generateOne({ templateId: T, contactId: C, overrides: {}, publish: true })).toEqual(err);
    expect(ops.previewGenerationCore).not.toHaveBeenCalled();
    expect(ops.generateOneCore).not.toHaveBeenCalled();
  });
});

describe("las acciones de generar piden designer.generate", () => {
  it("sin el permiso responden «No tenés permiso» y no tocan nada", async () => {
    getPermissionAction.mockResolvedValue(null);
    const denied = { ok: false, error: "No tenés permiso para generar piezas." };
    expect(await previewGeneration({ templateId: T, contactId: C, overrides: {} })).toEqual(denied);
    expect(await generateOne({ templateId: T, contactId: C, overrides: {}, publish: true })).toEqual(denied);
    expect(await countGenerationAudience({ templateId: T, audienceParams: "", skipExisting: true })).toEqual(denied);
    expect(await generateMany({ templateId: T, audienceParams: "", skipExisting: true, publish: true })).toEqual(denied);
    expect(await retryGeneration({ designId: D })).toEqual(denied);
    expect(await retryFailedGenerations({ templateId: T })).toEqual(denied);
    expect(await regenerate({ designId: D })).toEqual(denied);
    expect(await sendGenerationEmail({ designId: D })).toEqual(denied);
    for (const fn of [...Object.values(ops), ...Object.values(bulk), ...Object.values(email)]) expect(fn).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(new Set(getPermissionAction.mock.calls.map((c) => c[0]))).toEqual(new Set(["designer.generate"]));
  });

  it("el negocio y la persona son los de la sesión, aunque el navegador mande otros", async () => {
    await generateOne({ templateId: T, contactId: C, overrides: {}, publish: false, workspaceId: "otro-negocio", userId: "otra-persona" } as never);
    expect(ops.generateOneCore).toHaveBeenCalledWith({ service: { servicio: true }, workspaceId: "ws-de-la-sesion", userId: "user-de-la-sesion" }, expect.not.objectContaining({ workspaceId: "otro-negocio" }));
    expect(JSON.stringify(ops.generateOneCore.mock.calls[0])).not.toContain("otro-negocio");
    await regenerate({ designId: D });
    expect(ops.regenerateCore).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "ws-de-la-sesion" }), { designId: D });
    await retryGeneration({ designId: D, values: { nombre: "Ana" } });
    expect(ops.retryGenerationCore).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "ws-de-la-sesion", userId: "user-de-la-sesion" }), { designId: D, values: { nombre: "Ana" } });
  });

  it("para varios, los contactos se leen con el cliente de la PERSONA (la RLS decide) y las piezas se escriben con el de servicio", async () => {
    await countGenerationAudience({ templateId: T, audienceParams: "tag=cohorte", skipExisting: true });
    expect(bulk.countGenerationAudienceCore).toHaveBeenCalledWith({ service: { servicio: true }, user: personaClient, workspaceId: "ws-de-la-sesion", userId: "user-de-la-sesion", timeZone: "America/Argentina/Buenos_Aires" }, { templateId: T, audienceParams: "tag=cohorte", skipExisting: true });
    await generateMany({ templateId: T, audienceParams: "tag=cohorte", skipExisting: true, publish: true, email: { subject: "x", body: "y" } });
    expect(bulk.generateManyCore).toHaveBeenCalledWith(expect.objectContaining({ user: personaClient, service: { servicio: true } }), expect.objectContaining({ email: { subject: "x", body: "y" } }));
  });

  it("revisa la forma de lo que manda el navegador antes de hacer nada", async () => {
    const bad = { ok: false, error: "El pedido no es válido." };
    expect(await previewGeneration({ templateId: "no-es-uuid", contactId: C, overrides: {} })).toEqual(bad);
    expect(await generateOne({ templateId: T, contactId: "x", overrides: {}, publish: true })).toEqual(bad);
    expect(await generateOne({ templateId: T, contactId: C, overrides: { a: 5 as never }, publish: true })).toEqual(bad);
    expect(await generateOne({ templateId: T, contactId: C, overrides: {}, publish: "si" as never })).toEqual(bad);
    expect(await generateMany({ templateId: T, audienceParams: "x".repeat(5000), skipExisting: true, publish: true })).toEqual(bad);
    expect(await retryGeneration({ designId: "x" })).toEqual(bad);
    expect(await regenerate({ designId: "x" })).toEqual(bad);
    expect(await sendGenerationEmail({ designId: D, body: "x".repeat(20_000) })).toEqual(bad);
    for (const fn of [...Object.values(ops), ...Object.values(bulk), ...Object.values(email)]) expect(fn).not.toHaveBeenCalled();
  });

  it("al generar bien, refresca la pestaña de Generaciones de esa plantilla", async () => {
    await generateOne({ templateId: T, contactId: C, overrides: {}, publish: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/disenos/t/${T}`);
    revalidatePath.mockClear();
    ops.generateOneCore.mockResolvedValueOnce({ ok: false, error: "Falta: algo" } as never);
    await generateOne({ templateId: T, contactId: C, overrides: {}, publish: true });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("mandar el email usa el negocio de la sesión y pasa lo que se editó", async () => {
    expect(await sendGenerationEmail({ designId: D, subject: "Tu certificado", body: "Acá" })).toEqual({ ok: true, data: undefined });
    expect(email.sendGenerationEmailCore).toHaveBeenCalledWith({ servicio: true }, { workspaceId: "ws-de-la-sesion", userId: "user-de-la-sesion", designId: D, subject: "Tu certificado", body: "Acá" });
    email.sendGenerationEmailCore.mockResolvedValueOnce({ ok: false, error: "El contacto no tiene email" } as never);
    expect(await sendGenerationEmail({ designId: D })).toEqual({ ok: false, error: "El contacto no tiene email" });
  });
});

describe("las lecturas de la pestaña Generaciones", () => {
  it("la lista y el detalle piden designer.view y leen con el cliente de la persona, con el negocio de la sesión", async () => {
    const out = await listGenerations({ templateId: T, estado: "fallidas", q: "Ana", pagina: 2 });
    expect(out.ok).toBe(true);
    expect(getPermissionAction).toHaveBeenCalledWith("designer.view");
    const [client, input] = query.listGenerationsCore.mock.calls[0] as [unknown, { workspaceId: string; templateId: string; filters: unknown; can: { generate: boolean }; linkFor: (code: string) => string }];
    expect(client).toEqual(personaClient);
    expect(input).toMatchObject({ workspaceId: "ws-de-la-sesion", templateId: T, filters: { estado: "fallidas", q: "Ana", page: 2 }, can: { generate: true } });
    // El link sale del dominio del negocio, no del navegador.
    expect(input.linkFor("K8F2-WQ4M-7TQA")).toMatch(/^https?:\/\/.+\/d\/K8F2-WQ4M-7TQA$/);
    await generationDetail({ designId: D });
    expect(query.generationDetailCore).toHaveBeenCalledWith(personaClient, expect.objectContaining({ workspaceId: "ws-de-la-sesion", designId: D, can: { generate: true } }));
  });

  it("sin designer.view no se lee nada", async () => {
    getPermissionAction.mockResolvedValue(null);
    expect(await listGenerations({ templateId: T })).toEqual({ ok: false, error: "No tenés permiso para ver esto." });
    expect(await generationDetail({ designId: D })).toEqual({ ok: false, error: "No tenés permiso para ver esto." });
    expect(query.listGenerationsCore).not.toHaveBeenCalled();
  });

  it("un valor raro en la URL (estado inventado, página negativa) no rompe: vuelve al valor de siempre o se rechaza", async () => {
    await listGenerations({ templateId: T, estado: "inventado" });
    expect((query.listGenerationsCore.mock.calls[0][1] as { filters: unknown }).filters).toEqual({ estado: "todas", q: "", page: 1 });
    expect(await listGenerations({ templateId: "no", estado: "todas" })).toEqual({ ok: false, error: "El pedido no es válido." });
    expect(await listGenerations({ templateId: T, pagina: -2 })).toEqual({ ok: false, error: "El pedido no es válido." });
  });

  it("una plantilla que no existe (o no se ve) responde con un mensaje, no con un error", async () => {
    query.listGenerationsCore.mockResolvedValueOnce(null as never);
    expect(await listGenerations({ templateId: T })).toEqual({ ok: false, error: "No encontramos esa plantilla." });
    query.generationDetailCore.mockResolvedValueOnce(null as never);
    expect(await generationDetail({ designId: D })).toEqual({ ok: false, error: "No encontramos esa pieza." });
  });

  it("si la lectura falla, devuelve un error en español y no lanza", async () => {
    query.listGenerationsCore.mockRejectedValueOnce(new Error("boom"));
    expect(await listGenerations({ templateId: T })).toEqual({ ok: false, error: "No pudimos cargar las generaciones. Probá de nuevo." });
  });

  it("«Generar para varios» trae la plantilla y las opciones de los filtros de Contactos, con la sesión de la persona", async () => {
    const out = await loadGenerateManyContext({ templateId: T });
    expect(out).toMatchObject({ ok: true, data: { template: { id: "t" }, filters: { options: { tag: [] }, customFields: [], hasAnonymous: false } } });
    expect(filterOptions.loadContactFilterOptions).toHaveBeenCalledWith(personaClient, "ws-de-la-sesion");
    getPermissionAction.mockResolvedValue(null);
    expect(await loadGenerateManyContext({ templateId: T })).toMatchObject({ ok: false });
  });

  it("preparar el modal y buscar contactos piden designer.generate", async () => {
    await loadGenerateContext({ templateId: T });
    await searchGenerateContacts({ query: "lu" });
    expect(getPermissionAction.mock.calls.map((c) => c[0])).toEqual(["designer.generate", "designer.generate"]);
    expect(query.loadGenerateContextCore).toHaveBeenCalledWith(personaClient, session.workspace, T);
    expect(query.searchContactsCore).toHaveBeenCalledWith(personaClient, { workspaceId: "ws-de-la-sesion", query: "lu", timeZone: "America/Argentina/Buenos_Aires" });
    getPermissionAction.mockResolvedValue(null);
    expect(await loadGenerateContext({ templateId: T })).toMatchObject({ ok: false });
    expect(await searchGenerateContacts({ query: "lu" })).toMatchObject({ ok: false });
  });
});
