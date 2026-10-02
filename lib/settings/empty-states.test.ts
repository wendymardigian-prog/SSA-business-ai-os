import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsEmptyState } from "@/components/settings/settings-empty-state";
import { SETTINGS_EMPTY_STATES } from "./empty-states";

/**
 * S5: cada pestaña tiene que verse bien con la base recién creada
 * (CLAUDE.md: "el sistema debe funcionar con base de datos vacía"). Vitest
 * solo corre `.test.ts` en entorno node, sin jsdom: `renderToStaticMarkup`
 * (de `react-dom/server`, ya instalado) alcanza para verificar el texto sin
 * sumar testing-library ni cambiar el entorno de Vitest.
 */

describe("SettingsEmptyState (S5)", () => {
  it("siempre muestra el título compartido", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsEmptyState, { description: "una bajada cualquiera" }),
    );
    expect(html).toContain("Todavía no hay nada acá");
  });

  it("muestra la acción cuando se pasa una", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsEmptyState, {
        description: "una bajada cualquiera",
        action: createElement("button", null, "Nuevo rol"),
      }),
    );
    expect(html).toContain("Nuevo rol");
  });

  it("no rompe si no hay acción", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsEmptyState, { description: "una bajada cualquiera" }),
    );
    expect(html).not.toContain("undefined");
  });
});

describe("La bajada de cada pestaña se renderiza (S5)", () => {
  for (const [key, description] of Object.entries(SETTINGS_EMPTY_STATES)) {
    it(`${key} aparece en el DOM`, () => {
      const html = renderToStaticMarkup(createElement(SettingsEmptyState, { description }));
      expect(html).toContain(description);
    });
  }
});
