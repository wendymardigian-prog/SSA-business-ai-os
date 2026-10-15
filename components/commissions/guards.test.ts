import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Las reglas de código de la pantalla de Comisiones (lista, ficha, liquidación y ajustes): nada se esconde en un
 * `<details>`, no se inyecta HTML, no se suma una librería de gráficos, y ningún componente lee `localStorage` sin
 * `try/catch`. Solo mira los archivos de esta carpeta (el editor de reglas, en `rules/`, tiene sus propias pruebas).
 */
const files = readdirSync(__dirname).filter((f) => /\.tsx$/.test(f));

describe("components/commissions", () => {
  it("hay componentes para revisar", () => {
    expect(files.length).toBeGreaterThan(4);
  });

  for (const file of files) {
    const text = readFileSync(join(__dirname, file), "utf8");
    it(`${file} no usa <details>, dangerouslySetInnerHTML ni recharts`, () => {
      expect(text).not.toMatch(/<details[\s>]/);
      expect(text).not.toMatch(/dangerouslySetInnerHTML/);
      expect(text).not.toMatch(/from\s+["']recharts["']/);
    });
    it(`${file} no toca localStorage`, () => {
      expect(text).not.toMatch(/localStorage/);
    });
  }

  it("ningún componente importa el cliente de servicio ni el Vault", () => {
    for (const file of files) {
      const text = readFileSync(join(__dirname, file), "utf8");
      expect(text, file).not.toMatch(/from\s+["']@\/lib\/supabase\/server["']/);
      expect(text, file).not.toMatch(/from\s+["']@\/lib\/vault["']/);
    }
  });
});
