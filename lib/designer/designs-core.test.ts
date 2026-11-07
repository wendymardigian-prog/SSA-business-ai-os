import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import { parseDesignDoc } from "./doc/schema";
import { cleanName, createDesignCore, hrefFor, isOwnImagePath, type CoreEnv, type CreateContext } from "./designs-core";
import type { CreateDesignInput } from "./contracts";

const WS = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-2222-3333-4444-555555555555";
const USER = "aaaaaaaa-2222-3333-4444-555555555555";
const ctx: CreateContext = { brandColor: "#0f1115", customStyles: [] };

function setup(handlers: Parameters<typeof fakeDb>[0] = {}) {
  const fake = fakeDb({ designs: { data: { id: "new-design" } }, design_templates: { data: { id: "new-template" } }, ...handlers });
  const env: CoreEnv = { service: fake.client, actor: { workspaceId: WS, userId: USER } };
  return { fake, env };
}

const input = (patch: Partial<CreateDesignInput> = {}): CreateDesignInput => ({ kind: "design", origin: "blank", format: "v45", multiPage: false, ...patch });

describe("crear un diseño o una plantilla (F16)", () => {
  it("en blanco: crea un diseño con el fondo de la marca, su versión inicial y el historial", async () => {
    const { fake, env } = setup();
    const out = await createDesignCore(env, input(), ctx);
    expect(out).toMatchObject({ ok: true, data: { id: "new-design", kind: "design", href: "/dashboard/disenos/d/new-design" } });
    const [insert] = fake.writesTo("designs");
    expect(insert.values).toMatchObject({ workspace_id: WS, name: "Diseño nuevo", format: "v45", origin: "blank", created_by: USER });
    expect(parseDesignDoc((insert.values as { doc: unknown }).doc).ok).toBe(true);
    const doc = (insert.values as { doc: { pages: Array<{ background: { color: string } }> } }).doc;
    expect(doc.pages[0].background.color).toBe("#0f1115");
    expect(fake.writesTo("design_versions")).toHaveLength(1);
    expect(fake.writesTo("design_versions")[0].values).toMatchObject({ design_id: "new-design", template_id: null, reason: "manual", author_kind: "user", author_id: USER });
    expect(fake.writesTo("audit_log")).toHaveLength(1);
    expect(fake.writesTo("audit_log")[0].values).toMatchObject({ action: "design.created", entity_type: "design" });
  });

  it("una plantilla va a su tabla, con su versión de plantilla", async () => {
    const { fake, env } = setup();
    const out = await createDesignCore(env, input({ kind: "template", format: "carta_h", name: "  Constancia   de curso " }), ctx);
    expect(out).toMatchObject({ ok: true, data: { id: "new-template", href: "/dashboard/disenos/t/new-template" } });
    expect(fake.writesTo("design_templates")[0].values).toMatchObject({ name: "Constancia de curso", format: "carta_h", workspace_id: WS });
    expect(fake.writesTo("designs")).toHaveLength(0);
    expect(fake.writesTo("design_versions")[0].values).toMatchObject({ template_id: "new-template", design_id: null });
    expect(fake.writesTo("audit_log")[0].values).toMatchObject({ action: "design_template.created", entity_type: "design_template" });
  });

  it("desde una imagen: la imagen queda de fondo bloqueado, ajuste «Cubrir» (background.type = image)", async () => {
    const { fake, env } = setup();
    const out = await createDesignCore(env, input({ origin: "image", format: "carta_h", baseImagePath: `${WS}/images/base.png` }), ctx);
    expect(out.ok).toBe(true);
    const doc = (fake.writesTo("designs")[0].values as { doc: { pages: Array<{ background: { type: string; image: { fit: string; locked: boolean; asset: string } } }> } }).doc;
    expect(doc.pages[0].background.type).toBe("image");
    expect(doc.pages[0].background.image).toMatchObject({ fit: "cover", locked: true, asset: `${WS}/images/base.png` });
  });

  it("desde una imagen sin imagen, o con la de otro negocio, se rechaza y no escribe nada", async () => {
    const { fake, env } = setup();
    expect(await createDesignCore(env, input({ origin: "image" }), ctx)).toMatchObject({ ok: false });
    expect(await createDesignCore(env, input({ origin: "image", baseImagePath: `${OTHER}/images/a.png` }), ctx)).toMatchObject({ ok: false });
    expect(await createDesignCore(env, input({ origin: "image", baseImagePath: `${WS}/fonts/a.png` }), ctx)).toMatchObject({ ok: false });
    expect(await createDesignCore(env, input({ origin: "image", baseImagePath: `${WS}/images/../../${OTHER}/images/a.png` }), ctx)).toMatchObject({ ok: false });
    expect(fake.writes()).toEqual([]);
  });

  it("con IA: crea una página vacía con el estilo (la acción le pide la primera versión a DS3)", async () => {
    const { fake, env } = setup();
    const out = await createDesignCore(env, input({ origin: "ai", style: "social", prompt: "Un carrusel" }), ctx);
    expect(out.ok).toBe(true);
    const doc = (fake.writesTo("designs")[0].values as { doc: { style: string; pages: Array<{ elements: unknown[] }> }; style: string }).doc;
    expect(doc.style).toBe("social");
    expect(doc.pages[0].elements).toEqual([]);
    expect(fake.writesTo("designs")[0].values).toMatchObject({ style: "social", origin: "ai" });
  });

  it("un estilo que no existe se rechaza; uno propio del negocio se acepta", async () => {
    const { env } = setup();
    expect(await createDesignCore(env, input({ origin: "ai", style: "inexistente" }), ctx)).toMatchObject({ ok: false });
    const custom = {
      key: "c_abc123",
      name: "Mío",
      palette: { bg: "#ffffff", text: "#111111", accent: "#ff0000" },
      fonts: { title: "Inter", body: "Inter" },
      density: {},
      rules: "",
    };
    expect(await createDesignCore(env, input({ origin: "ai", style: "c_abc123" }), { ...ctx, customStyles: [custom] })).toMatchObject({ ok: true });
  });

  it("«Cargar HTML» no se crea acá (lo hace importHtml)", async () => {
    const { fake, env } = setup();
    expect(await createDesignCore(env, input({ origin: "html" }), ctx)).toMatchObject({ ok: false });
    expect(fake.writes()).toEqual([]);
  });

  it("la página web no se crea con varias páginas ni como plantilla; el formato tiene que existir", async () => {
    const { fake, env } = setup();
    expect(await createDesignCore(env, input({ format: "web", multiPage: true }), ctx)).toMatchObject({ ok: false });
    expect(await createDesignCore(env, input({ kind: "template", format: "web" }), ctx)).toMatchObject({ ok: false });
    expect(await createDesignCore(env, input({ format: "otro" as never }), ctx)).toMatchObject({ ok: false });
    expect(fake.writes()).toEqual([]);
    expect(await createDesignCore(env, input({ format: "web" }), ctx)).toMatchObject({ ok: true });
  });

  it("«Varias páginas» arranca con dos", async () => {
    const { fake, env } = setup();
    await createDesignCore(env, input({ multiPage: true }), ctx);
    const doc = (fake.writesTo("designs")[0].values as { doc: { pages: unknown[] } }).doc;
    expect(doc.pages).toHaveLength(2);
  });

  it("un fallo al guardar la versión no tumba la creación", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { env } = setup({ design_versions: { error: { message: "x", code: "XX" } } });
    expect(await createDesignCore(env, input(), ctx)).toMatchObject({ ok: true });
    spy.mockRestore();
  });

  it("un error de la base se avisa en español, sin datos técnicos", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { env } = setup({ designs: { error: { message: "boom", code: "XX000" } } });
    const out = await createDesignCore(env, input(), ctx);
    expect(out).toEqual({ ok: false, error: "No pudimos crear el diseño. Probá de nuevo." });
    spy.mockRestore();
  });

  it("nombres: se limpian los espacios y se respetan los largos de la base", () => {
    expect(cleanName("  Hola   mundo ", "design")).toBe("Hola mundo");
    expect(cleanName("", "design")).toBeNull();
    expect(cleanName("x".repeat(201), "design")).toBeNull();
    expect(cleanName("x".repeat(121), "template")).toBeNull();
    expect(cleanName("x".repeat(120), "template")).toHaveLength(120);
    expect(cleanName(3, "design")).toBeNull();
  });

  it("rutas de imagen: solo la carpeta de imágenes del propio negocio", () => {
    expect(isOwnImagePath(`${WS}/images/a.png`, WS)).toBe(true);
    expect(isOwnImagePath(`${WS}/fonts/a.woff2`, WS)).toBe(false);
    expect(isOwnImagePath(`${OTHER}/images/a.png`, WS)).toBe(false);
    expect(isOwnImagePath(undefined, WS)).toBe(false);
    expect(hrefFor("design", "x")).toBe("/dashboard/disenos/d/x");
  });
});
