import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("los tooltips de los gráficos de anuncios", () => {
  it("todos llevan el color de texto legible: sin eso, recharts pinta de negro sobre el fondo oscuro", () => {
    const source = readFileSync(join(__dirname, "ads-charts.tsx"), "utf8");
    const tooltips = source.match(/<Tooltip\b[^>]*?\n?[\s\S]*?\/>/g) ?? [];
    expect(tooltips.length).toBeGreaterThan(0);
    expect(tooltips.filter((tooltip) => !tooltip.includes("{...TOOLTIP_TEXT}"))).toEqual([]);
  });
});
