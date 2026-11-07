import { describe, expect, it } from "vitest";
import { CLIENT_GIVE_UP_MS, PREPARING_NOTICE_MS, exportMenuView, exportProgress, pollDelayMs } from "./export-menu";

const view = (extra: Partial<Parameters<typeof exportMenuView>[0]> = {}) => exportMenuView({ format: "v45", isTemplate: false, pageCount: 4, currentPage: 1, ...extra });

describe("menú Exportar", () => {
  it("varias páginas: PDF, imágenes (ZIP) y solo esta página (PNG)", () => {
    const v = view();
    expect(v).toMatchObject({ label: "Exportar", header: "Exportar", disabledReason: null, note: null });
    expect(v.items).toEqual([
      { id: "pdf", kind: "pdf", label: "PDF · todas las páginas" },
      { id: "zip", kind: "zip", label: "Imágenes · una por página (ZIP)" },
      { id: "page-1", kind: "png", page: 1, label: "Solo la página 2 · PNG" },
    ]);
  });

  it("una sola página: PDF e imagen PNG, sin «solo esta página»", () => {
    expect(view({ pageCount: 1, currentPage: 0 }).items).toEqual([
      { id: "pdf", kind: "pdf", label: "PDF" },
      { id: "png", kind: "png", label: "Imagen PNG" },
    ]);
  });

  it("la página actual se acomoda al rango", () => {
    expect(view({ currentPage: 99 }).items.at(-1)).toMatchObject({ page: 3, label: "Solo la página 4 · PNG" });
    expect(view({ currentPage: -3 }).items.at(-1)).toMatchObject({ page: 0 });
    expect(view({ currentPage: Number.NaN }).items.at(-1)).toMatchObject({ page: 0 });
  });

  it("plantillas: «Exportar prueba» con datos de ejemplo, y avisa que no genera nada", () => {
    const v = view({ isTemplate: true, format: "a4_v" });
    expect(v).toMatchObject({ label: "Exportar prueba", header: "Exportar prueba (datos de ejemplo)", note: "No genera ningún diseño ni link." });
  });

  it("una página web: deshabilitado y con el motivo, sin opciones", () => {
    expect(view({ format: "web", pageCount: 1 })).toMatchObject({ disabledReason: "Una página web se comparte con su link", items: [] });
  });

  it("todos los demás formatos se exportan", () => {
    for (const format of ["carta_v", "carta_h", "a4_v", "a4_h", "sq", "v45", "story", "wide"] as const) expect(view({ format }).disabledReason).toBeNull();
  });
});

describe("«Preparando tu archivo…»", () => {
  it("el aviso aparece a los 3 segundos, no antes", () => {
    expect(exportProgress(PREPARING_NOTICE_MS - 1)).toEqual({ showNotice: false, giveUp: false });
    expect(exportProgress(PREPARING_NOTICE_MS)).toEqual({ showNotice: true, giveUp: false });
  });

  it("se deja de esperar a los 10 minutos", () => {
    expect(exportProgress(CLIENT_GIVE_UP_MS - 1).giveUp).toBe(false);
    expect(exportProgress(CLIENT_GIVE_UP_MS).giveUp).toBe(true);
  });

  it("al principio pregunta seguido y después espacia", () => {
    expect([0, 1, 2, 3, 4, 5, 50].map(pollDelayMs)).toEqual([1000, 1000, 1500, 2000, 2500, 4000, 4000]);
  });
});
