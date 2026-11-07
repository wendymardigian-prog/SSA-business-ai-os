import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/designer/testing/editor-memory-db";

const WS = "11111111-2222-3333-4444-555555555555";
const OTHER_WS = "99999999-2222-3333-4444-555555555555";
const USER = "aaaaaaaa-2222-3333-4444-555555555555";

const asked: string[] = [];
let allowed = new Set<string>(["designer.view", "designer.edit"]);
let db = memoryDb({});
const uploads: Array<{ path: string; bytes: Uint8Array }> = [];
const signedRequests: string[][] = [];

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth/guards", () => ({
  getPermissionAction: async (key: string) => {
    asked.push(key);
    return allowed.has(key) ? { workspace: { id: WS, design_settings: {}, brand_color: "#112233", timezone: "UTC" }, user: { id: USER }, supabase: authedClient() } : null;
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => serviceClient() }));
vi.mock("@/lib/workspace-members", () => ({ getWorkspaceMembers: async () => [{ userId: USER, name: "Ana Pérez" }] }));

const startAiDesign = vi.fn();
const proposeTemplateTexts = vi.fn();
vi.mock("@/lib/actions/designer/ai", () => ({ startAiDesign: (...a: unknown[]) => startAiDesign(...a), proposeTemplateTexts: (...a: unknown[]) => proposeTemplateTexts(...a) }));

function storage() {
  return {
    from: () => ({
      upload: async (path: string, bytes: Uint8Array) => {
        uploads.push({ path, bytes });
        return { error: null };
      },
      createSignedUrls: async (paths: string[]) => {
        signedRequests.push(paths);
        return { data: paths.map((path) => ({ path, signedUrl: `https://s.test/${path}` })), error: null };
      },
      list: async () => ({ data: [{ name: "a.png" }, { name: "b.jpg" }], error: null }),
    }),
  };
}
const serviceClient = () => ({ ...db.client, storage: storage() });
const authedClient = () => ({ ...db.client, storage: storage() });

import { archiveDesign, createDesign, deleteDesign, listUploadedImages, renameDesign, saveDesignDoc, signDesignAssetUrls, uploadDesignImageAction } from "./designs";

beforeEach(() => {
  asked.length = 0;
  allowed = new Set(["designer.view", "designer.edit"]);
  db = memoryDb({ designs: [], design_templates: [], design_versions: [], audit_log: [], ai_threads: [] });
  uploads.length = 0;
  signedRequests.length = 0;
  startAiDesign.mockReset();
  proposeTemplateTexts.mockReset();
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const fileForm = (bytes: Uint8Array, name: string, type: string) => {
  const form = new FormData();
  form.set("file", new File([bytes as BlobPart], name, { type }));
  return form;
};

describe("createDesign (F16)", () => {
  it("sin designer.edit no hace nada", async () => {
    allowed = new Set(["designer.view"]);
    expect(await createDesign({ kind: "design", origin: "blank", format: "v45", multiPage: false })).toMatchObject({ ok: false });
    expect(asked).toEqual(["designer.edit"]);
    expect(db.log).toEqual([]);
  });

  it("en blanco crea el diseño con el color de la marca del negocio", async () => {
    const out = await createDesign({ kind: "design", origin: "blank", format: "sq", multiPage: false });
    expect(out).toMatchObject({ ok: true, data: { kind: "design", notice: null } });
    const doc = db.tables.designs[0].doc as { pages: Array<{ background: { color: string } }> };
    expect(doc.pages[0].background.color).toBe("#112233");
    expect(db.tables.designs[0].workspace_id).toBe(WS);
    expect(startAiDesign).not.toHaveBeenCalled();
  });

  it("con IA crea el diseño y le pide la primera versión a startAiDesign", async () => {
    startAiDesign.mockResolvedValue({ ok: true, data: { threadId: "t", messageId: "m" } });
    const out = await createDesign({ kind: "design", origin: "ai", format: "v45", multiPage: true, style: "social", prompt: "  Un carrusel  " });
    expect(out).toMatchObject({ ok: true, data: { notice: null } });
    const id = db.tables.designs[0].id;
    expect(startAiDesign).toHaveBeenCalledWith({ kind: "design", id, prompt: "Un carrusel", style: "social", attachments: [], multiPage: true });
  });

  it("le pasa a la IA si se eligió una página o varias y el contexto de la pieza de Contenido", async () => {
    startAiDesign.mockResolvedValue({ ok: true, data: { threadId: "t", messageId: "m" } });
    const contentContext = { postId: "p1", network: "instagram", script: ["Portada", "Cierre"] };
    await createDesign({ kind: "design", origin: "ai", format: "v45", multiPage: false, prompt: "Algo", contentContext });
    expect(startAiDesign).toHaveBeenCalledWith(expect.objectContaining({ multiPage: false, contentContext }));
  });

  it("si la IA todavía no está construida, el diseño igual queda creado y se avisa (notice «pendiente»)", async () => {
    startAiDesign.mockResolvedValue({ ok: false, error: "Todavía no está construido (Ola 2)." });
    const out = await createDesign({ kind: "design", origin: "ai", format: "v45", multiPage: false, prompt: "Algo" });
    expect(out).toMatchObject({ ok: true, data: { notice: "pendiente" } });
    expect(db.tables.designs).toHaveLength(1);
  });

  it("si la IA responde con otro error, el diseño queda y el aviso es «error»", async () => {
    startAiDesign.mockResolvedValue({ ok: false, error: "No hay clave de IA conectada." });
    const out = await createDesign({ kind: "design", origin: "ai", format: "v45", multiPage: false, prompt: "Algo" });
    expect(out).toMatchObject({ ok: true, data: { notice: "error" } });
    expect(db.tables.designs).toHaveLength(1);
  });

  it("una plantilla desde una imagen con «Que la IA me proponga…» llama a proposeTemplateTexts", async () => {
    proposeTemplateTexts.mockResolvedValue({ ok: true, data: { messageId: "m" } });
    const out = await createDesign({ kind: "template", origin: "image", format: "carta_h", multiPage: false, baseImagePath: `${WS}/images/base.png`, proposeTexts: true });
    expect(out).toMatchObject({ ok: true, data: { kind: "template" } });
    expect(proposeTemplateTexts).toHaveBeenCalledWith({ templateId: db.tables.design_templates[0].id });
    const doc = db.tables.design_templates[0].doc as { pages: Array<{ background: { type: string; image: { locked: boolean } } }> };
    expect(doc.pages[0].background.type).toBe("image");
    expect(doc.pages[0].background.image.locked).toBe(true);
  });

  it("sin pedir la propuesta, no llama a la IA", async () => {
    await createDesign({ kind: "template", origin: "image", format: "carta_h", multiPage: false, baseImagePath: `${WS}/images/base.png`, proposeTexts: false });
    expect(proposeTemplateTexts).not.toHaveBeenCalled();
  });

  it("una imagen adjunta de otro negocio se rechaza antes de crear nada", async () => {
    const out = await createDesign({ kind: "design", origin: "ai", format: "v45", multiPage: false, prompt: "x", attachments: [{ asset_path: `${OTHER_WS}/images/a.png`, name: "a.png", mime: "image/png" }] });
    expect(out).toMatchObject({ ok: false });
    expect(db.log).toEqual([]);
    expect(startAiDesign).not.toHaveBeenCalled();
  });

  it("no más de seis imágenes al pedirle a la IA", async () => {
    const attachments = Array.from({ length: 7 }, (_, i) => ({ asset_path: `${WS}/images/${i}.png`, name: `${i}.png`, mime: "image/png" }));
    expect(await createDesign({ kind: "design", origin: "ai", format: "v45", multiPage: false, prompt: "x", attachments })).toMatchObject({ ok: false });
  });
});

describe("subir imágenes (F22)", () => {
  it("un PNG de verdad se sube a la carpeta del negocio y devuelve su link firmado", async () => {
    const out = await uploadDesignImageAction(fileForm(PNG, "foto.png", "image/png"));
    expect(out).toMatchObject({ ok: true, data: { name: "foto.png", mime: "image/png" } });
    expect(out.ok && out.data.path.startsWith(`${WS}/images/`)).toBe(true);
    expect(out.ok && out.data.url).toContain("https://s.test/");
    expect(uploads).toHaveLength(1);
  });

  it("un archivo .png que NO es un PNG se rechaza: se mira por los bytes", async () => {
    const out = await uploadDesignImageAction(fileForm(new TextEncoder().encode("esto es texto, no una imagen"), "falso.png", "image/png"));
    expect(out).toMatchObject({ ok: false });
    expect(uploads).toHaveLength(0);
  });

  it("un SVG se rechaza con «Usá PNG o JPG», aunque diga ser un PNG", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');
    for (const [name, type] of [["logo.svg", "image/svg+xml"], ["logo.png", "image/png"]] as const) {
      const out = await uploadDesignImageAction(fileForm(svg, name, type));
      expect(out.ok).toBe(false);
      expect(out.ok === false && out.error).toContain("Usá PNG o JPG");
    }
    expect(uploads).toHaveLength(0);
  });

  it("sin designer.edit no sube nada", async () => {
    allowed = new Set(["designer.view"]);
    expect(await uploadDesignImageAction(fileForm(PNG, "foto.png", "image/png"))).toMatchObject({ ok: false });
    expect(uploads).toHaveLength(0);
  });

  it("sin archivo, avisa", async () => {
    expect(await uploadDesignImageAction(new FormData())).toMatchObject({ ok: false });
  });

  it("firmar archivos descarta lo que no es de este negocio", async () => {
    const out = await signDesignAssetUrls([`${WS}/images/a.png`, `${OTHER_WS}/images/b.png`, `${WS}/../${OTHER_WS}/images/c.png`, "../x"]);
    expect(out).toEqual({ ok: true, data: { [`${WS}/images/a.png`]: `https://s.test/${WS}/images/a.png` } });
    expect(signedRequests).toEqual([[`${WS}/images/a.png`]]);
  });

  it("las imágenes ya subidas salen de la carpeta del negocio", async () => {
    const out = await listUploadedImages();
    expect(out.ok && out.data.map((i) => i.path)).toEqual([`${WS}/images/a.png`, `${WS}/images/b.jpg`]);
  });
});

describe("permisos de cada acción (las tres capas: acá, la de la acción)", () => {
  it("guardar y renombrar piden designer.edit; borrar, designer.manage", async () => {
    allowed = new Set(["designer.view"]);
    expect(await saveDesignDoc({ kind: "design", id: "d1", doc: {}, rev: 0 })).toMatchObject({ ok: false });
    expect(await renameDesign({ kind: "design", id: "d1", name: "x" })).toMatchObject({ ok: false });
    expect(await archiveDesign({ kind: "design", id: "d1" })).toMatchObject({ ok: false });
    expect(await deleteDesign({ kind: "design", id: "d1" })).toMatchObject({ ok: false });
    expect(asked).toEqual(["designer.edit", "designer.edit", "designer.edit", "designer.manage"]);
    expect(db.log).toEqual([]);
  });

  it("un Member (edit sin manage) no borra aunque el diseño sea un borrador sin uso", async () => {
    db = memoryDb({ designs: [{ id: "d1", workspace_id: WS, published: false, published_at: null, template_id: null, content_post_id: null }] });
    expect(await deleteDesign({ kind: "design", id: "d1" })).toMatchObject({ ok: false });
    expect(db.tables.designs).toHaveLength(1);
    allowed = new Set(["designer.view", "designer.edit", "designer.manage"]);
    expect(await deleteDesign({ kind: "design", id: "d1" })).toMatchObject({ ok: true });
    expect(db.tables.designs).toHaveLength(0);
  });
});
