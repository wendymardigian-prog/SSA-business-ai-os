import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/actions/designer/settings", () => ({ addGoogleFont: vi.fn(), archiveStyle: vi.fn(), extractStyle: vi.fn(), removeFont: vi.fn(), saveStyle: vi.fn(), uploadFont: vi.fn() }));

import { SettingsScreen } from "./settings-screen";

const base = { styles: [], google: [], uploaded: [], designs: [], googleHref: null, previewFaces: [], curatedCount: 60 };

describe("components/designer/settings: la pantalla de ajustes se dibuja (humo)", () => {
  it("vacía: dos secciones con sus acciones y el estado vacío de cada una", () => {
    const html = renderToString(createElement(SettingsScreen, base));
    expect(html).toContain("Estilos propios");
    expect(html).toContain("+ Crear desde mis piezas");
    expect(html).toContain("Todavía no tenés estilos propios");
    expect(html).toContain("Fuentes");
    expect(html).toContain("+ Agregar de Google");
    expect(html).toContain("+ Subir");
    expect(html).toContain("Todavía no sumaste fuentes");
    expect(html).toContain("Además de las 60 de la lista");
  });

  it("con datos: tarjetas con paleta y fuentes, y las fuentes con su vista «Aa Bb Cc» y el detalle", () => {
    const html = renderToString(
      createElement(SettingsScreen, {
        ...base,
        styles: [
          { key: "c_abc123", name: "Mi estilo", palette: { bg: "#101820", text: "#fef9ef", accent: "#f2aa4c" }, fonts: { title: "Archivo Black", body: "Inter" }, density: { sq: 22, v45: 22, story: 16 }, rules: "Fondo oscuro." },
          { key: "c_old123", name: "Estilo viejo", palette: { bg: "#ffffff", text: "#111111", accent: "#ff0000" }, fonts: { title: "Inter", body: "Inter" }, density: {}, rules: "", archived: true },
        ],
        google: ["Lobster"],
        uploaded: [{ family: "Mi Marca Sans", weight: 700, style: "normal" as const, path: "ws/fonts/a.woff2", format: "woff2" as const }],
      }),
    );
    expect(html).toContain("Mi estilo");
    expect(html).toContain("Archivo Black + Inter");
    expect(html).toContain("Posts hasta 22 · Historias hasta 16");
    expect(html).toContain("Ver archivados (1)");
    expect(html).not.toContain("Estilo viejo");
    expect(html).toContain("Aa Bb Cc");
    expect(html).toContain("De Google Fonts");
    expect(html).toContain("Bold 700 · .woff2");
  });
});
