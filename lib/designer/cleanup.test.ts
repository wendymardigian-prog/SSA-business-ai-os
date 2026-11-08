import { describe, expect, it } from "vitest";
import { cleanupPlan, isExportPath, type CleanupFile, type CleanupVersion } from "./cleanup";

const NOW = new Date("2026-11-07T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const v = (id: string, pieceId: string, days: number, reason: CleanupVersion["reason"] = "manual"): CleanupVersion => ({ id, pieceId, createdAt: daysAgo(days), reason });
const f = (path: string, days: number, extra: Partial<CleanupFile> = {}): CleanupFile => ({ path, createdAt: daysAgo(days), isExport: true, isGeneration: false, ...extra });

describe("limpieza diaria (F48b)", () => {
  it("una versión de 29 días queda y una de 31 se va", () => {
    const plan = cleanupPlan({ versions: [v("actual", "p", 1), v("v29", "p", 29), v("v31", "p", 31)], files: [] }, NOW);
    expect(plan.versionIds).toEqual(["v31"]);
  });

  it("la versión actual nunca se borra, aunque sea vieja", () => {
    const plan = cleanupPlan({ versions: [v("unica", "p", 400)], files: [] }, NOW);
    expect(plan.versionIds).toEqual([]);
  });

  it("la última publicada nunca se borra; una publicada anterior sí", () => {
    const plan = cleanupPlan({ versions: [v("actual", "p", 2), v("pub-nueva", "p", 60, "publish"), v("pub-vieja", "p", 90, "publish"), v("vieja", "p", 70)], files: [] }, NOW);
    expect(plan.versionIds.sort()).toEqual(["pub-vieja", "vieja"]);
  });

  it("cada pieza tiene su actual", () => {
    const plan = cleanupPlan({ versions: [v("a", "p1", 50), v("b", "p2", 50)], files: [] }, NOW);
    expect(plan.versionIds).toEqual([]);
  });

  it("una exportación de 6 días queda y una de 8 se va", () => {
    const plan = cleanupPlan({ versions: [], files: [f("e6", 6), f("e8", 8)] }, NOW);
    expect(plan.paths).toEqual(["e8"]);
  });

  it("los archivos de una generación nunca se borran", () => {
    const plan = cleanupPlan({ versions: [], files: [f("gen", 400, { isGeneration: true }), f("vigente", 400, { isExport: false })] }, NOW);
    expect(plan.paths).toEqual([]);
  });

  it("reconoce la carpeta de exportaciones", () => {
    const ws = "11111111-2222-3333-4444-555555555555";
    const d = "aaaaaaaa-2222-3333-4444-555555555555";
    expect(isExportPath(`${ws}/${d}/exports/20261107/page-01.png`)).toBe(true);
    expect(isExportPath(`${ws}/${d}/3/page-01.png`)).toBe(false);
  });
});
