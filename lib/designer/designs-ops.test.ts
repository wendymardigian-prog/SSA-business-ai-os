import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDoc, type DesignDoc } from "./doc/schema";
import type { CoreEnv } from "./designs-core";
import { archiveCore, copyName, deleteCore, duplicateCore, listVersionsCore, renameCore, restoreVersionCore, saveDocCore, updateTemplateSettingsCore } from "./designs-ops";
import { memoryDb, type MemoryDb, type Row } from "./testing/memory-db";

// F48: guardar una versión no pide nada al servicio de render. Si estos módulos se llamaran, estos espías lo dirían.
const scheduleJob = vi.fn();
const enqueueDesignRender = vi.fn();
vi.mock("@/lib/scheduler", () => ({ scheduleJob: (...args: unknown[]) => scheduleJob(...args) }));
vi.mock("./jobs/render", () => ({ enqueueDesignRender: (...args: unknown[]) => enqueueDesignRender(...args), DESIGN_RENDER_JOB: "design_render" }));

const WS = "11111111-2222-3333-4444-555555555555";
const OTHER_WS = "99999999-2222-3333-4444-555555555555";
const USER = "aaaaaaaa-2222-3333-4444-555555555555";

let now = new Date("2026-11-07T12:00:00Z");
const clock = () => now;

function docWithText(text = "Hola", format: DesignDoc["format"] = "v45"): DesignDoc {
  const doc = emptyDoc(format);
  doc.pages[0].elements.push({ id: "el_aaaaaa", type: "text", x: 50, y: 50, w: 60, text, font: { family: "Inter", weight: 700 }, size: 60, align: "center", color: "#111111" });
  return doc;
}

function designRow(extra: Row = {}): Row {
  const doc = docWithText();
  return {
    id: "d1",
    workspace_id: WS,
    name: "Carrusel de prueba",
    format: "v45",
    doc,
    rev: 3,
    origin: "ai",
    style: null,
    allow_download: true,
    template_id: null,
    published: false,
    published_at: null,
    status: "draft",
    archived_at: null,
    content_post_id: null,
    ...extra,
  };
}

function templateRow(extra: Row = {}): Row {
  const doc = docWithText("{{contact.display_name}}", "carta_h");
  return {
    id: "t1",
    workspace_id: WS,
    name: "Constancia",
    format: "carta_h",
    doc,
    rev: 5,
    origin: "ai",
    style: null,
    custom_vars: [],
    date_format: "long",
    verify: false,
    doc_type: null,
    doc_type_label: null,
    allow_download: true,
    archived_at: null,
    ...extra,
  };
}

function setup(tables: Record<string, Row[]> = {}) {
  const db: MemoryDb = memoryDb({ designs: [designRow()], design_templates: [templateRow()], design_versions: [], audit_log: [], ai_threads: [], ...tables }, clock);
  const env: CoreEnv = { service: db.client, actor: { workspaceId: WS, userId: USER }, now: clock };
  return { db, env };
}

beforeEach(() => {
  now = new Date("2026-11-07T12:00:00Z");
  scheduleJob.mockClear();
  enqueueDesignRender.mockClear();
});

const versionsOf = (db: MemoryDb, id = "d1") => db.tables.design_versions.filter((v) => v.design_id === id || v.template_id === id);

describe("guardar con rev (F27)", () => {
  it("guarda y sube la rev", async () => {
    const { db, env } = setup();
    const out = await saveDocCore(env, { kind: "design", id: "d1", doc: docWithText("Nuevo"), rev: 3 });
    expect(out).toEqual({ ok: true, rev: 4 });
    expect(db.tables.designs[0]).toMatchObject({ rev: 4, format: "v45" });
    expect((db.tables.designs[0].doc as DesignDoc).pages[0].elements[0]).toMatchObject({ text: "Nuevo" });
  });

  it("dos guardados con la misma rev: el segundo recibe `conflict` con lo vigente y no pisa nada", async () => {
    const { db, env } = setup();
    expect(await saveDocCore(env, { kind: "design", id: "d1", doc: docWithText("De la pestaña A"), rev: 3 })).toEqual({ ok: true, rev: 4 });
    const second = await saveDocCore(env, { kind: "design", id: "d1", doc: docWithText("De la pestaña B"), rev: 3 });
    expect(second).toMatchObject({ ok: false, conflict: true, current: { rev: 4 } });
    if (!("conflict" in second) || !second.conflict) throw new Error("tenía que ser un conflicto");
    expect((second.current.doc.pages[0].elements[0] as { text: string }).text).toBe("De la pestaña A");
    // Lo guardado sigue siendo lo de A.
    expect((db.tables.designs[0].doc as DesignDoc).pages[0].elements[0]).toMatchObject({ text: "De la pestaña A" });
    expect(db.tables.designs[0].rev).toBe(4);
    // Con la rev vigente, el segundo sí guarda.
    expect(await saveDocCore(env, { kind: "design", id: "d1", doc: docWithText("De B, ahora sí"), rev: 4 })).toEqual({ ok: true, rev: 5 });
  });

  it("un documento inválido no se guarda y dice por qué", async () => {
    const { db, env } = setup();
    const bad = docWithText();
    bad.pages[0].elements[0].x = 400;
    const out = await saveDocCore(env, { kind: "design", id: "d1", doc: bad, rev: 3 });
    expect(out).toMatchObject({ ok: false });
    expect(out.ok === false && "error" in out && out.error).toContain("0 a 100");
    expect(db.log).toEqual([]);
  });

  it("no guarda en un diseño de otro negocio", async () => {
    const { db, env } = setup({ designs: [designRow({ workspace_id: OTHER_WS })] });
    const out = await saveDocCore(env, { kind: "design", id: "d1", doc: docWithText(), rev: 3 });
    expect(out).toMatchObject({ ok: false });
    expect(db.log).toEqual([]);
  });

  it("un diseño puede cambiar de formato al guardar; una plantilla, no (eso es de Configuración)", async () => {
    const { db, env } = setup();
    expect(await saveDocCore(env, { kind: "design", id: "d1", doc: docWithText("x", "story"), rev: 3 })).toEqual({ ok: true, rev: 4 });
    expect(db.tables.designs[0].format).toBe("story");
    const tpl = await saveDocCore(env, { kind: "template", id: "t1", doc: docWithText("x", "sq"), rev: 5 });
    expect(tpl).toMatchObject({ ok: false });
    expect(tpl.ok === false && "error" in tpl && tpl.error).toContain("Configuración");
  });

  it("las variables propias de una plantilla se validan al guardar (forma de la clave, que no choque con el sistema ni se repita)", async () => {
    const { db, env } = setup();
    const save = (customVars: unknown) => saveDocCore(env, { kind: "template", id: "t1", doc: docWithText("{{contact.display_name}}", "carta_h"), rev: db.tables.design_templates[0].rev as number, customVars });
    for (const bad of [
      [{ key: "Nombre Mal", label: "Nombre", sample: "" }],
      [{ key: "a", label: "A", sample: "" }],
      [{ key: "contact", label: "Contacto", sample: "" }],
      [{ key: "ok_1", label: "Uno", sample: "" }, { key: "ok_1", label: "Dos", sample: "" }],
      "no-es-una-lista",
    ]) {
      expect(await save(bad), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
    expect(db.log.filter((l) => l.table === "design_templates")).toEqual([]);
    expect(await save([{ key: "nombre_en_el_certificado", label: "Nombre en el certificado", sample: "Ana Pérez" }])).toMatchObject({ ok: true });
    expect(db.tables.design_templates[0].custom_vars).toEqual([{ key: "nombre_en_el_certificado", label: "Nombre en el certificado", sample: "Ana Pérez", default: null }]);
  });

  it("un diseño (no plantilla) no acepta variables propias", async () => {
    const { env } = setup();
    expect(await saveDocCore(env, { kind: "design", id: "d1", doc: docWithText(), rev: 3, customVars: [] })).toMatchObject({ ok: false });
  });

  it("deja una versión como máximo cada 10 minutos de edición manual", async () => {
    const { db, env } = setup();
    await saveDocCore(env, { kind: "design", id: "d1", doc: docWithText("uno"), rev: 3 });
    expect(versionsOf(db)).toHaveLength(1);
    expect(versionsOf(db)[0]).toMatchObject({ reason: "manual", author_kind: "user", author_id: USER, design_id: "d1", template_id: null });
    // Un minuto después: no hay otra.
    now = new Date(now.getTime() + 60_000);
    await saveDocCore(env, { kind: "design", id: "d1", doc: docWithText("dos"), rev: 4 });
    expect(versionsOf(db)).toHaveLength(1);
    // A los 9:59 de la primera, tampoco.
    now = new Date(Date.parse("2026-11-07T12:09:59Z"));
    await saveDocCore(env, { kind: "design", id: "d1", doc: docWithText("tres"), rev: 5 });
    expect(versionsOf(db)).toHaveLength(1);
    // Pasados los 10 minutos, sí.
    now = new Date(Date.parse("2026-11-07T12:10:01Z"));
    await saveDocCore(env, { kind: "design", id: "d1", doc: docWithText("cuatro"), rev: 6 });
    expect(versionsOf(db)).toHaveLength(2);
    // La versión guarda el documento que se guardó.
    expect(((versionsOf(db)[1].doc as DesignDoc).pages[0].elements[0] as { text: string }).text).toBe("cuatro");
  });

  it("una versión de la IA no cuenta para la regla de los 10 minutos (solo las de edición manual)", async () => {
    const { db, env } = setup({ design_versions: [{ id: "v-ai", design_id: "d1", reason: "ai", created_at: now.toISOString(), doc: docWithText() }] });
    await saveDocCore(env, { kind: "design", id: "d1", doc: docWithText("uno"), rev: 3 });
    expect(db.tables.design_versions.filter((v) => v.reason === "manual")).toHaveLength(1);
  });

  it("guardar (y su versión) NO encola ningún render: ni scheduleJob, ni enqueueDesignRender, ni toca la cola", async () => {
    const { db, env } = setup();
    now = new Date("2026-11-07T12:00:00Z");
    await saveDocCore(env, { kind: "design", id: "d1", doc: docWithText("uno"), rev: 3 });
    expect(versionsOf(db)).toHaveLength(1);
    expect(scheduleJob).not.toHaveBeenCalled();
    expect(enqueueDesignRender).not.toHaveBeenCalled();
    expect(db.touched.has("scheduled_jobs")).toBe(false);
    expect(db.log.every((l) => ["designs", "design_versions"].includes(l.table))).toBe(true);
  });

  it("un fallo al guardar la versión no tumba el guardado", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, env } = setup();
    db.failNext("design_versions", { code: "XX000", message: "boom" });
    expect(await saveDocCore(env, { kind: "design", id: "d1", doc: docWithText("uno"), rev: 3 })).toEqual({ ok: true, rev: 4 });
    spy.mockRestore();
  });

  it("un error de la base al guardar se avisa sin datos técnicos", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, env } = setup();
    db.failNext("designs", { code: "XX000", message: "boom" });
    const out = await saveDocCore(env, { kind: "design", id: "d1", doc: docWithText("uno"), rev: 3 });
    expect(out).toEqual({ ok: false, error: "No pudimos guardar. Probá de nuevo." });
    spy.mockRestore();
  });
});

describe("renombrar y duplicar (F17, F28)", () => {
  it("renombra, limpia los espacios y lo deja en el historial", async () => {
    const { db, env } = setup();
    expect(await renameCore(env, { kind: "design", id: "d1" }, "  Mi   carrusel ")).toEqual({ ok: true, data: undefined });
    expect(db.tables.designs[0].name).toBe("Mi carrusel");
    expect(db.tables.audit_log[0]).toMatchObject({ entity_type: "design", entity_id: "d1", action: "update" });
    expect(db.tables.audit_log[0].changes).toEqual({ name: { old: "Carrusel de prueba", new: "Mi carrusel" } });
  });

  it("rechaza un nombre vacío o demasiado largo y un diseño que no es del negocio", async () => {
    const { db, env } = setup();
    expect(await renameCore(env, { kind: "design", id: "d1" }, "   ")).toMatchObject({ ok: false });
    expect(await renameCore(env, { kind: "template", id: "t1" }, "x".repeat(121))).toMatchObject({ ok: false });
    expect(await renameCore(env, { kind: "design", id: "nope" }, "Algo")).toMatchObject({ ok: false });
    expect(db.log).toEqual([]);
  });

  it("duplicar crea una copia propia sin publicar, con su versión inicial", async () => {
    const { db, env } = setup({ designs: [designRow({ published: true, status: "ready", content_post_id: "p1", code: "K8F2-WQ4M-7TQA" })] });
    const out = await duplicateCore(env, { kind: "design", id: "d1" });
    expect(out.ok && out.data.href).toMatch(/^\/dashboard\/disenos\/d\//);
    const copy = db.tables.designs[1];
    expect(copy).toMatchObject({ name: "Carrusel de prueba (copia)", format: "v45", workspace_id: WS, created_by: USER });
    expect(copy.published).toBeUndefined();
    expect(copy.code).toBeUndefined();
    expect(copy.content_post_id).toBeUndefined();
    expect(copy.template_id).toBeUndefined();
    expect(db.tables.design_versions).toHaveLength(1);
  });

  it("duplicar una pieza emitida la deja como diseño propio hecho a mano", async () => {
    const { db, env } = setup({ designs: [designRow({ origin: "template", template_id: "t1" })] });
    await duplicateCore(env, { kind: "design", id: "d1" });
    expect(db.tables.designs[1]).toMatchObject({ origin: "blank" });
    expect(db.tables.designs[1].template_id).toBeUndefined();
  });

  it("duplicar una plantilla copia su configuración", async () => {
    const { db, env } = setup({ design_templates: [templateRow({ verify: true, doc_type: "constancia", custom_vars: [{ key: "ab", label: "A", sample: "" }], date_format: "short" })] });
    await duplicateCore(env, { kind: "template", id: "t1" });
    expect(db.tables.design_templates[1]).toMatchObject({ name: "Constancia (copia)", verify: true, doc_type: "constancia", date_format: "short" });
  });

  it("el nombre de la copia no se pasa del largo de la base", () => {
    expect(copyName("Hola", "design")).toBe("Hola (copia)");
    expect(copyName("x".repeat(120), "template")).toHaveLength(120);
    expect(copyName("x".repeat(120), "template").endsWith(" (copia)")).toBe(true);
    expect(copyName("x".repeat(200), "design")).toHaveLength(200);
  });
});

describe("archivar y borrar (F28)", () => {
  it("archivar un diseño publicado pide confirmación y NO cambia nada hasta confirmar", async () => {
    const { db, env } = setup({ designs: [designRow({ published: true, status: "ready" })] });
    expect(await archiveCore(env, { kind: "design", id: "d1" })).toEqual({ ok: true, data: { needsConfirm: true } });
    expect(db.log).toEqual([]);
  });

  it("confirmado, lo despublica y lo archiva en la misma escritura", async () => {
    const { db, env } = setup({ designs: [designRow({ published: true, status: "ready" })] });
    expect(await archiveCore(env, { kind: "design", id: "d1" }, { confirmUnpublish: true })).toEqual({ ok: true, data: {} });
    const update = db.log.filter((l) => l.table === "designs" && l.op === "update");
    expect(update).toHaveLength(1);
    expect(update[0].values).toMatchObject({ published: false, status: "draft", archived_at: now.toISOString() });
    expect(db.tables.designs[0]).toMatchObject({ published: false, archived_at: now.toISOString() });
  });

  it("un borrador se archiva directo, y se restaura", async () => {
    const { db, env } = setup();
    expect(await archiveCore(env, { kind: "design", id: "d1" })).toEqual({ ok: true, data: {} });
    expect(db.tables.designs[0].archived_at).toBeTruthy();
    expect(await archiveCore(env, { kind: "design", id: "d1" }, { restore: true })).toEqual({ ok: true, data: {} });
    expect(db.tables.designs[0].archived_at).toBeNull();
  });

  it("una plantilla con generaciones se puede archivar (no borrar)", async () => {
    const { db, env } = setup({ designs: [designRow({ template_id: "t1", origin: "template", id: "g1" })] });
    expect(await archiveCore(env, { kind: "template", id: "t1" })).toEqual({ ok: true, data: {} });
    expect(db.tables.design_templates[0].archived_at).toBeTruthy();
  });

  it("una pieza emitida no se archiva", async () => {
    const { db, env } = setup({ designs: [designRow({ template_id: "t1", origin: "template", published: true })] });
    const out = await archiveCore(env, { kind: "design", id: "d1" }, { confirmUnpublish: true });
    expect(out).toMatchObject({ ok: false });
    expect(db.log).toEqual([]);
  });

  it("borrar uno con generaciones se RECHAZA", async () => {
    const { db, env } = setup({ designs: [designRow({ id: "g1", template_id: "t1", origin: "template" }), designRow({ id: "g2", template_id: "t1", origin: "template" })] });
    const out = await deleteCore(env, { kind: "template", id: "t1" }, true);
    expect(out).toMatchObject({ ok: false });
    expect(out.ok === false && out.error).toContain("2 piezas generadas");
    expect(db.tables.design_templates).toHaveLength(1);
  });

  it("borrar uno publicado, publicado alguna vez o vinculado se rechaza; sin designer.manage, también", async () => {
    for (const patch of [{ published: true }, { published_at: "2026-11-01T00:00:00Z" }, { content_post_id: "p1" }]) {
      const { db, env } = setup({ designs: [designRow(patch)] });
      expect(await deleteCore(env, { kind: "design", id: "d1" }, true), JSON.stringify(patch)).toMatchObject({ ok: false });
      expect(db.tables.designs).toHaveLength(1);
    }
    const { db, env } = setup();
    expect(await deleteCore(env, { kind: "design", id: "d1" }, false)).toMatchObject({ ok: false });
    expect(db.tables.designs).toHaveLength(1);
  });

  it("un borrador sin uso se borra, con su conversación con la IA", async () => {
    const { db, env } = setup({ ai_threads: [{ id: "th1", workspace_id: WS, channel: "designer", subject_id: "d1" }] });
    expect(await deleteCore(env, { kind: "design", id: "d1" }, true)).toEqual({ ok: true, data: undefined });
    expect(db.tables.designs).toHaveLength(0);
    expect(db.tables.ai_threads).toHaveLength(0);
    expect(db.tables.audit_log[0]).toMatchObject({ action: "delete" });
  });
});

describe("versiones y restaurar (F27)", () => {
  const version = (id: string, text: string, minutes: number, extra: Row = {}): Row => ({
    id,
    workspace_id: WS,
    design_id: "d1",
    template_id: null,
    reason: "manual",
    author_kind: "user",
    author_id: USER,
    created_at: new Date(Date.parse("2026-11-07T10:00:00Z") + minutes * 60_000).toISOString(),
    doc: docWithText(text),
    ...extra,
  });

  it("lista las más nuevas primero, con el documento, el autor y su nombre", async () => {
    const { db } = setup({ design_versions: [version("v1", "vieja", 0), version("v2", "nueva", 30, { author_kind: "ai", author_id: null, reason: "ai" })] });
    const list = await listVersionsCore(db.client, WS, { kind: "design", id: "d1" }, new Map([[USER, "Ana Pérez"]]));
    expect(list.map((v) => v.id)).toEqual(["v2", "v1"]);
    expect(list[0]).toMatchObject({ reason: "ai", authorKind: "ai", authorName: null });
    expect(list[1]).toMatchObject({ reason: "manual", authorKind: "user", authorName: "Ana Pérez" });
    expect(list[1].doc.pages).toHaveLength(1);
  });

  it("no lista las versiones de otro negocio ni de otro diseño", async () => {
    const { db } = setup({ design_versions: [version("v1", "a", 0, { workspace_id: OTHER_WS }), version("v2", "b", 1, { design_id: "otro" })] });
    expect(await listVersionsCore(db.client, WS, { kind: "design", id: "d1" }, new Map())).toEqual([]);
  });

  it("restaurar NO borra versiones: guarda lo actual, deja la elegida y suma una «Restaurada»", async () => {
    const { db, env } = setup({ design_versions: [version("v1", "la vieja", 0)] });
    const before = db.tables.design_versions.length;
    const out = await restoreVersionCore(env, { kind: "design", id: "d1" }, "v1");
    expect(out).toEqual({ ok: true, data: { rev: 4 } });
    expect(((db.tables.designs[0].doc as DesignDoc).pages[0].elements[0] as { text: string }).text).toBe("la vieja");
    expect(db.tables.designs[0].rev).toBe(4);
    expect(db.tables.design_versions.length).toBe(before + 2);
    expect(db.tables.design_versions.some((v) => v.id === "v1")).toBe(true);
    expect(db.log.some((l) => l.op === "delete" && l.table === "design_versions")).toBe(false);
    const reasons = db.tables.design_versions.map((v) => v.reason);
    expect(reasons).toContain("restore");
    // Lo que había antes quedó como versión (se puede volver).
    const saved = db.tables.design_versions.find((v) => v.reason === "manual" && v.id !== "v1");
    expect(((saved!.doc as DesignDoc).pages[0].elements[0] as { text: string }).text).toBe("Hola");
  });

  it("una versión que no es de este diseño no se restaura", async () => {
    const { db, env } = setup({ design_versions: [version("v1", "x", 0, { design_id: "otro" }), version("v2", "y", 0, { workspace_id: OTHER_WS })] });
    expect(await restoreVersionCore(env, { kind: "design", id: "d1" }, "v1")).toMatchObject({ ok: false });
    expect(await restoreVersionCore(env, { kind: "design", id: "d1" }, "v2")).toMatchObject({ ok: false });
    expect(db.log).toEqual([]);
  });

  it("una plantilla no restaura una versión de otro formato", async () => {
    const { env } = setup({ design_versions: [{ ...version("v1", "x", 0), design_id: null, template_id: "t1", doc: docWithText("x", "sq") }] });
    expect(await restoreVersionCore(env, { kind: "template", id: "t1" }, "v1")).toMatchObject({ ok: false });
  });
});

describe("configuración de una plantilla (F28)", () => {
  it("«Se puede verificar» solo en formatos impresos: prender en un formato de redes se rechaza", async () => {
    const { db, env } = setup({ design_templates: [templateRow({ format: "sq", doc: docWithText("x", "sq") })] });
    const out = await updateTemplateSettingsCore(env, { id: "t1", verify: true, doc_type: "certificado" });
    expect(out).toMatchObject({ ok: false });
    expect(out.ok === false && out.error).toBe("Este formato no admite verificación.");
    expect(db.log).toEqual([]);
  });

  it("prender la verificación pide el tipo de documento; «Otro» pide el nombre", async () => {
    const { env } = setup();
    expect(await updateTemplateSettingsCore(env, { id: "t1", verify: true })).toMatchObject({ ok: false });
    expect(await updateTemplateSettingsCore(env, { id: "t1", verify: true, doc_type: "otro" })).toMatchObject({ ok: false });
    expect(await updateTemplateSettingsCore(env, { id: "t1", verify: true, doc_type: "otro", doc_type_label: "Credencial" })).toEqual({ ok: true, data: { notice: null } });
  });

  it("guarda el tipo y limpia el nombre propio si ya no es «Otro»", async () => {
    const { db, env } = setup({ design_templates: [templateRow({ verify: true, doc_type: "otro", doc_type_label: "Credencial" })] });
    await updateTemplateSettingsCore(env, { id: "t1", doc_type: "diploma" });
    expect(db.tables.design_templates[0]).toMatchObject({ doc_type: "diploma", doc_type_label: null, verify: true });
  });

  it("al pasar a un formato que no verifica, la verificación se apaga sola con el aviso", async () => {
    const { db, env } = setup({ design_templates: [templateRow({ verify: true, doc_type: "certificado" })] });
    const out = await updateTemplateSettingsCore(env, { id: "t1", format: "sq" });
    expect(out).toEqual({ ok: true, data: { notice: "Este formato no admite verificación" } });
    expect(db.tables.design_templates[0]).toMatchObject({ format: "sq", verify: false, rev: 6 });
    expect((db.tables.design_templates[0].doc as DesignDoc).format).toBe("sq");
    // Antes de reescalar, quedó la versión anterior.
    expect(versionsOf(db, "t1")).toHaveLength(1);
    expect((versionsOf(db, "t1")[0].doc as DesignDoc).format).toBe("carta_h");
  });

  it("entre formatos impresos la verificación sigue prendida y no hay aviso", async () => {
    const { db, env } = setup({ design_templates: [templateRow({ verify: true, doc_type: "constancia" })] });
    expect(await updateTemplateSettingsCore(env, { id: "t1", format: "a4_h" })).toEqual({ ok: true, data: { notice: null } });
    expect(db.tables.design_templates[0]).toMatchObject({ format: "a4_h", verify: true });
  });

  it("una plantilla no puede ser una página web", async () => {
    const { env } = setup();
    expect(await updateTemplateSettingsCore(env, { id: "t1", format: "web" })).toMatchObject({ ok: false });
  });

  it("formato de fecha, descarga y variables propias", async () => {
    const { db, env } = setup();
    const out = await updateTemplateSettingsCore(env, { id: "t1", date_format: "en", allow_download: false, custom_vars: [{ key: "nombre_en_el_certificado", label: "Nombre en el certificado", sample: "Ana" }] });
    expect(out).toEqual({ ok: true, data: { notice: null } });
    expect(db.tables.design_templates[0]).toMatchObject({ date_format: "en", allow_download: false });
    expect(db.tables.design_templates[0].custom_vars).toEqual([{ key: "nombre_en_el_certificado", label: "Nombre en el certificado", sample: "Ana", default: null }]);
    expect(await updateTemplateSettingsCore(env, { id: "t1", date_format: "raro" as never })).toMatchObject({ ok: false });
    expect(await updateTemplateSettingsCore(env, { id: "t1", allow_download: "si" as never })).toMatchObject({ ok: false });
  });

  it("las variables propias se validan (forma de la clave, sistema, repetidas)", async () => {
    const { db, env } = setup();
    for (const bad of [
      [{ key: "Mal Escrita", label: "X", sample: "" }],
      [{ key: "design", label: "X", sample: "" }],
      [{ key: "workspace", label: "X", sample: "" }],
      [{ key: "dos", label: "A", sample: "" }, { key: "dos", label: "B", sample: "" }],
      [{ key: "con.punto", label: "A", sample: "" }],
    ]) {
      expect(await updateTemplateSettingsCore(env, { id: "t1", custom_vars: bad as never }), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
    expect(db.log).toEqual([]);
  });

  it("una plantilla de otro negocio no se toca", async () => {
    const { db, env } = setup({ design_templates: [templateRow({ workspace_id: OTHER_WS })] });
    expect(await updateTemplateSettingsCore(env, { id: "t1", allow_download: false })).toMatchObject({ ok: false });
    expect(db.log).toEqual([]);
  });

  it("sin cambios no escribe nada", async () => {
    const { db, env } = setup();
    expect(await updateTemplateSettingsCore(env, { id: "t1" })).toEqual({ ok: true, data: { notice: null } });
    expect(db.log).toEqual([]);
  });
});
