import { describe, expect, it } from "vitest";
import { CATEGORY_COLORS, DEFAULT_EXPENSE_CATEGORIES, type ExpenseCategory } from "./categories";
import {
  CATEGORY_COLOR_NAMES, canArchiveCategory, categoryDraftError, categorySections, categoryUsage, draftFromCategory, itemsWithArchived, itemsWithDraft, toSaveItems, EMPTY_CATEGORY_DRAFT,
} from "./category-totals";

const TODAY = "2026-10-15";
const row = (category_key: string, amount: unknown, status: string, paid_date: string | null = null) => ({ category_key, amount, status, paid_date });
const custom = (patch: Partial<ExpenseCategory>): ExpenseCategory => ({ key: "viajes", name: "Viajes", color: "#2563eb", group: "otro", system: false, archived_at: null, ...patch });

describe("categoryUsage", () => {
  it("cuenta los gastos (sin anulados) y suma lo pagado en el año, en céntimos", () => {
    const u = categoryUsage(
      [
        row("software", 0.1, "pagado", "2026-02-01"),
        row("software", 0.2, "pagado", "2026-03-01"),
        row("software", 99, "pagado", "2025-12-31"),
        row("software", 50, "programado"),
        row("software", 70, "anulado"),
        row("taxes", 10, "vencido"),
      ],
      TODAY,
    );
    expect(u.software).toEqual({ count: 4, paidYearCents: 30 });
    expect(u.taxes).toEqual({ count: 1, paidYearCents: 0 });
    expect(u.nada).toBeUndefined();
  });
});

describe("categorySections", () => {
  it("agrupa en el orden de los grupos, con la explicación de cada uno", () => {
    const sections = categorySections(DEFAULT_EXPENSE_CATEGORIES);
    expect(sections.map((s) => s.label)).toEqual(["Adquisición", "Entrega", "Operación", "Otro"]);
    expect(sections[0].hint).toContain("costo de adquisición");
    expect(sections[0].items.map((c) => c.key)).toContain("ads_meta");
  });
  it("las archivadas van al final de su grupo y un grupo vacío no se dibuja", () => {
    const sections = categorySections([custom({ key: "a", name: "A", archived_at: "2026-01-01" }), custom({ key: "b", name: "B" })]);
    expect(sections).toHaveLength(1);
    expect(sections[0].items.map((c) => c.key)).toEqual(["b", "a"]);
  });
});

describe("lo que se manda al guardar", () => {
  const cats = [custom({ key: "viajes" }), custom({ key: "other", name: "Otros", system: true, archived_at: null, color: "#78716C" })];

  it("conserva la lista entera, con el archivado y el color en minúsculas", () => {
    expect(toSaveItems([custom({ archived_at: "2026-01-01" }), cats[1]])).toEqual([
      { key: "viajes", name: "Viajes", color: "#2563eb", group: "otro", archived: true },
      { key: "other", name: "Otros", color: "#78716c", group: "otro", archived: false },
    ]);
  });
  it("un color fuera de la paleta cae al primero (si no, el servidor rechazaría todo el guardado)", () => {
    expect(toSaveItems([custom({ color: "#123456" })])[0].color).toBe("#2563eb");
  });
  it("crear suma una al final sin clave", () => {
    const items = itemsWithDraft(cats, { key: null, name: "  Eventos ", color: "#7c3aed", group: "adquisicion" });
    expect(items).toHaveLength(3);
    expect(items[2]).toEqual({ key: undefined, name: "Eventos", color: "#7c3aed", group: "adquisicion", archived: false });
  });
  it("editar cambia solo esa y no la desarchiva", () => {
    const items = itemsWithDraft([custom({ archived_at: "2026-01-01" })], { ...draftFromCategory(custom({})), name: "Viajes y hoteles", group: "entrega" });
    expect(items).toEqual([{ key: "viajes", name: "Viajes y hoteles", color: "#2563eb", group: "entrega", archived: true }]);
  });
  it("archivar y restaurar tocan una sola", () => {
    expect(itemsWithArchived(cats, "viajes", true).map((i) => i.archived)).toEqual([true, false]);
    expect(itemsWithArchived([custom({ archived_at: "x" })], "viajes", false)[0].archived).toBe(false);
  });
});

describe("validación del formulario", () => {
  const cats = [custom({ key: "viajes", name: "Viajes" }), custom({ key: "vieja", name: "Eventos", archived_at: "2026-01-01" })];

  it("pide el nombre y que no se repita entre las activas sin importar mayúsculas", () => {
    expect(categoryDraftError({ ...EMPTY_CATEGORY_DRAFT, name: "" }, cats)).toBe("Poné un nombre");
    expect(categoryDraftError({ ...EMPTY_CATEGORY_DRAFT, name: "VIAJES" }, cats)).toContain("Ya hay una categoría activa");
    expect(categoryDraftError({ ...EMPTY_CATEGORY_DRAFT, name: "Eventos" }, cats)).toBeNull();
    expect(categoryDraftError({ ...draftFromCategory(cats[0]) }, cats)).toBeNull();
    expect(categoryDraftError({ ...EMPTY_CATEGORY_DRAFT, name: "x".repeat(81) }, cats)).toContain("80");
  });
  it("una categoría del sistema no se archiva; una archivada tampoco se vuelve a archivar", () => {
    expect(canArchiveCategory({ system: true, archived_at: null })).toBe(false);
    expect(canArchiveCategory({ system: false, archived_at: null })).toBe(true);
    expect(canArchiveCategory({ system: false, archived_at: "x" })).toBe(false);
  });
});

describe("la paleta", () => {
  it("cada color tiene su nombre y los nombres no se repiten", () => {
    const names = CATEGORY_COLORS.map((c) => CATEGORY_COLOR_NAMES[c]);
    expect(names.every(Boolean)).toBe(true);
    expect(new Set(names).size).toBe(CATEGORY_COLORS.length);
  });
});
