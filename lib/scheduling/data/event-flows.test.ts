import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `flows` no tiene `deleted_at`. Una consulta que lo filtre
 * falla en la base y la pantalla queda vacía sin avisar: así estuvo la sección Flujos
 * de la Agenda hasta que se sacó el filtro. El test mira el código y no la base para
 * que falle aunque nadie corra los `verify-*`.
 */
describe("flowsForEventType", () => {
  it("no filtra por deleted_at, una columna que flows no tiene", () => {
    const source = readFileSync(join(__dirname, "event-flows.ts"), "utf8");
    const code = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");
    expect(code).not.toMatch(/deleted_at/);
  });
});
