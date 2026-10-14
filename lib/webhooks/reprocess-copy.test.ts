import { describe, expect, it } from "vitest";
import { RERUN_LABEL, RERUN_WARNING, reprocessDone, reprocessIntro } from "./reprocess-copy";

describe("los textos del reproceso", () => {
  it("la casilla se llama como lo pidió el plano y la advertencia habla de mensajes repetidos", () => {
    expect(RERUN_LABEL).toBe("Volver a correr también los flujos que ya corrieron");
    expect(RERUN_WARNING.toLowerCase()).toContain("mensajes repetidos");
  });

  it("la introducción dice que lo que ya corrió NO se repite, en singular y en plural", () => {
    expect(reprocessIntro({ count: 1 })).toContain("este envío");
    expect(reprocessIntro({ count: 3 })).toContain("estos 3 envíos");
    expect(reprocessIntro({ count: 1 })).toContain("no se repiten");
  });

  it("avisa cuando el envío ya se procesó bien, solo en el caso de uno", () => {
    expect(reprocessIntro({ count: 1, alreadyProcessed: true })).toContain("ya se procesó bien");
    expect(reprocessIntro({ count: 2, alreadyProcessed: true })).not.toContain("ya se procesó bien");
  });

  it("el cierre cuenta si se volvió a correr todo y cuántos quedaron afuera", () => {
    expect(reprocessDone({ reprocessed: 1, skipped: 0, rerunCompleted: false })).toBe("Reprocesado.");
    expect(reprocessDone({ reprocessed: 4, skipped: 1, rerunCompleted: true })).toBe("Reprocesados 4. Se volvieron a correr también los flujos que ya habían corrido. 1 no se pudo reprocesar.");
    expect(reprocessDone({ reprocessed: 2, skipped: 3, rerunCompleted: false })).toBe("Reprocesados 2. 3 no se pudieron reprocesar.");
    expect(reprocessDone({ reprocessed: 0, skipped: 1, rerunCompleted: false })).toContain("Otro reproceso se adelantó");
  });
});
