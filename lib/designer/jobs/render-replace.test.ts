import { describe, expect, it, vi } from "vitest";
import { emptyDoc } from "../doc/schema";
import { exportFolder } from "../storage";
import { MemoryDb } from "../testing/memory-db";
import type { RenderRequest } from "../render-client";
import { runDesignRender, type RenderSet } from "./render";
import { previousRendersToDelete, releasePreviousRenders } from "./render-replace";

const WS = "11111111-2222-4333-8444-555555555555";
const DESIGN = "aaaaaaaa-2222-4333-8444-555555555555";
const OTHER_DESIGN = "bbbbbbbb-2222-4333-8444-555555555555";
const OTHER_WS = "99999999-2222-4333-8444-555555555555";
const folder = (version: string, design = DESIGN, ws = WS) => `${ws}/${design}/${version}`;
const set = (version: string, pages = 2, design = DESIGN): RenderSet => ({
  version,
  pdf_path: `${folder(version, design)}/document.pdf`,
  pages: Array.from({ length: pages }, (_, i) => `${folder(version, design)}/page-${String(i + 1).padStart(2, "0")}.png`),
  rendered_at: "2026-11-07T12:00:00Z",
});

describe("qué se borra del juego anterior (F48b)", () => {
  it("todo lo del juego anterior que el nuevo no usa", () => {
    const old = set("1-1", 3);
    expect(previousRendersToDelete(old, set("2-2", 3)).sort()).toEqual([...old.pages, old.pdf_path as string].sort());
  });

  it("si una ruta se repite en el juego nuevo, se queda", () => {
    const next = set("2-2", 2);
    const previous = { ...set("1-1", 2), pages: [set("1-1", 2).pages[0], next.pages[0]] };
    expect(previousRendersToDelete(previous, next)).toEqual([set("1-1", 2).pages[0], previous.pdf_path]);
  });

  it("nunca el juego nuevo, aunque sea el mismo que el anterior", () => {
    expect(previousRendersToDelete(set("2-2"), set("2-2"))).toEqual([]);
  });

  it("nunca archivos de otro diseño ni de otro negocio", () => {
    const previous = { pages: [set("1-1", 1, OTHER_DESIGN).pages[0], `${folder("1-1", DESIGN, OTHER_WS)}/page-01.png`], pdf_path: set("1-1", 1, OTHER_DESIGN).pdf_path };
    expect(previousRendersToDelete(previous, set("2-2"))).toEqual([]);
  });

  it("nunca las exportaciones sueltas (las limpia la limpieza diaria a los 7 días)", () => {
    const previous = { pages: [`${exportFolder(WS, DESIGN, "17000-abcd")}/page-01.png`], pdf_path: `${exportFolder(WS, DESIGN, "17000-abcd")}/document.pdf` };
    expect(previousRendersToDelete(previous, set("2-2"))).toEqual([]);
  });

  it("una ruta que intenta salirse de la carpeta no se toca", () => {
    const previous = { pages: [`${WS}/${DESIGN}/../${OTHER_DESIGN}/1/page-01.png`], pdf_path: null };
    expect(previousRendersToDelete(previous, set("2-2"))).toEqual([]);
  });

  it("lo que no se puede leer no borra nada", () => {
    for (const previous of [null, undefined, {}, [], "x", 7, { pages: "x", pdf_path: 3 }, { pages: [1, null, {}] }]) expect(previousRendersToDelete(previous, set("2-2"))).toEqual([]);
  });

  it("sin juego nuevo (sin archivos) no se borra nada", () => {
    expect(previousRendersToDelete(set("1-1"), { pdf_path: null, pages: [] })).toEqual([]);
  });

  it("no repite rutas", () => {
    const old = set("1-1", 1);
    expect(previousRendersToDelete({ pages: [...old.pages, ...old.pages], pdf_path: old.pdf_path }, set("2-2", 1))).toEqual([old.pages[0], old.pdf_path]);
  });
});

describe("releasePreviousRenders", () => {
  it("borra del bucket design-renders lo que sobra, en una sola llamada", async () => {
    const db = new MemoryDb();
    const old = set("1-1", 2);
    for (const p of [...old.pages, old.pdf_path as string]) db.put("design-renders", p);
    const fresh = set("2-2", 2);
    for (const p of [...fresh.pages, fresh.pdf_path as string]) db.put("design-renders", p);
    await releasePreviousRenders(db.client, old, fresh);
    expect(db.paths("design-renders")).toEqual([...fresh.pages, fresh.pdf_path as string].sort());
  });

  it("sin nada que borrar no le pregunta nada al almacenamiento", async () => {
    const db = new MemoryDb();
    const remove = vi.fn();
    (db.storage as unknown as { from: () => { remove: typeof remove } }).from = () => ({ remove });
    await releasePreviousRenders(db.client, {}, set("2-2"));
    expect(remove).not.toHaveBeenCalled();
  });

  it("NUNCA lanza: un error del almacenamiento queda en el log", async () => {
    const db = new MemoryDb();
    db.failures.set("storage.remove", "caído");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(releasePreviousRenders(db.client, set("1-1"), set("2-2"))).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("no pude borrar"), "caído");
    const boom = { storage: { from: () => ({ remove: async () => Promise.reject(new Error("boom")) }) } } as never;
    await expect(releasePreviousRenders(boom, set("1-1"), set("2-2"))).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

describe("al volver a renderizar, quedan solo los archivos nuevos de ese diseño", () => {
  const NOW = (n: number) => () => new Date(1_762_516_800_000 + n);
  const render = vi.fn(async (req: RenderRequest) => ({
    version: "t",
    files: req.format === "pdf" ? [{ page: 0, contentType: "application/pdf" as const, bytes: new Uint8Array([37]) }] : (req.pages ?? [{ html: req.html! }]).map((_p, page) => ({ page, contentType: "image/png" as const, bytes: new Uint8Array([1]) })),
  }));
  const seed = (template_id: string | null) =>
    new MemoryDb({
      designs: [
        { id: DESIGN, workspace_id: WS, doc: { ...emptyDoc("v45"), pages: [emptyDoc("v45").pages[0], { ...emptyDoc("v45").pages[0], id: "pg_second01" }] }, format: "v45", code: "K8F2-WQ4M-7TQA", rev: 1, values: {}, template_id, renders: {}, attempts: 0, status: "ready" },
        { id: OTHER_DESIGN, workspace_id: WS, doc: emptyDoc("v45"), format: "v45", code: "ZZZZ-ZZZZ-ZZZZ", rev: 1, values: {}, template_id: null, renders: {}, attempts: 0 },
      ],
      workspaces: [{ id: WS, design_settings: {} }],
    });

  it("un diseño propio: el segundo render borra el primero (PNG y PDF) y deja una exportación suelta y otro diseño intactos", async () => {
    const db = seed(null);
    const first = await runDesignRender(db.client, { designId: DESIGN, purpose: "publish" }, { render, now: NOW(0), schedule: vi.fn() });
    const other = await runDesignRender(db.client, { designId: OTHER_DESIGN, purpose: "publish" }, { render, now: NOW(0), schedule: vi.fn() });
    await runDesignRender(db.client, { designId: DESIGN, purpose: "export", exportKind: "pdf", stamp: "1762516800000-abcd12" }, { render, now: NOW(0), schedule: vi.fn() });
    expect(first.status).toBe("rendered");
    expect(other.status).toBe("rendered");
    expect(db.paths("design-renders").filter((p) => p.startsWith(`${WS}/${DESIGN}/`))).toHaveLength(4); // 2 páginas + el PDF + la exportación suelta

    const second = await runDesignRender(db.client, { designId: DESIGN, purpose: "publish" }, { render, now: NOW(5000), schedule: vi.fn() });
    expect(second.status).toBe("rendered");
    const set2 = (second as { set: RenderSet }).set;
    const mine = db.paths("design-renders").filter((p) => p.startsWith(`${WS}/${DESIGN}/`) && !p.includes("/exports/"));
    expect(mine).toEqual([...set2.pages, set2.pdf_path as string].sort());
    expect(mine).toHaveLength(3);
    // El archivo viejo ya no está, y lo que sí quedó es exactamente lo que dice `renders`.
    expect(db.paths("design-renders")).not.toContain((first as { set: RenderSet }).set.pdf_path);
    expect(db.rows("designs")[0].renders).toMatchObject({ pdf_path: set2.pdf_path, pages: set2.pages });
    // La exportación suelta y el otro diseño no se tocaron.
    expect(db.paths("design-renders")).toContain(`${exportFolder(WS, DESIGN, "1762516800000-abcd12")}/document.pdf`);
    expect(db.paths("design-renders").filter((p) => p.startsWith(`${WS}/${OTHER_DESIGN}/`))).toHaveLength(2); // su página y su PDF
  });

  it("una generación NUNCA borra nada: conserva todos sus juegos", async () => {
    const db = seed("t1");
    await runDesignRender(db.client, { designId: DESIGN, purpose: "generation" }, { render, now: NOW(0), schedule: vi.fn() });
    const before = db.paths("design-renders").filter((p) => p.startsWith(`${WS}/${DESIGN}/`));
    await runDesignRender(db.client, { designId: DESIGN, purpose: "generation" }, { render, now: NOW(5000), schedule: vi.fn() });
    const after = db.paths("design-renders").filter((p) => p.startsWith(`${WS}/${DESIGN}/`));
    expect(before).toHaveLength(3);
    expect(after).toHaveLength(6);
    expect(before.every((p) => after.includes(p))).toBe(true);
  });

  it("si el segundo render falla, el juego anterior sigue entero (no se borra nada antes de tener el nuevo)", async () => {
    const db = seed(null);
    await runDesignRender(db.client, { designId: DESIGN, purpose: "publish" }, { render, now: NOW(0), schedule: vi.fn() });
    const before = db.paths("design-renders");
    const failing = vi.fn(async () => Promise.reject(new Error("servicio caído")));
    await runDesignRender(db.client, { designId: DESIGN, purpose: "publish" }, { render: failing as never, now: NOW(5000), schedule: vi.fn() });
    expect(db.paths("design-renders")).toEqual(before);
  });
});
