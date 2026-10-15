import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Finanzas dibuja con `components/dashboards/charts.tsx` (SVG a mano): no suma una librería de gráficos. */
describe("components/finance", () => {
  it("no importa recharts", () => {
    const dir = __dirname;
    const files = readdirSync(dir).filter((f) => /\.(tsx?|jsx?)$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(join(dir, file), "utf8");
      expect(text, file).not.toMatch(/from\s+["']recharts["']/);
    }
  });
});
