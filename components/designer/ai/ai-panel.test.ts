import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/designer/ai", () => ({
  answerProposal: vi.fn(),
  changeStyle: vi.fn(),
  loadConversation: vi.fn(),
  sendAiMessage: vi.fn(),
}));
vi.mock("@/lib/actions/designer/designs", () => ({ uploadDesignImageAction: vi.fn() }));

import { AiPanel } from "./ai-panel";

const props = {
  target: { kind: "design" as const, id: "d1" },
  format: "v45" as const,
  isTemplate: false,
  currentPage: 1,
  pageCount: 4,
  rev: 3,
  styleKey: "social",
  canEdit: true,
  onApplied: () => {},
};

describe("components/designer/ai: el panel de la IA se dibuja (humo)", () => {
  it("con permiso de edición muestra el estilo, el campo, «+ Imagen» y las sugerencias del carrusel", () => {
    const html = renderToString(createElement(AiPanel, props));
    expect(html).toContain("Conversación con la IA");
    expect(html).toContain("Elegir el estilo del diseño");
    expect(html).toContain("Es un punto de partida, no un límite");
    expect(html).toContain("Pedido para la IA");
    expect(html).toContain("Solo la página 2");
    expect(html).toContain("+ Imagen");
    expect(html).toContain("Hacé la portada más llamativa");
    expect(html).toContain("Cargando la conversación");
  });

  it("sin permiso de edición se oculta (no se deshabilita) el estilo, el campo y las sugerencias", () => {
    const html = renderToString(createElement(AiPanel, { ...props, canEdit: false }));
    expect(html).toContain("Conversación con la IA");
    expect(html).not.toContain("Elegir el estilo del diseño");
    expect(html).not.toContain("Pedido para la IA");
    expect(html).not.toContain("+ Imagen");
    expect(html).not.toContain("Hacé la portada más llamativa");
  });

  it("una plantilla impresa ofrece las sugerencias del certificado y con una sola página no hay alcance", () => {
    const html = renderToString(createElement(AiPanel, { ...props, format: "carta_h", isTemplate: true, pageCount: 1, currentPage: 0 }));
    expect(html).toContain("Más espacio para nombres largos");
    expect(html).not.toContain("Alcance del pedido");
  });
});
