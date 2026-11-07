import { describe, expect, it, vi } from "vitest";
import type { DesignDoc } from "../doc/schema";
import { answerProposalRequest, loadConversationView, submitRequest, submitStyleChange, submitTextProposal } from "./requests";
import { memoryDb } from "./test-db";
import { carousel, singlePage, WS } from "./test-fixtures";

const USER = "22222222-2222-2222-2222-222222222222";
const photo = `${WS}/images/aaaaaaaa-0000-0000-0000-000000000001.png`;
const NOW = new Date("2026-11-07T12:00:00.000Z");

interface SetupOptions {
  kind?: "design" | "template";
  doc?: DesignDoc;
  format?: string;
  connected?: boolean;
  archived?: boolean;
  messages?: Record<string, unknown>[];
  settings?: Record<string, unknown>;
}

function setup(o: SetupOptions = {}) {
  const kind = o.kind ?? "design";
  const doc = o.doc ?? carousel();
  const table = kind === "design" ? "designs" : "design_templates";
  const mem = memoryDb({
    workspaces: [{ id: WS, name: "Academia Ejemplo", brand_name: "Academia Ejemplo", design_settings: o.settings ?? {}, timezone: "UTC" }],
    [table]: [{ id: "t1", workspace_id: WS, name: "Pieza", format: o.format ?? doc.format, doc, rev: 3, style: null, origin: "ai", content_post_id: null, archived_at: o.archived ? "2026-11-01T00:00:00Z" : null, verify: false, doc_type: null, doc_type_label: null, custom_vars: [], date_format: "long" }],
    integration_configs: o.connected === false ? [] : [{ workspace_id: WS, type: "ai_provider", is_active: true, provider: "anthropic" }],
    ai_threads: [],
    ai_messages: o.messages ?? [],
  });
  const schedule = vi.fn(async (..._args: unknown[]) => ({ id: "job" }));
  return { ...mem, schedule, deps: { schedule: schedule as never, now: () => NOW } };
}

const base = { workspaceId: WS, userId: USER, kind: "design" as const, id: "t1" };

describe("ai/requests: pedirle algo a la IA", () => {
  it("deja el pedido en el hilo (con su alcance) y encola el job con dedupe", async () => {
    const s = setup();
    const r = await submitRequest(s.db, { ...base, mode: "change", text: "  Acortá los textos  ", page: 1 }, s.deps);
    expect(r.ok).toBe(true);
    const message = s.tables.ai_messages[0];
    expect(message).toMatchObject({ role: "user", content: "Acortá los textos", context: { scope: { page: 1 } } });
    expect(s.tables.ai_threads[0]).toMatchObject({ channel: "designer", subject_type: "design", subject_id: "t1", workspace_id: WS });
    expect(s.schedule).toHaveBeenCalledTimes(1);
    const [, type, payload, runAt, key] = s.schedule.mock.calls[0];
    expect(type).toBe("design_ai_generate");
    expect(payload).toMatchObject({ workspaceId: WS, kind: "design", targetId: "t1", mode: "change", baseRev: 3, userId: USER, userMessageId: message.id });
    expect(runAt).toEqual(NOW);
    expect(key).toBe(`design-ai:${message.id}`);
  });

  it("con alcance «todo» no guarda página", async () => {
    const s = setup();
    await submitRequest(s.db, { ...base, mode: "change", text: "Más grande el título", page: null }, s.deps);
    expect(s.tables.ai_messages[0].context).toEqual({ scope: {} });
  });

  it("la primera versión lleva el estilo elegido, las imágenes, el contexto de Contenido y si es una o varias páginas", async () => {
    const s = setup();
    const r = await submitRequest(
      s.db,
      {
        ...base,
        mode: "first",
        text: "Un carrusel sobre mi método",
        styleKey: "social",
        multiPage: true,
        attachments: [{ asset_path: photo, name: "foto.png", mime: "image/png" }],
        contentContext: { postId: "p1", network: "instagram", script: ["Gancho", "Cierre"], caption: "Caption" },
      },
      s.deps,
    );
    expect(r.ok).toBe(true);
    expect(s.tables.ai_messages[0].attachments).toEqual([{ asset_path: photo, name: "foto.png", mime: "image/png" }]);
    expect(s.schedule.mock.calls[0][2]).toMatchObject({ mode: "first", styleKey: "social", multiPage: true, contentContext: { postId: "p1", network: "instagram" } });
  });

  it("una imagen sola alcanza como pedido", async () => {
    const s = setup();
    const r = await submitRequest(s.db, { ...base, mode: "change", text: "", attachments: [{ asset_path: photo, name: "foto.png", mime: "image/png" }] }, s.deps);
    expect(r.ok).toBe(true);
    expect(s.tables.ai_messages[0].content).toBe("Usá esta imagen.");
  });

  it("rechaza un pedido vacío, uno larguísimo y una página que no existe", async () => {
    const s = setup();
    expect(await submitRequest(s.db, { ...base, mode: "change", text: "   " }, s.deps)).toEqual({ ok: false, error: "Escribí qué querés que haga la IA." });
    expect((await submitRequest(s.db, { ...base, mode: "change", text: "x".repeat(4001) }, s.deps)).ok).toBe(false);
    expect(await submitRequest(s.db, { ...base, mode: "change", text: "Hola", page: 9 }, s.deps)).toEqual({ ok: false, error: "Esa página ya no existe. Elegí otra." });
    expect(s.tables.ai_messages).toHaveLength(0);
    expect(s.schedule).not.toHaveBeenCalled();
  });

  it("no acepta adjuntos de otro negocio, que no sean imagen o de más", async () => {
    const s = setup();
    const ajeno = [{ asset_path: "99999999-0000-0000-0000-000000000000/images/x.png", name: "x.png", mime: "image/png" }];
    expect((await submitRequest(s.db, { ...base, mode: "change", text: "Hola", attachments: ajeno }, s.deps)).ok).toBe(false);
    const pdf = [{ asset_path: photo, name: "a.pdf", mime: "application/pdf" }];
    expect((await submitRequest(s.db, { ...base, mode: "change", text: "Hola", attachments: pdf }, s.deps)).ok).toBe(false);
    const muchos = Array.from({ length: 6 }, (_, i) => ({ asset_path: `${WS}/images/${i}.png`, name: `${i}.png`, mime: "image/png" }));
    expect((await submitRequest(s.db, { ...base, mode: "change", text: "Hola", attachments: muchos }, s.deps)).ok).toBe(false);
    expect(s.tables.ai_messages).toHaveLength(0);
  });

  it("sin ninguna IA conectada dice «Conectá una clave de IA en Configuración» y no encola nada", async () => {
    const s = setup({ connected: false });
    const r = await submitRequest(s.db, { ...base, mode: "change", text: "Hola" }, s.deps);
    expect(r).toEqual({ ok: false, error: "Conectá una clave de IA en Configuración" });
    expect(s.schedule).not.toHaveBeenCalled();
    expect(s.tables.ai_messages).toHaveLength(0);
  });

  it("no acepta otro pedido mientras el anterior no tiene respuesta, pero uno abandonado hace media hora ya no bloquea", async () => {
    const pending = { id: "m0", thread_id: "ai_threads_1", role: "user", content: "x", attachments: [], context: { scope: {} }, result: null, created_at: "2026-11-07T11:55:00.000Z" };
    const s = setup({ messages: [pending] });
    s.tables.ai_threads.push({ id: "ai_threads_1", workspace_id: WS, channel: "designer", subject_type: "design", subject_id: "t1" });
    expect(await submitRequest(s.db, { ...base, mode: "change", text: "Otro" }, s.deps)).toEqual({ ok: false, error: "Esperá a que la IA termine el pedido anterior." });

    pending.created_at = "2026-11-07T11:00:00.000Z";
    expect((await submitRequest(s.db, { ...base, mode: "change", text: "Otro" }, s.deps)).ok).toBe(true);
  });

  it("un diseño de otro negocio o archivado no se toca", async () => {
    const s = setup();
    const other = await submitRequest(s.db, { ...base, workspaceId: "99999999-2222-3333-4444-555555555555", mode: "change", text: "Hola" }, s.deps);
    expect(other).toEqual({ ok: false, error: "No encontré ese diseño." });
    const archived = setup({ archived: true });
    expect((await submitRequest(archived.db, { ...base, mode: "change", text: "Hola" }, archived.deps)).ok).toBe(false);
  });

  it("si no se puede encolar, deja un aviso en el hilo (no queda «Diseñando…» para siempre)", async () => {
    const s = setup();
    s.schedule.mockRejectedValueOnce(new Error("cola caída"));
    const r = await submitRequest(s.db, { ...base, mode: "change", text: "Hola" }, s.deps);
    expect(r.ok).toBe(false);
    const last = s.tables.ai_messages[s.tables.ai_messages.length - 1];
    expect(last.role).toBe("assistant");
  });
});

describe("ai/requests: cambiar de estilo (F35)", () => {
  it("pide rehacer con ese estilo, conservando los textos", async () => {
    const s = setup();
    const r = await submitStyleChange(s.db, { ...base, style: "minimal" }, s.deps);
    expect(r.ok).toBe(true);
    expect(s.tables.ai_messages[0].content).toBe("Rehacé el diseño con el estilo «Minimal»: mismos textos, otra paleta, tipografía y composición.");
    expect(s.schedule.mock.calls[0][2]).toMatchObject({ mode: "style", styleKey: "minimal" });
  });

  it("acepta un estilo propio y rechaza uno que no existe o está archivado", async () => {
    const custom = { key: "c_abc12", name: "Mi estilo", palette: { bg: "#111111", text: "#ffffff", accent: "#ff0000" }, fonts: { title: "Inter", body: "Inter" }, density: {}, rules: "" };
    const s = setup({ settings: { styles: [custom, { ...custom, key: "c_old12", name: "Viejo", archived: true }] } });
    expect((await submitStyleChange(s.db, { ...base, style: "c_abc12" }, s.deps)).ok).toBe(true);
    const s2 = setup({ settings: { styles: [{ ...custom, archived: true }] } });
    expect((await submitStyleChange(s2.db, { ...base, style: "c_abc12" }, s2.deps)).ok).toBe(false);
    expect(await submitStyleChange(s2.db, { ...base, style: "inventado" }, s2.deps)).toEqual({ ok: false, error: "Ese estilo no existe o está archivado." });
  });
});

describe("ai/requests: proponer los textos de una imagen base (F30)", () => {
  const withImage = (): DesignDoc => ({ v: 1, format: "carta_h", pages: [{ id: "pg_img00001", background: { type: "image", image: { asset: photo, fit: "cover", focal: { x: 50, y: 50 }, locked: true } }, elements: [] }] });

  it("deja el pedido y encola el job de propuesta", async () => {
    const s = setup({ kind: "template", doc: withImage() });
    const r = await submitTextProposal(s.db, { workspaceId: WS, userId: USER, templateId: "t1" }, s.deps);
    expect(r.ok).toBe(true);
    expect(s.schedule.mock.calls[0][2]).toMatchObject({ mode: "propose_texts", kind: "template" });
  });

  it("sin imagen base no hay nada que proponer", async () => {
    const s = setup({ kind: "template", doc: singlePage("carta_h") });
    expect((await submitTextProposal(s.db, { workspaceId: WS, userId: USER, templateId: "t1" }, s.deps)).ok).toBe(false);
  });
});

describe("ai/requests: la conversación para el panel", () => {
  it("sin hilo todavía: vacío y dice si la IA está conectada", async () => {
    const s = setup({ connected: false });
    const r = await loadConversationView(s.db, { workspaceId: WS, kind: "design", id: "t1" }, NOW);
    expect(r).toEqual({ ok: true, data: { threadId: null, messages: [], ai: { connected: false, message: "Conectá una clave de IA en Configuración" } } });
  });

  it("devuelve los mensajes con qué cambió, avisos y la propuesta, y marca pendiente el último pedido sin respuesta", async () => {
    const s = setup();
    s.tables.ai_threads.push({ id: "th1", workspace_id: WS, channel: "designer", subject_type: "design", subject_id: "t1" });
    s.tables.ai_messages.push(
      { id: "m1", thread_id: "th1", role: "user", content: "Hacé la portada más llamativa", attachments: [{ asset_path: photo, name: "f.png", mime: "image/png" }], context: { scope: { page: 0 } }, result: null, created_at: "2026-11-07T11:00:00.000Z" },
      { id: "m2", thread_id: "th1", role: "assistant", content: "Listo", attachments: [], context: { scope: {} }, result: { changed_pages: [0], summary: "Cambió la página 1", warnings: ["La página 1 tiene poco contraste: subí la capa de color."], proposal: { kind: "enable_verification", status: "pending", payload: { doc_type: "certificado" } } }, created_at: "2026-11-07T11:01:00.000Z" },
      { id: "m3", thread_id: "th1", role: "user", content: "Otra", attachments: [], context: { scope: {} }, result: null, created_at: "2026-11-07T11:59:00.000Z" },
    );
    const r = await loadConversationView(s.db, { workspaceId: WS, kind: "design", id: "t1" }, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.ai.connected).toBe(true);
    const [a, b, c] = r.data.messages;
    expect(a).toMatchObject({ scopePage: 0, attachments: [{ name: "f.png" }], pending: false });
    expect(b).toMatchObject({ changedPages: [0], summary: "Cambió la página 1", proposal: { kind: "enable_verification", status: "pending" }, pending: false });
    expect(b.warnings).toHaveLength(1);
    expect(c.pending).toBe(true);
  });

  it("no mezcla conversaciones de otro negocio", async () => {
    const s = setup();
    s.tables.ai_threads.push({ id: "th1", workspace_id: WS, channel: "designer", subject_type: "design", subject_id: "t1" });
    const r = await loadConversationView(s.db, { workspaceId: "99999999-2222-3333-4444-555555555555", kind: "design", id: "t1" }, NOW);
    expect(r.ok && r.data.threadId).toBeNull();
  });
});

describe("ai/requests: «Hacerlo / No»", () => {
  const withImage = (): DesignDoc => ({ v: 1, format: "carta_h", pages: [{ id: "pg_img00001", background: { type: "image", image: { asset: photo, fit: "cover", focal: { x: 50, y: 50 }, locked: true } }, elements: [] }] });
  const textsPatch = { pages: [{ index: 0, ops: [{ op: "add", element: { type: "text", x: 50, y: 50, w: 70, text: "{{contact.display_name}}", font: { family: "Inter", weight: 700 }, size: 48, align: "center", color: "#111111" } }] }] };

  function withProposal(kind: "template_texts" | "enable_verification", payload: Record<string, unknown>, extra: SetupOptions = {}) {
    const s = setup({ kind: "template", doc: withImage(), ...extra });
    s.tables.ai_threads.push({ id: "th1", workspace_id: WS, channel: "designer", subject_type: "design_template", subject_id: "t1" });
    s.tables.ai_messages.push({ id: "mp", thread_id: "th1", role: "assistant", content: "¿Lo hago?", attachments: [], context: { scope: {} }, result: { changed_pages: [], summary: "", proposal: { kind, status: "pending", payload } }, created_at: "2026-11-07T11:00:00.000Z" });
    return s;
  }
  const args = { workspaceId: WS, userId: USER, kind: "template" as const, id: "t1", messageId: "mp" };
  const statusOf = (s: ReturnType<typeof setup>) => ((s.tables.ai_messages.find((m) => m.id === "mp")?.result as { proposal: { status: string } }).proposal.status);

  it("«No» deja la propuesta rechazada y no toca nada", async () => {
    const s = withProposal("template_texts", { patch: textsPatch, baseRev: 3 });
    expect(await answerProposalRequest(s.db, { ...args, accept: false })).toEqual({ ok: true, data: {} });
    expect(statusOf(s)).toBe("declined");
    expect((s.tables.design_templates[0] as { rev: number }).rev).toBe(3);
  });

  it("«Hacerlo» con los textos: los aplica, sube la rev, guarda una versión de la IA y marca aceptada", async () => {
    const s = withProposal("template_texts", { patch: textsPatch, baseRev: 3 });
    const r = await answerProposalRequest(s.db, { ...args, accept: true });
    expect(r).toEqual({ ok: true, data: { rev: 4 } });
    const row = s.tables.design_templates[0] as { rev: number; doc: DesignDoc };
    expect(row.doc.pages[0].elements).toHaveLength(1);
    expect(row.doc.pages[0].elements[0]).toMatchObject({ type: "text", text: "{{contact.display_name}}" });
    expect(row.doc.pages[0].background.image?.locked).toBe(true);
    expect(s.inserts.filter((i) => i.table === "design_versions")).toEqual([expect.objectContaining({ row: expect.objectContaining({ template_id: "t1", reason: "ai", author_kind: "ai" }) })]);
    expect(statusOf(s)).toBe("accepted");
  });

  it("una propuesta ya respondida no se aplica dos veces", async () => {
    const s = withProposal("template_texts", { patch: textsPatch });
    await answerProposalRequest(s.db, { ...args, accept: true });
    expect(await answerProposalRequest(s.db, { ...args, accept: true })).toEqual({ ok: false, error: "Esa propuesta ya fue respondida." });
    expect((s.tables.design_templates[0] as { doc: DesignDoc }).doc.pages[0].elements).toHaveLength(1);
  });

  it("«Hacerlo» con la verificación: prende verify con el tipo, solo en una plantilla impresa", async () => {
    const s = withProposal("enable_verification", { doc_type: "certificado" });
    expect(await answerProposalRequest(s.db, { ...args, accept: true })).toEqual({ ok: true, data: {} });
    expect(s.tables.design_templates[0]).toMatchObject({ verify: true, doc_type: "certificado" });
    expect(statusOf(s)).toBe("accepted");
  });

  it("si el formato cambió a uno que no admite verificación, no la prende y dice por qué", async () => {
    const s = withProposal("enable_verification", { doc_type: "constancia" });
    (s.tables.design_templates[0] as { format: string; doc: DesignDoc }).format = "v45";
    (s.tables.design_templates[0] as { doc: DesignDoc }).doc = { ...withImage(), format: "v45" };
    const r = await answerProposalRequest(s.db, { ...args, accept: true });
    expect(r).toEqual({ ok: false, error: "Este formato no admite verificación." });
    expect(s.tables.design_templates[0]).toMatchObject({ verify: false, doc_type: null });
    expect(statusOf(s)).toBe("pending");
  });

  it("no acepta un tipo de documento inventado ni una propuesta de verificación en un diseño suelto", async () => {
    const s = withProposal("enable_verification", { doc_type: "otro" });
    expect((await answerProposalRequest(s.db, { ...args, accept: true })).ok).toBe(false);

    const design = setup({ kind: "design" });
    design.tables.ai_threads.push({ id: "th1", workspace_id: WS, channel: "designer", subject_type: "design", subject_id: "t1" });
    design.tables.ai_messages.push({ id: "mp", thread_id: "th1", role: "assistant", content: "x", attachments: [], context: { scope: {} }, result: { changed_pages: [], summary: "", proposal: { kind: "enable_verification", status: "pending", payload: { doc_type: "certificado" } } }, created_at: "2026-11-07T11:00:00.000Z" });
    expect(await answerProposalRequest(design.db, { ...args, kind: "design", accept: true })).toEqual({ ok: false, error: "La verificación es solo de plantillas." });
  });

  it("una propuesta de otro negocio o que no existe no se puede responder", async () => {
    const s = withProposal("template_texts", { patch: textsPatch });
    expect((await answerProposalRequest(s.db, { ...args, workspaceId: "99999999-2222-3333-4444-555555555555", accept: true })).ok).toBe(false);
    expect((await answerProposalRequest(s.db, { ...args, messageId: "nope", accept: true })).ok).toBe(false);
  });
});
