import { strToU8, zipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";

const WS = "11111111-2222-3333-4444-555555555555";
const OTHER_WS = "99999999-2222-3333-4444-555555555555";
const USER = "77777777-2222-3333-4444-555555555555";

interface Row {
  [key: string]: unknown;
}

const state = vi.hoisted(() => ({
  allowed: true,
  files: new Map<string, { bytes: Uint8Array; contentType?: string }>(),
  rows: { designs: [] as unknown[], design_templates: [] as unknown[], design_versions: [] as unknown[] },
  failVersionInsert: false,
  failUpload: false,
  rate: 1,
  greetings: [] as unknown[],
  workspaceId: "11111111-2222-3333-4444-555555555555",
  rpcCalls: [] as unknown[],
}));

vi.mock("@/lib/auth/guards", () => ({
  getPermissionAction: async (key: string) => (state.allowed && key === "designer.edit" ? { workspace: { id: state.workspaceId }, user: { id: "77777777-2222-3333-4444-555555555555" } } : null),
}));

vi.mock("@/lib/ai-threads/store", () => ({
  getOrCreateDesignerThread: async () => ({ id: "thread-1", workspace_id: state.workspaceId, channel: "designer" }),
  appendMessage: async (_service: unknown, _thread: unknown, message: unknown) => {
    state.greetings.push(message);
    return {};
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({
    rpc: async (name: string, args: unknown) => {
      state.rpcCalls.push({ name, args });
      return { data: state.rate, error: null };
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: Uint8Array, opts?: { contentType?: string; upsert?: boolean }) => {
          if (bucket !== "design-assets") return { error: { message: "bucket raro" } };
          if (state.failUpload) return { error: { message: "falló" } };
          if (state.files.has(path)) return { error: { message: "ya existe" } };
          state.files.set(path, { bytes: body, contentType: opts?.contentType });
          return { error: null };
        },
        download: async (path: string) => {
          const file = state.files.get(path);
          if (!file) return { data: null, error: { message: "no existe" } };
          return { data: new Blob([file.bytes as BlobPart]), error: null };
        },
        remove: async (paths: string[]) => {
          for (const p of paths) state.files.delete(p);
          return { data: [], error: null };
        },
      }),
    },
    from: (table: "designs" | "design_templates" | "design_versions") => ({
      insert: (row: Row) => {
        const stored = { ...row, id: `id-${state.rows[table].length + 1}` };
        const run = () => {
          if (table === "design_versions" && state.failVersionInsert) return { data: null, error: { message: "falló" } };
          state.rows[table].push(stored);
          return { data: stored, error: null };
        };
        return {
          select: () => ({ single: async () => run() }),
          then: (resolve: (v: unknown) => void) => resolve(run()),
        };
      },
      delete: () => ({
        eq: (_col: string, id: string) => ({
          eq: async () => {
            state.rows[table] = state.rows[table].filter((r) => (r as Row).id !== id);
            return { error: null };
          },
        }),
      }),
    }),
  }),
}));

import { importHtml, inspectHtmlUpload } from "./import";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const LANDING = `<!doctype html><html><head><title>Mi landing</title><style>body{margin:0;background:url(img/fondo.png)} .h{color:#111}</style></head><body><h1 class="h">Hola mundo</h1><img src="img/logo.png"><form action="/x"><input type="email" placeholder="Email"></form><script>alert(1)</script></body></html>`;
const PLAIN = `<!doctype html><html><head><title>Mi landing</title><style>body{margin:0} .h{color:#111}</style></head><body><h1 class="h">Hola mundo</h1><form action="/x"><input type="email" placeholder="Email"></form><script>alert(1)</script></body></html>`;
const SLIDES = `<html><head><style>.slide{width:1920px;height:1080px}</style></head><body>${[1, 2, 3].map((n) => `<div class="slide"><h1>Diapositiva ${n}</h1></div>`).join("")}</body></html>`;

function formWith(file: File | null, extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  if (file) form.set("file", file);
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return form;
}
const htmlFile = (html: string, name = "landing.html") => new File([strToU8(html)], name, { type: "text/html" });
const zipFile = (files: Record<string, Uint8Array>, name = "sitio.zip") => new File([zipSync(files) as BlobPart], name, { type: "application/zip" });

beforeEach(() => {
  state.allowed = true;
  state.files.clear();
  state.rows.designs = [];
  state.rows.design_templates = [];
  state.rows.design_versions = [];
  state.failVersionInsert = false;
  state.failUpload = false;
  state.rate = 1;
  state.greetings = [];
  state.workspaceId = WS;
  state.rpcCalls = [];
});

describe("inspectHtmlUpload (F39–F41)", () => {
  it("sin el permiso designer.edit no hace nada", async () => {
    state.allowed = false;
    const r = await inspectHtmlUpload(formWith(htmlFile(LANDING)));
    expect(r).toEqual({ ok: false, error: expect.stringContaining("No tenés permiso") });
    expect(state.files.size).toBe(0);
  });

  it("sin archivo o vacío responde con un motivo", async () => {
    expect(await inspectHtmlUpload(formWith(null))).toMatchObject({ ok: false });
    expect(await inspectHtmlUpload(formWith(new File([], "a.html")))).toMatchObject({ ok: false });
  });

  it("un .html suelto: lee, limpia, detecta y deja el registro en la carpeta del negocio", async () => {
    const r = await inspectHtmlUpload(formWith(htmlFile(PLAIN)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.fileName).toBe("landing.html");
    expect(r.data.detected).toMatchObject({ as: "web", format: "web", pages: 1, label: "Página web · una sola página con scroll" });
    expect(r.data.removed).toMatchObject({ scripts: 1, forms: 1, summary: "Se quitaron 1 script y 1 formulario: se mantiene el diseño." });
    expect(r.data.assets).toEqual({ images: 0, fonts: 0 });
    const recordPath = `${WS}/imports/${r.data.uploadId}/import.json`;
    expect([...state.files.keys()]).toEqual([recordPath]);
    expect(state.files.get(recordPath)?.contentType).toBe("application/json");
    const record = JSON.parse(new TextDecoder().decode(state.files.get(recordPath)?.bytes));
    expect(record.html).not.toMatch(/<script|<form|alert\(1\)/);
    expect(record.html).toContain("Hola mundo");
  });

  it("un zip: sube solo lo que se usa, validado por sus bytes, a la carpeta del negocio", async () => {
    const r = await inspectHtmlUpload(formWith(zipFile({ "index.html": strToU8(LANDING), "img/logo.png": PNG, "img/fondo.png": PNG, "img/sobra.png": PNG })));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.assets).toEqual({ images: 2, fonts: 0 });
    const base = `${WS}/imports/${r.data.uploadId}`;
    expect([...state.files.keys()].sort()).toEqual([`${base}/img__fondo.png`, `${base}/img__logo.png`, `${base}/import.json`]);
    expect(state.files.get(`${base}/img__logo.png`)?.contentType).toBe("image/png");
    const record = JSON.parse(new TextDecoder().decode(state.files.get(`${base}/import.json`)?.bytes));
    expect(record.html).toContain(`asset:${base}/img__logo.png`);
    expect(record.css).toContain(`url("asset:${base}/img__fondo.png")`);
  });

  it("detecta una presentación", async () => {
    const r = await inspectHtmlUpload(formWith(htmlFile(SLIDES, "deck.html")));
    expect(r.ok && r.data.detected).toMatchObject({ as: "slides", format: "wide", pages: 3, label: "Presentación · 3 diapositivas de 1920 × 1080" });
  });

  it("un zip con ../evil.html se rechaza y no se sube nada", async () => {
    const r = await inspectHtmlUpload(formWith(zipFile({ "index.html": strToU8(LANDING), "../evil.html": strToU8("x") })));
    expect(r).toEqual({ ok: false, error: expect.stringContaining("«..»") });
    expect(state.files.size).toBe(0);
  });

  it("un archivo que no es HTML ni zip se rechaza aunque se llame .html", async () => {
    expect(await inspectHtmlUpload(formWith(new File([PNG as BlobPart], "foto.html")))).toMatchObject({ ok: false });
    expect(state.files.size).toBe(0);
  });

  it("ignora un workspace que mande el navegador: usa el de la sesión", async () => {
    const r = await inspectHtmlUpload(formWith(htmlFile(LANDING), { workspace_id: OTHER_WS, workspaceId: OTHER_WS }));
    expect(r.ok).toBe(true);
    expect([...state.files.keys()].every((p) => p.startsWith(`${WS}/`))).toBe(true);
  });

  it("si falla la subida de un recurso, deshace lo que ya subió y avisa", async () => {
    state.failUpload = true;
    const r = await inspectHtmlUpload(formWith(zipFile({ "index.html": strToU8(LANDING), "img/logo.png": PNG, "img/fondo.png": PNG })));
    expect(r).toEqual({ ok: false, error: expect.stringContaining("No se pudieron guardar") });
    expect(state.files.size).toBe(0);
  });

  it("un tope de cargas por hora", async () => {
    state.rate = 31;
    const r = await inspectHtmlUpload(formWith(htmlFile(LANDING)));
    expect(r).toEqual({ ok: false, error: expect.stringContaining("muchos archivos") });
    expect(state.files.size).toBe(0);
    expect(state.rpcCalls[0]).toMatchObject({ name: "bump_rate_limit", args: { p_key: `designer-import:${USER}` } });
  });

  it("una app que arma todo con scripts (sin contenido) se rechaza con un motivo", async () => {
    const r = await inspectHtmlUpload(formWith(htmlFile(`<html><body><div id="root"></div><script src="app.js"></script></body></html>`)));
    expect(r).toEqual({ ok: false, error: expect.stringContaining("no tiene contenido") });
  });

  it("el nombre del archivo se limpia (sin carpetas ni caracteres de control)", async () => {
    const r = await inspectHtmlUpload(formWith(htmlFile(LANDING, "C:\\Users\\x\\mi\u0001 landing.html")));
    expect(r.ok && r.data.fileName).toBe("mi landing.html");
  });
});

describe("importHtml (F41, F42)", () => {
  async function inspected(file: File) {
    const r = await inspectHtmlUpload(formWith(file));
    if (!r.ok) throw new Error(r.error);
    return r.data;
  }

  it("crea el diseño con origin html, la versión «import» y el negocio de la sesión", async () => {
    const data = await inspected(htmlFile(LANDING));
    const r = await importHtml({ uploadId: data.uploadId, kind: "design", as: "web" });
    expect(r).toEqual({ ok: true, data: { id: "id-1", kind: "design", href: "/dashboard/disenos/d/id-1" } });
    const row = state.rows.designs[0] as Row;
    expect(row).toMatchObject({ workspace_id: WS, name: "landing", format: "web", origin: "html", status: "draft", allow_download: false, created_by: USER });
    const doc = row.doc as { format: string; pages: { elements: { type: string; html: string; w: number; h: number }[] }[] };
    expect(doc.format).toBe("web");
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0].elements[0]).toMatchObject({ type: "html", w: 100, h: 100 });
    expect(doc.pages[0].elements[0].html).not.toMatch(/<script|<form/);
    expect(state.rows.design_versions[0]).toMatchObject({ workspace_id: WS, design_id: "id-1", reason: "import", author_kind: "user", author_id: USER });
  });

  it("deja el primer mensaje del chat", async () => {
    const data = await inspected(htmlFile(LANDING));
    await importHtml({ uploadId: data.uploadId, kind: "design", as: "web" });
    expect(state.greetings).toHaveLength(1);
    expect(state.greetings[0]).toMatchObject({ role: "assistant", content: expect.stringContaining("Cargué landing.html: una página web.") });
  });

  it("una presentación se parte en una página por diapositiva y el nombre puede ser el que eligió la persona", async () => {
    const data = await inspected(htmlFile(SLIDES, "deck.html"));
    const r = await importHtml({ uploadId: data.uploadId, kind: "design", as: "slides", name: "  Mi presentación  " });
    expect(r.ok).toBe(true);
    const row = state.rows.designs[0] as Row;
    expect(row).toMatchObject({ name: "Mi presentación", format: "wide", allow_download: true });
    expect((row.doc as { pages: unknown[] }).pages).toHaveLength(3);
  });

  it("una plantilla va a design_templates y nunca puede ser una página web", async () => {
    const web = await inspected(htmlFile(LANDING));
    expect(await importHtml({ uploadId: web.uploadId, kind: "template", as: "web" })).toEqual({ ok: false, error: expect.stringContaining("plantilla no puede ser una página web") });
    expect(state.rows.design_templates).toHaveLength(0);

    const slides = await inspected(htmlFile(SLIDES, "deck.html"));
    const r = await importHtml({ uploadId: slides.uploadId, kind: "template", as: "slides" });
    expect(r).toEqual({ ok: true, data: { id: "id-1", kind: "template", href: "/dashboard/disenos/t/id-1" } });
    expect(state.rows.design_templates[0]).toMatchObject({ workspace_id: WS, origin: "html", format: "wide", created_by: USER });
    expect(state.rows.design_versions[0]).toMatchObject({ template_id: "id-1", reason: "import" });
    expect(state.rows.designs).toHaveLength(0);
  });

  it("sin el permiso no crea nada", async () => {
    const data = await inspected(htmlFile(LANDING));
    state.allowed = false;
    expect(await importHtml({ uploadId: data.uploadId, kind: "design", as: "web" })).toMatchObject({ ok: false });
    expect(state.rows.designs).toHaveLength(0);
  });

  it("una carga de otro negocio no existe para esta persona", async () => {
    const data = await inspected(htmlFile(LANDING));
    state.workspaceId = OTHER_WS;
    const r = await importHtml({ uploadId: data.uploadId, kind: "design", as: "web" });
    expect(r).toEqual({ ok: false, error: expect.stringContaining("No encontramos el archivo cargado") });
    expect(state.rows.designs).toHaveLength(0);
  });

  it("rechaza datos mal formados", async () => {
    expect(await importHtml({ uploadId: "../../otra", kind: "design", as: "web" })).toMatchObject({ ok: false });
    const data = await inspected(htmlFile(LANDING));
    expect(await importHtml({ uploadId: data.uploadId, kind: "otro" as never, as: "web" })).toMatchObject({ ok: false });
    expect(await importHtml({ uploadId: data.uploadId, kind: "design", as: "pdf" as never })).toMatchObject({ ok: false });
    expect(state.rows.designs).toHaveLength(0);
  });

  it("aunque alguien toque el registro guardado, lo que se escribe pasa de nuevo por la limpieza", async () => {
    const data = await inspected(htmlFile(LANDING));
    const path = `${WS}/imports/${data.uploadId}/import.json`;
    const record = JSON.parse(new TextDecoder().decode(state.files.get(path)?.bytes));
    record.html = `${record.html}<script>alert("tocado")</script><img src=x onerror=alert(1)>`;
    record.css = `${record.css} .x{background:url(https://evil.example/x.png)}`;
    state.files.set(path, { bytes: strToU8(JSON.stringify(record)) });
    const r = await importHtml({ uploadId: data.uploadId, kind: "design", as: "web" });
    expect(r.ok).toBe(true);
    const saved = JSON.stringify((state.rows.designs[0] as Row).doc);
    expect(saved).not.toMatch(/<script|onerror|evil\.example|tocado/);
  });

  it("un registro roto no crea nada", async () => {
    const data = await inspected(htmlFile(LANDING));
    state.files.set(`${WS}/imports/${data.uploadId}/import.json`, { bytes: strToU8("{no es json") });
    expect(await importHtml({ uploadId: data.uploadId, kind: "design", as: "web" })).toMatchObject({ ok: false });
    expect(state.rows.designs).toHaveLength(0);
  });

  it("si falla guardar la versión, el diseño no queda a medias", async () => {
    const data = await inspected(htmlFile(LANDING));
    state.failVersionInsert = true;
    expect(await importHtml({ uploadId: data.uploadId, kind: "design", as: "web" })).toEqual({ ok: false, error: expect.stringContaining("No se pudo crear el diseño") });
    expect(state.rows.designs).toHaveLength(0);
  });

  it("más de 20 diapositivas se rechaza con un motivo claro", async () => {
    const many = `<style>.slide{width:1920px;height:1080px}</style>${Array.from({ length: 21 }, (_, i) => `<div class="slide"><h1>${i}</h1></div>`).join("")}`;
    const data = await inspected(htmlFile(many, "muchas.html"));
    expect(data.detected.pages).toBe(21);
    expect(await importHtml({ uploadId: data.uploadId, kind: "design", as: "slides" })).toEqual({ ok: false, error: expect.stringContaining("21 diapositivas") });
  });
});
