/**
 * El botón «Usar en contenido» / «En contenido ▾» (DS8, F63): lo que se ve antes de abrir nada. El modal y el menú
 * dependen del navegador (se abren con un clic); su lógica está en `lib/designer/screens/use-in-content.test.ts`.
 */

import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
vi.mock("@/lib/actions/designer/content", () => ({
  loadContentLink: async () => ({ ok: true, data: null }),
  loadUseInContent: async () => ({ ok: false, error: "no" }),
  searchPieces: async () => ({ ok: true, data: [] }),
  syncToPiece: async () => ({ ok: true, data: { queued: true } }),
  unlinkFromPiece: async () => ({ ok: true, data: undefined }),
  useInContent: async () => ({ ok: false, error: "no" }),
}));

const { UseInContent } = await import("./use-in-content");

const render = (props: { linkedPostId: string | null; linkedNetwork?: string | null }) =>
  renderToStaticMarkup(createElement(UseInContent, { designId: "d1", format: "v45", linkedPostId: props.linkedPostId, linkedNetwork: props.linkedNetwork ?? null }));

describe("el botón de la barra del editor (F63)", () => {
  it("sin vincular dice «Usar en contenido» y no abre nada hasta el clic", () => {
    const html = render({ linkedPostId: null });

    expect(html).toContain("Usar en contenido");
    expect(html).not.toContain("En contenido ▾");
    expect(html).not.toContain('role="dialog"');
  });

  it("vinculado pasa a «En contenido ▾», con el menú cerrado", () => {
    const html = render({ linkedPostId: "p1", linkedNetwork: "instagram" });

    expect(html).toContain("En contenido ▾");
    expect(html).not.toContain("Abrir la pieza");
    expect(html).not.toContain("Usar en contenido");
  });

  it("es un botón común (tamaño de la barra) y no se rompe sin red vinculada", () => {
    const html = render({ linkedPostId: null });

    expect(html).toContain("<button");
    expect(html).toContain("h-9");
  });
});
