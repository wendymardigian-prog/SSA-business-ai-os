// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { dailyActivityView, historyLabel, miniBarsView } from "./daily";

const day = (d: string, groups: Record<string, number> = {}, active = false, negative = 0) => ({ day: d, groups, active, negative });

describe("dailyActivityView", () => {
  it("apila por grupo en el orden fijo y escala al día más alto", () => {
    const v = dailyActivityView([day("2026-11-14", { com: 2, cont: 3 }, true), day("2026-11-15", { camino: 10 })]);
    expect(v.bars[0].segments.map((s) => s.group)).toEqual(["cont", "com"]);
    expect(v.max).toBe(10);
    expect(v.bars[1].segments[0].share).toBe(1);
    expect(v.bars[0].segments[0].share).toBeCloseTo(0.3);
  });
  it("los negativos no dibujan barra pero restan del período", () => {
    const v = dailyActivityView([day("2026-11-15", { camino: 10 }, false, -2)]);
    expect(v.bars[0].positive).toBe(10);
    expect(v.bars[0].negative).toBe(-2);
    expect(v.periodPoints).toBe(8);
    expect(v.negativeTotal).toBe(-2);
    expect(v.bars[0].text).toContain("ajustes -2");
  });
  it("un día sin entrar puede tener puntos", () => {
    const v = dailyActivityView([day("2026-11-15", { com: 1 }, false)]);
    expect(v.bars[0].active).toBe(false);
    expect(v.bars[0].text).toContain("no entró");
    expect(v.bars[0].positive).toBe(1);
  });
  it("días que entró, por día y leyenda solo con lo que hubo", () => {
    const rows = Array.from({ length: 14 }, (_, i) => day(`2026-11-${String(i + 2).padStart(2, "0")}`, i === 3 ? { act: 5 } : {}, i % 2 === 0));
    const v = dailyActivityView(rows);
    expect(v.totalDays).toBe(14);
    expect(v.activeDays).toBe(7);
    expect(v.periodPoints).toBe(5);
    expect(v.perDay).toBe(0.4);
    expect(v.legend).toEqual([{ group: "act", label: "Actividades", points: 5 }]);
  });
  it("sin puntos: todo en cero, sin dividir por cero", () => {
    const v = dailyActivityView([day("2026-11-15")]);
    expect(v.max).toBe(0);
    expect(v.bars[0].segments).toEqual([]);
    expect(v.bars[0].text).toContain("sin puntos");
    expect(dailyActivityView([]).perDay).toBe(0);
  });
});

describe("miniBarsView y el historial", () => {
  it("escala las 30 barras", () => {
    expect(miniBarsView([0, 5, 10])).toEqual({ heights: [0, 0.5, 1], total: 15 });
    expect(miniBarsView([0, 0])).toEqual({ heights: [0, 0], total: 0 });
  });
  it("un descuento se nombra como descuento; un ajuste del equipo no", () => {
    expect(historyLabel("post", -2)).toBe("Descuento · Publicó en la comunidad");
    expect(historyLabel("manual", -5)).toBe("Ajuste del equipo");
    expect(historyLabel("step", 10)).toBe("Paso completado");
    expect(historyLabel("raro", 1)).toBe("Puntos");
  });
});
