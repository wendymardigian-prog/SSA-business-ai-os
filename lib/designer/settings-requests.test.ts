import { describe, expect, it, vi } from "vitest";
import type { AiRunHandle } from "@/lib/ai/run";
import type { DesignerGenerate, DesignerGenerateArgs } from "./ai/provider";
import { memoryDb, PNG_BYTES } from "./ai/test-db";
import { carousel, WS } from "./ai/test-fixtures";
import { addGoogleFontRequest, archiveStyleRequest, extractStyleRequest, familyFromFileName, removeFontRequest, saveStyleRequest, uploadFontRequest } from "./settings-requests";
import type { DesignStyle } from "./styles";

const USER = "22222222-2222-2222-2222-222222222222";
const who = { workspaceId: WS, userId: USER };

const style = (over: Partial<DesignStyle> = {}): DesignStyle => ({ key: "c_abc123", name: "Mi estilo", palette: { bg: "#101820", text: "#fef9ef", accent: "#f2aa4c" }, fonts: { title: "Archivo Black", body: "Inter" }, density: { v45: 22, story: 16 }, rules: "Fondo oscuro.", ...over });

function setup(settings: Record<string, unknown> = {}, options: Parameters<typeof memoryDb>[1] = {}) {
  return memoryDb(
    {
      workspaces: [{ id: WS, name: "Academia Ejemplo", brand_name: "Academia Ejemplo", design_settings: settings, timezone: "UTC", updated_at: "2026-11-07T10:00:00.000000+00:00" }],
      audit_log: [],
      designs: [{ id: "d1", workspace_id: WS, name: "Pieza uno", doc: carousel(), format: "v45" }],
    },
    options,
  );
}
const settingsOf = (s: ReturnType<typeof setup>) => s.tables.workspaces[0].design_settings as { styles?: DesignStyle[]; fonts?: { google?: string[]; uploaded?: { family: string; weight: number; path: string; format: string }[] } };

const fakeRun = (): AiRunHandle => ({ runId: "run_1", setModel() {}, addStepUsage() {}, setFinalUsage() {}, addEmbeddingUsage() {}, addAudioUsage() {}, step: async () => null, setRouting() {}, setIntent() {}, close: async () => ({ costUsd: 0.02, pricingMissing: [] }) });

describe("settings: guardar y archivar estilos propios (F37)", () => {
  it("guarda un estilo nuevo en design_settings.styles, validado, y lo audita", async () => {
    const s = setup();
    const r = await saveStyleRequest(s.db, who, style());
    expect(r.ok).toBe(true);
    expect(settingsOf(s).styles).toHaveLength(1);
    expect(settingsOf(s).styles?.[0]).toMatchObject({ key: "c_abc123", name: "Mi estilo", palette: { accent: "#f2aa4c" } });
    expect(s.tables.audit_log[0]).toMatchObject({ entity_type: "workspace", entity_id: WS, action: "design_template.settings_changed", performed_by: USER, metadata: { kind: "design_settings", change: "style_saved", style: "Mi estilo" } });
  });

  it("corrige una fuente fuera de la lista a la más cercana antes de guardar", async () => {
    const s = setup();
    const r = await saveStyleRequest(s.db, who, style({ fonts: { title: "Playfair", body: "Montserat" } }));
    expect(r.ok && r.data.style.fonts).toEqual({ title: "Playfair Display", body: "Montserrat" });
    expect(settingsOf(s).styles?.[0].fonts).toEqual({ title: "Playfair Display", body: "Montserrat" });
  });

  it("editar un estilo lo reemplaza (misma clave) y no duplica", async () => {
    const s = setup();
    await saveStyleRequest(s.db, who, style());
    await saveStyleRequest(s.db, who, style({ name: "Mi estilo v2" }));
    expect(settingsOf(s).styles).toHaveLength(1);
    expect(settingsOf(s).styles?.[0].name).toBe("Mi estilo v2");
  });

  it("no acepta un estilo sin nombre ni dos con el mismo nombre", async () => {
    const s = setup();
    expect(await saveStyleRequest(s.db, who, style({ name: "   " }))).toEqual({ ok: false, error: "El estilo necesita un nombre." });
    await saveStyleRequest(s.db, who, style());
    expect(await saveStyleRequest(s.db, who, style({ key: "c_otro99", name: "mi ESTILO" }))).toEqual({ ok: false, error: "Ya tenés un estilo con ese nombre." });
  });

  it("una clave que no es de un estilo propio se reemplaza por una propia (nunca pisa uno de fábrica)", async () => {
    const s = setup();
    const r = await saveStyleRequest(s.db, who, style({ key: "social" }));
    expect(r.ok && r.data.style.key).toMatch(/^c_/);
  });

  it("archivar lo saca de los que se ofrecen pero lo deja guardado; se restaura guardándolo de nuevo", async () => {
    const s = setup();
    await saveStyleRequest(s.db, who, style());
    expect(await archiveStyleRequest(s.db, who, "c_abc123")).toEqual({ ok: true, data: undefined });
    expect(settingsOf(s).styles?.[0]).toMatchObject({ key: "c_abc123", archived: true });
    expect(s.tables.audit_log.at(-1)?.metadata).toMatchObject({ change: "style_archived" });
    expect((await archiveStyleRequest(s.db, who, "c_nope99")).ok).toBe(false);
    await saveStyleRequest(s.db, who, style({ archived: false }));
    expect(settingsOf(s).styles?.[0].archived).toBeUndefined();
  });

  it("si otra persona guarda en el medio (cambia updated_at), vuelve a leer y no pierde ninguno de los dos cambios", async () => {
    let raced = false;
    const s = setup(
      {},
      {
        beforeUpdate: (table, rows) => {
          if (table === "workspaces" && !raced) {
            raced = true;
            const row = rows[0] as { design_settings: Record<string, unknown>; updated_at: string };
            row.design_settings = { v: 1, fonts: { google: ["Lobster"] } }; // otra persona agregó una fuente
            row.updated_at = "2026-11-07T10:00:05.000000+00:00";
          }
        },
      },
    );
    const r = await saveStyleRequest(s.db, who, style());
    expect(r.ok).toBe(true);
    expect(settingsOf(s).styles).toHaveLength(1);
    expect(settingsOf(s).fonts?.google).toEqual(["Lobster"]);
  });

  it("nunca escribe en otro negocio", async () => {
    const s = setup();
    const r = await saveStyleRequest(s.db, { workspaceId: "99999999-2222-3333-4444-555555555555", userId: USER }, style());
    expect(r.ok).toBe(false);
    expect(settingsOf(s).styles).toBeUndefined();
  });
});

describe("settings: extraer un estilo de mis piezas (F37, proveedor simulado)", () => {
  const extracted = { name: "Estilo extraído", palette: { bg: "#101820", text: "#fef9ef", accent: "#f2aa4c" }, fonts: { title: "Bebas", body: "Inter" }, density: { social: 22, story: 16, slides: 36, print: 110, web: 350 }, rules: "Fondo oscuro." };
  const calls: DesignerGenerateArgs<unknown>[] = [];
  const generate: DesignerGenerate = async <T,>(args: DesignerGenerateArgs<T>) => {
    calls.push(args as DesignerGenerateArgs<unknown>);
    return { object: extracted as T, usage: { inputTokens: 10, outputTokens: 5 } };
  };
  const files = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `pieza-${i}.png`, bytes: PNG_BYTES }));
  const deps = (over = {}) => ({ model: { generate, provider: "anthropic", modelId: "claude-test" }, budget: async () => ({ allowed: true }), openRun: vi.fn(async (..._args: unknown[]) => fakeRun()) as never, ...over });

  it("con 3 imágenes devuelve un estilo válido con las fuentes corregidas y NO lo guarda", async () => {
    calls.length = 0;
    const s = setup();
    const d = deps();
    const r = await extractStyleRequest(s.db, { ...who, files: files(3), designIds: [] }, d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.style.name).toBe("Estilo extraído");
    expect(r.data.style.fonts.title).toBe("Bebas Neue");
    expect(r.data.corrections[0]).toMatch(/«Bebas»/);
    expect(calls[0].images).toHaveLength(3);
    expect(settingsOf(s).styles).toBeUndefined();
    expect(d.openRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ source: "designer", trigger: "manual", workspaceId: WS }));
  });

  it("pide entre 3 y 5 piezas contando imágenes y diseños", async () => {
    const s = setup();
    expect((await extractStyleRequest(s.db, { ...who, files: files(2), designIds: [] }, deps())).ok).toBe(false);
    expect((await extractStyleRequest(s.db, { ...who, files: files(4), designIds: ["d1", "d1", "d1"] }, deps())).ok).toBe(false);
  });

  it("rechaza por sus bytes algo que no es una imagen (aunque se llame .png)", async () => {
    const s = setup();
    const r = await extractStyleRequest(s.db, { ...who, files: [...files(2), { name: "falsa.png", bytes: new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>") }], designIds: [] }, deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/falsa\.png/);
  });

  it("con el tope alcanzado no llama al proveedor", async () => {
    calls.length = 0;
    const s = setup();
    const r = await extractStyleRequest(s.db, { ...who, files: files(3), designIds: [] }, deps({ budget: async () => ({ allowed: false, message: "El workspace llego a su tope mensual de gasto de IA (USD 50)." }) }));
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/^Llegaste al tope de gasto de IA de este mes/) });
    expect(calls).toHaveLength(0);
  });

  it("sin ninguna IA conectada dice «Conectá una clave de IA en Configuración»", async () => {
    const s = setup();
    const r = await extractStyleRequest(s.db, { ...who, files: files(3), designIds: [] }, { model: null, budget: async () => ({ allowed: true }) });
    expect(r).toEqual({ ok: false, error: "Conectá una clave de IA en Configuración" });
  });

  it("un diseño elegido se dibuja con el servicio de render (simulado) y cuenta como una pieza", async () => {
    calls.length = 0;
    const s = setup();
    const measure = () => async () => ({ status: "ok" as const, measure: [], images: [PNG_BYTES] });
    const r = await extractStyleRequest(s.db, { ...who, files: files(2), designIds: ["d1"] }, deps({ measure }));
    expect(r.ok).toBe(true);
    expect(calls[0].images).toHaveLength(3);
    expect(calls[0].text).toContain("Pieza uno");
  });

  it("sin servicio de render, un diseño elegido no se puede usar y lo dice", async () => {
    const s = setup();
    const measure = () => async () => ({ status: "unavailable" as const, reason: "not_configured" as const });
    const r = await extractStyleRequest(s.db, { ...who, files: files(2), designIds: ["d1"] }, deps({ measure }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/servicio de render/);
  });

  it("un diseño de otro negocio no se puede elegir", async () => {
    const s = setup();
    const measure = () => async () => ({ status: "ok" as const, measure: [], images: [PNG_BYTES] });
    const r = await extractStyleRequest(s.db, { workspaceId: "99999999-2222-3333-4444-555555555555", userId: USER, files: files(2), designIds: ["d1"] }, deps({ measure }));
    expect(r.ok).toBe(false);
  });

  it("un fallo del proveedor no lanza: avisa", async () => {
    const s = setup();
    const boom: DesignerGenerate = async () => {
      throw new Error("503");
    };
    const r = await extractStyleRequest(s.db, { ...who, files: files(3), designIds: [] }, deps({ model: { generate: boom, provider: "anthropic", modelId: "x" } }));
    expect(r).toEqual({ ok: false, error: "La IA no respondió. Probá de nuevo en un momento." });
  });
});

describe("settings: fuentes de Google (F11)", () => {
  const status = (code: number) => vi.fn(async (..._args: unknown[]) => ({ status: code }) as Response) as unknown as typeof fetch;

  it("la valida pidiéndola a Google desde el servidor (200 = existe) y la agrega", async () => {
    const s = setup();
    const f = status(200);
    const r = await addGoogleFontRequest(s.db, who, "Rubik Mono One", f);
    expect(r).toEqual({ ok: true, data: { family: "Rubik Mono One" } });
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("https://fonts.googleapis.com/css2?family=Rubik+Mono+One");
    expect(settingsOf(s).fonts?.google).toEqual(["Rubik Mono One"]);
  });

  it("una que Google no tiene (400) se rechaza y no se guarda", async () => {
    const s = setup();
    const r = await addGoogleFontRequest(s.db, who, "Fuente Que No Existe", status(400));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/No encontré «Fuente Que No Existe» en Google Fonts/);
    expect(settingsOf(s).fonts).toBeUndefined();
  });

  it("si Google no responde, no se guarda y se dice que se pruebe de nuevo (no que no existe)", async () => {
    const s = setup();
    const r = await addGoogleFontRequest(s.db, who, "Lobster", vi.fn(async () => { throw new Error("red"); }) as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/No pude comprobar la fuente con Google/);
    expect((await addGoogleFontRequest(s.db, who, "Lobster", status(503))).ok).toBe(false);
  });

  it("una de la lista curada no hace falta pedirla ni guardarla; agregar dos veces la misma no duplica", async () => {
    const s = setup();
    const f = status(200);
    expect(await addGoogleFontRequest(s.db, who, "montserrat", f)).toEqual({ ok: true, data: { family: "Montserrat" } });
    expect(f).not.toHaveBeenCalled();
    await addGoogleFontRequest(s.db, who, "lobster", status(200));
    await addGoogleFontRequest(s.db, who, "Lobster", status(200));
    expect(settingsOf(s).fonts?.google).toEqual(["Lobster"]);
  });

  it("rechaza un nombre con caracteres raros sin salir a la red", async () => {
    const s = setup();
    const f = status(200);
    expect((await addGoogleFontRequest(s.db, who, "x&y=<script>", f)).ok).toBe(false);
    expect((await addGoogleFontRequest(s.db, who, "   ", f)).ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("settings: subir y quitar fuentes (F11)", () => {
  const woff2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 1, 0, 0, 0, 0]);
  const ttf = new Uint8Array([0, 1, 0, 0, 0, 5, 0, 0]);

  it("valida por los bytes, la sube a design-assets/<negocio>/fonts/ y la registra con su familia y peso", async () => {
    const s = setup();
    const r = await uploadFontRequest(s.db, { ...who, bytes: woff2, fileName: "Mi-Marca-Sans.woff2", weight: 700 });
    expect(r).toEqual({ ok: true, data: { family: "Mi Marca Sans", weight: 700 } });
    expect(s.uploads).toHaveLength(1);
    expect(s.uploads[0].path).toMatch(new RegExp(`^${WS}/fonts/[0-9a-f-]{36}\\.woff2$`));
    expect(s.uploads[0].contentType).toBe("font/woff2");
    expect(settingsOf(s).fonts?.uploaded?.[0]).toMatchObject({ family: "Mi Marca Sans", weight: 700, format: "woff2", path: s.uploads[0].path });
  });

  it("una fuente subida que no es una fuente por sus bytes se rechaza (aunque la extensión diga .woff2)", async () => {
    const s = setup();
    const r = await uploadFontRequest(s.db, { ...who, bytes: new TextEncoder().encode("<?php echo 1; ?>"), fileName: "falsa.woff2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no es una fuente/);
    expect(s.uploads).toHaveLength(0);
  });

  it("rechaza más de 2 MB, un nombre inválido y un peso inválido", async () => {
    const s = setup();
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(woff2);
    expect((await uploadFontRequest(s.db, { ...who, bytes: big, fileName: "g.woff2" })).ok).toBe(false);
    expect((await uploadFontRequest(s.db, { ...who, bytes: woff2, fileName: "x.woff2", family: "mal/nombre" })).ok).toBe(false);
    expect((await uploadFontRequest(s.db, { ...who, bytes: woff2, fileName: "x.woff2", weight: 450 })).ok).toBe(false);
    expect(s.uploads).toHaveLength(0);
  });

  it("subir el mismo peso de una familia reemplaza el archivo anterior (que se borra del bucket)", async () => {
    const s = setup();
    await uploadFontRequest(s.db, { ...who, bytes: woff2, fileName: "Mi Fuente.woff2", weight: 400 });
    const first = s.uploads[0].path;
    await uploadFontRequest(s.db, { ...who, bytes: ttf, fileName: "Mi Fuente.ttf", weight: 400 });
    expect(settingsOf(s).fonts?.uploaded).toHaveLength(1);
    expect(settingsOf(s).fonts?.uploaded?.[0].format).toBe("ttf");
    expect(s.removed).toContain(first);
  });

  it("si no queda registrada (los ajustes no se pueden guardar), borra el archivo que subió", async () => {
    const s = setup({}, { beforeUpdate: (_t, rows) => { (rows[0] as { updated_at: string }).updated_at = `${Math.random()}`; } });
    const r = await uploadFontRequest(s.db, { ...who, bytes: woff2, fileName: "Otra.woff2" });
    expect(r.ok).toBe(false);
    expect(s.removed).toEqual([s.uploads[0].path]);
  });

  it("si el Storage falla, no registra nada", async () => {
    const s = setup({}, { uploadError: "bucket caído" });
    const r = await uploadFontRequest(s.db, { ...who, bytes: woff2, fileName: "Otra.woff2" });
    expect(r).toEqual({ ok: false, error: "No se pudo subir la fuente. Probá de nuevo." });
    expect(settingsOf(s).fonts).toBeUndefined();
  });

  it("quitar una de Google la saca de la lista; quitar una subida borra también su archivo", async () => {
    const s = setup();
    await addGoogleFontRequest(s.db, who, "Lobster", vi.fn(async () => ({ status: 200 }) as Response) as unknown as typeof fetch);
    await uploadFontRequest(s.db, { ...who, bytes: woff2, fileName: "Mi Fuente.woff2" });
    const path = s.uploads[0].path;
    expect(await removeFontRequest(s.db, who, { family: "Lobster" })).toEqual({ ok: true, data: undefined });
    expect(settingsOf(s).fonts?.google).toEqual([]);
    expect(await removeFontRequest(s.db, who, { family: "Mi Fuente", path })).toEqual({ ok: true, data: undefined });
    expect(settingsOf(s).fonts?.uploaded).toEqual([]);
    expect(s.removed).toEqual([path]);
    expect((await removeFontRequest(s.db, who, { family: "Nunca estuvo" })).ok).toBe(false);
  });

  it("nunca borra un archivo que no sea de las fuentes del negocio", async () => {
    const other = "99999999-2222-3333-4444-555555555555/fonts/aaaaaaaa-0000-0000-0000-000000000001.woff2";
    const s = setup({ fonts: { uploaded: [{ family: "Ajena", weight: 400, style: "normal", path: other, format: "woff2" }] } });
    // Ya la lectura rechaza una fuente que no es del negocio: los ajustes quedan como vacíos y no hay nada que borrar.
    const r = await removeFontRequest(s.db, who, { family: "Ajena", path: other });
    expect(r.ok).toBe(false);
    expect(s.removed).toEqual([]);
  });

  it("el nombre de la familia sale del archivo cuando no se escribe", () => {
    expect(familyFromFileName("Mi-Marca_Sans-Bold.woff2")).toBe("Mi Marca Sans Bold");
    expect(familyFromFileName("C:\\fuentes\\Roboto.ttf")).toBe("Roboto");
    expect(familyFromFileName("....")).toBe("");
  });
});
