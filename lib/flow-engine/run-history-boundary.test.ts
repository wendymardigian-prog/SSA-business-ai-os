/**
 * La frontera del historial de ejecuciones (00292): un paso que falla sin lanzar solo se ve si avisa. Un nodo nuevo que
 * anote un fallo o un salto en `analytics_events` y no le cuente al historial quedaria como «salió bien».
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const NODES = path.join(process.cwd(), "lib/flow-engine/nodes");
const EMITS = /event_type:\s*"(node_failed|node_skipped|message_failed)"/;

const files = readdirSync(NODES).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.includes("fixtures"));

describe("los pasos le cuentan al historial lo que pasa", () => {
  it("hay nodos para revisar", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)("%s", (file) => {
    const source = readFileSync(path.join(NODES, file), "utf8");
    if (!EMITS.test(source)) return;
    expect(source, `${file} anota un fallo o un salto en analytics_events: tiene que llamar también a context.noteStep`).toContain("noteStep");
  });

  it("recordSend avisa cuando un envío se rechaza", () => {
    const source = readFileSync(path.join(process.cwd(), "lib/flow-engine/send.ts"), "utf8");
    expect(source).toMatch(/if \(!outcome\.ok\) context\.noteStep\?\.\(\{ status: "failed"/);
  });

  it("el motor no pisa el estado de una sesion en la misma escritura que anota el motivo", () => {
    // Asi, una instalacion que despliegue sin la migracion sigue cerrando sus sesiones.
    const source = readFileSync(path.join(process.cwd(), "lib/flow-engine/run-log.ts"), "utf8");
    expect(source).not.toMatch(/update\(\{[^}]*\bstatus\b/);
  });
});
