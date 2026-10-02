import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { metricsSourceLine, METRICS_SOURCE_LINES } from "./metrics-source";

describe("metricsSourceLine", () => {
  it("dice la verdad por red, incluido LinkedIn", () => {
    expect(metricsSourceLine("instagram")).toContain("Zernio");
    expect(metricsSourceLine("tiktok")).toContain("Zernio");
    expect(metricsSourceLine("threads")).toContain("propia API");
    expect(metricsSourceLine("youtube")).toContain("Google");
    expect(metricsSourceLine("linkedin")).toContain("no permite leer metricas");
  });

  it("una plataforma desconocida no inventa una linea", () => {
    expect(metricsSourceLine("no-existe")).toBeNull();
  });
});

describe("ESTRUCTURAL: cada case de readAccount() tiene su linea aca", () => {
  it("lib/jobs/handlers/metrics-sync.ts no gana una plataforma sin que esto se entere", () => {
    const root = resolve(__dirname, "../..");
    const source = readFileSync(join(root, "lib/jobs/handlers/metrics-sync.ts"), "utf8");

    // El switch de readAccount() arranca en "switch (account.platform) {" y
    // termina en su "}" de cierre, antes de la siguiente funcion.
    const start = source.indexOf("switch (account.platform)");
    expect(start, "no encontre el switch de readAccount()").toBeGreaterThan(-1);
    const switchBody = source.slice(start, source.indexOf("\n}", start));

    const cases = [...switchBody.matchAll(/case\s+"([a-z_]+)"\s*:/g)].map((m) => m[1]);
    expect(cases.length).toBeGreaterThan(0);

    const sinLinea = cases.filter((platform) => !(platform in METRICS_SOURCE_LINES));
    expect(sinLinea, "sumar una plataforma al switch pide sumar su linea en METRICS_SOURCE_LINES").toEqual([]);
  });
});
