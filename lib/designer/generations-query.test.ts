import { describe, expect, it } from "vitest";
import { generationDetailCore, listGenerationsCore, loadGenerateContextCore, loadManyContextCore, searchContactsCore } from "./generations-query";
import { GENERATIONS_PAGE_SIZE } from "./screens/generations";
import { DIEGO, LUCIA, OTHER_WS, TEMPLATE, TOMAS, USER, WS, generationDb, generationRow } from "./testing/generation-fixtures";

const NOW = new Date("2026-11-07T15:00:00Z");
const linkFor = (code: string) => `https://links.academia.test/d/${code}`;
const people = async () => ({ [USER]: "Ana Ruiz" });

const base = (over: Record<string, unknown> = {}) => ({
  workspaceId: WS,
  templateId: TEMPLATE,
  filters: { estado: "todas" as const, q: "", page: 1 },
  can: { generate: true },
  timeZone: "America/Argentina/Buenos_Aires",
  now: NOW,
  linkFor,
  ...over,
});

describe("listGenerationsCore (F53)", () => {
  const seed = () => [
    generationRow({ subject_contact_id: LUCIA, values: { "contact.display_name": "Lucía Ferreyra", "contact.email": "lucia@ejemplo.com" }, created_at: "2026-11-07T12:12:00Z" }),
    generationRow({ subject_contact_id: DIEGO, status: "failed", error: "No se pudo armar el PDF (tiempo agotado).", values: { "contact.display_name": "Diego Salas" }, created_at: "2026-11-07T12:10:00Z" }),
    generationRow({ subject_contact_id: TOMAS, status: "queued", source: "automation", source_ref: { kind: "automation", flow_id: "f1", session_id: "s1", node_id: "n" }, values: { "contact.display_name": "Tomás Ruiz" }, created_at: "2026-11-07T12:00:00Z" }),
    generationRow({ status: "void", void_reason: "Nombre mal escrito", created_at: "2026-11-06T09:00:00Z", subject_contact_id: null, subject_ref: { module: "prueba", type: "x", id: "1", label: "Registro de Ana" } }),
    generationRow({ template_id: "otra-plantilla" }),
  ];

  it("los contadores, la tabla y todo lo de cada fila", async () => {
    const db = generationDb({ designs: seed(), extra: { flows: [{ id: "f1", workspace_id: WS, name: "Certificado al completar" }] } });
    const view = await listGenerationsCore(db.client, base(), { loadPeople: people });
    if (!view) throw new Error("sin vista");
    expect(view.counts).toEqual({ todas: 4, generadas: 1, fallidas: 1, en_proceso: 1, anuladas: 1 });
    expect(view.total).toBe(4);
    expect(view.pages).toBe(1);
    expect(view.polling).toBe(true);
    expect(view.template).toEqual({ id: TEMPLATE, name: "Certificado del programa", verify: true, docType: "certificado", issueLabel: "Emitir certificado" });
    expect(view.rows.map((r) => r.para.name)).toEqual(["Lucía Ferreyra", "Diego Salas", "Tomás Ruiz", "Registro de Ana"]);
    const [lucia, diego, tomas, anulada] = view.rows;
    expect(lucia).toMatchObject({ when: "hoy 09:12", origin: { text: "A mano · Ana Ruiz" }, state: { label: "Generado" }, actions: ["view", "copy_link", "void", "regenerate", "detail"], para: { detail: "lucia@ejemplo.com" } });
    expect(lucia.link).toMatch(/^https:\/\/links\.academia\.test\/d\//);
    expect(diego).toMatchObject({ state: { label: "Falló", reason: "No se pudo armar el PDF (tiempo agotado)." }, actions: ["retry", "detail"], link: null });
    expect(tomas).toMatchObject({ origin: { text: "Automatización «Certificado al completar»", href: "/dashboard/flows/f1/ejecuciones?ejecucion=s1" }, state: { label: "En proceso" }, processing: true });
    expect(anulada).toMatchObject({ state: { label: "Anulado", reason: "Motivo: Nombre mal escrito" } });
  });

  it("no mezcla otra plantilla ni otro negocio", async () => {
    const db = generationDb({ designs: [...seed(), generationRow({ workspace_id: OTHER_WS })] });
    const view = await listGenerationsCore(db.client, base(), { loadPeople: people });
    expect(view?.counts.todas).toBe(4);
    expect(await listGenerationsCore(db.client, base({ workspaceId: OTHER_WS }), { loadPeople: people })).toBeNull();
  });

  it("filtra por estado y los contadores no cambian", async () => {
    const db = generationDb({ designs: seed() });
    const failed = await listGenerationsCore(db.client, base({ filters: { estado: "fallidas", q: "", page: 1 } }), { loadPeople: people });
    expect(failed?.rows.map((r) => r.state.label)).toEqual(["Falló"]);
    expect(failed?.total).toBe(1);
    expect(failed?.counts.todas).toBe(4);
    const inProcess = await listGenerationsCore(db.client, base({ filters: { estado: "en_proceso", q: "", page: 1 } }), { loadPeople: people });
    expect(inProcess?.rows.map((r) => r.state.label)).toEqual(["En proceso"]);
    expect((await listGenerationsCore(db.client, base({ filters: { estado: "anuladas", q: "", page: 1 } }), { loadPeople: people }))?.rows).toHaveLength(1);
  });

  it("de a 50: la página 2 trae el resto y dice cuántas páginas hay", async () => {
    const many = Array.from({ length: 60 }, (_, i) => generationRow({ created_at: `2026-11-07T10:${String(i).padStart(2, "0")}:00Z` }));
    const db = generationDb({ designs: many });
    const first = await listGenerationsCore(db.client, base(), { loadPeople: people });
    expect(first?.rows).toHaveLength(GENERATIONS_PAGE_SIZE);
    expect(first).toMatchObject({ total: 60, pages: 2, page: 1 });
    const second = await listGenerationsCore(db.client, base({ filters: { estado: "todas", q: "", page: 2 } }), { loadPeople: people });
    expect(second?.rows).toHaveLength(10);
    // El orden es el más nuevo primero.
    expect(first?.rows[0].when).not.toBe(second?.rows[0].when);
  });

  it("sin el permiso de generar, las acciones que cambian algo no están", async () => {
    const db = generationDb({ designs: seed() });
    const view = await listGenerationsCore(db.client, base({ can: { generate: false } }), { loadPeople: people });
    expect(view?.rows.flatMap((r) => r.actions)).not.toContain("retry");
    expect(view?.rows.flatMap((r) => r.actions)).not.toContain("regenerate");
    expect(view?.rows.flatMap((r) => r.actions)).not.toContain("void");
  });

  it("sin piezas, una lista vacía (el vacío lo explica la pantalla)", async () => {
    const view = await listGenerationsCore(generationDb().client, base(), { loadPeople: people });
    expect(view).toMatchObject({ rows: [], total: 0, pages: 1, polling: false, counts: { todas: 0 } });
  });

  it("si no puede leer los nombres del equipo, igual muestra la lista", async () => {
    const db = generationDb({ designs: [generationRow()] });
    const view = await listGenerationsCore(db.client, base(), { loadPeople: async () => Promise.reject(new Error("x")) });
    expect(view?.rows[0].origin.text).toBe("A mano");
  });
});

describe("generationDetailCore (F54)", () => {
  it("los valores usados con su nombre, los intentos, el error y el estado del email", async () => {
    const failed = generationRow({
      id: "d4000000-1111-4111-8111-000000000001",
      status: "failed",
      error: "Falta: Nombre como lo quiere en el certificado",
      attempts: 3,
      values: { "contact.first_name": "Lucía", "design.issued_on": "7 de noviembre de 2026" },
      source_ref: { kind: "user", user_id: USER, email_request: { subject: "Tu certificado", body: "Acá" } },
    });
    const db = generationDb({ designs: [failed] });
    const out = await generationDetailCore(db.client, { workspaceId: WS, designId: failed.id as string, can: { generate: true }, timeZone: "UTC", now: NOW, linkFor }, { loadPeople: people });
    expect(out).toMatchObject({ attempts: 3, error: "Falta: Nombre como lo quiere en el certificado", state: { label: "Falló" }, emailText: "Se manda cuando la pieza esté lista", canSendEmail: false, link: null, noun: "certificado" });
    expect(out?.values.find((v) => v.key === "nombre_en_el_certificado")).toEqual({ key: "nombre_en_el_certificado", label: "Nombre como lo quiere en el certificado", value: "—" });
    expect(out?.origin.text).toBe("A mano · Ana Ruiz");
  });

  it("una lista con contacto y email ofrece «Mandar el email ahora»; una con el email ya enviado, no", async () => {
    const ready = generationRow({ id: "d4000000-1111-4111-8111-000000000002", values: { "contact.email": "lucia@ejemplo.com" } });
    const sent = generationRow({ id: "d4000000-1111-4111-8111-000000000003", values: { "contact.email": "lucia@ejemplo.com" }, email_status: "sent" });
    const db = generationDb({ designs: [ready, sent] });
    const args = { workspaceId: WS, can: { generate: true }, timeZone: "UTC", now: NOW, linkFor };
    expect((await generationDetailCore(db.client, { ...args, designId: ready.id as string }, { loadPeople: people }))?.canSendEmail).toBe(true);
    const done = await generationDetailCore(db.client, { ...args, designId: sent.id as string }, { loadPeople: people });
    expect(done).toMatchObject({ canSendEmail: false, emailText: "Email enviado" });
  });

  it("una pieza de otro negocio, o que no es una generación, no existe", async () => {
    const own = generationRow({ id: "d4000000-1111-4111-8111-000000000004", template_id: null });
    const other = generationRow({ id: "d4000000-1111-4111-8111-000000000005" });
    const db = generationDb({ designs: [own, other] });
    const args = { can: { generate: true }, timeZone: "UTC", now: NOW, linkFor };
    expect(await generationDetailCore(db.client, { ...args, workspaceId: WS, designId: own.id as string })).toBeNull();
    expect(await generationDetailCore(db.client, { ...args, workspaceId: OTHER_WS, designId: other.id as string })).toBeNull();
  });
});

describe("loadGenerateContextCore (F50)", () => {
  const workspace = { id: WS, name: "Academia Ejemplo", brand_name: null, design_settings: {} };

  it("trae la plantilla con el texto del botón del tipo de documento y sus variables", async () => {
    const out = await loadGenerateContextCore(generationDb().client, workspace, TEMPLATE);
    expect(out).toMatchObject({
      template: { id: TEMPLATE, name: "Certificado del programa", verify: true, docType: "certificado", issueLabel: "Emitir certificado", noun: "certificado", archived: false },
      usedKeys: ["nombre_en_el_certificado", "design.issued_on", "design.code"],
      workspaceName: "Academia Ejemplo",
      sources: [],
    });
    expect(out?.template.customVars).toEqual([{ key: "nombre_en_el_certificado", label: "Nombre como lo quiere en el certificado", sample: "Ana Pérez", default: null }]);
  });

  it("una plantilla sin verificación dice «Generar para…» y no tiene tipo", async () => {
    const out = await loadGenerateContextCore(generationDb({ template: { verify: false, doc_type: null } }).client, workspace, TEMPLATE);
    expect(out?.template).toMatchObject({ issueLabel: "Generar para…", noun: null });
  });

  it("el tipo «Otro» usa el nombre que escribió el negocio", async () => {
    const out = await loadGenerateContextCore(generationDb({ template: { doc_type: "otro", doc_type_label: "Credencial" } }).client, workspace, TEMPLATE);
    expect(out?.template).toMatchObject({ issueLabel: "Emitir credencial", noun: "credencial" });
  });

  it("de otro negocio no existe", async () => {
    expect(await loadGenerateContextCore(generationDb().client, { ...workspace, id: OTHER_WS }, TEMPLATE)).toBeNull();
  });
});

describe("searchContactsCore (F50)", () => {
  const db = () =>
    generationDb({
      contacts: [
        { id: LUCIA, workspace_id: WS, display_name: "Lucía Ferreyra", email: "lucia@ejemplo.com", phone: null, deleted_at: null, is_anonymous: false },
        { id: DIEGO, workspace_id: WS, display_name: "Diego Salas", email: null, phone: "+5491155550002", deleted_at: null, is_anonymous: false },
        { id: TOMAS, workspace_id: WS, display_name: "Tomás Ruiz", email: null, phone: null, deleted_at: "2026-11-01T00:00:00Z", is_anonymous: false },
      ],
    });

  it("busca con la búsqueda de Contactos y devuelve nombre y dato secundario", async () => {
    const out = await searchContactsCore(db().client, { workspaceId: WS, query: "lu", timeZone: "UTC", now: NOW });
    expect(out.map((c) => c.id)).toContain(LUCIA);
    expect(out.find((c) => c.id === LUCIA)).toMatchObject({ name: "Lucía Ferreyra", detail: "lucia@ejemplo.com" });
    expect(out.find((c) => c.id === TOMAS)).toBeUndefined();
  });

  it("con menos de dos letras no busca", async () => {
    expect(await searchContactsCore(db().client, { workspaceId: WS, query: "l", timeZone: "UTC" })).toEqual([]);
    expect(await searchContactsCore(db().client, { workspaceId: WS, query: "   ", timeZone: "UTC" })).toEqual([]);
  });
});

describe("loadManyContextCore (F51)", () => {
  it("trae lo mínimo de la plantilla: nombre, si verifica y el sustantivo del tipo", async () => {
    expect(await loadManyContextCore(generationDb().client, WS, TEMPLATE)).toEqual({
      template: { id: TEMPLATE, name: "Certificado del programa", verify: true, docType: "certificado", docTypeLabel: null, noun: "certificado", archived: false },
    });
    expect((await loadManyContextCore(generationDb({ template: { verify: false, doc_type: null } }).client, WS, TEMPLATE))?.template.noun).toBeNull();
  });

  it("de otro negocio no existe", async () => {
    expect(await loadManyContextCore(generationDb().client, OTHER_WS, TEMPLATE)).toBeNull();
  });
});
