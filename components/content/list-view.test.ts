/**
 * A2: lo que la lista de Contenido muestra de la publicidad. Se renderiza en el servidor (alcanza para fijar qué
 * aparece): sin permiso para ver anuncios, la lista queda EXACTAMENTE igual que antes, aunque haya piezas pautadas.
 */
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseContentFilters } from "@/lib/content/filters";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const { ContentList, ContentListFilterFields, ContentListFilters } = await import("./list-view");

const rows = [
  { id: "a", title: "Pieza pautada", status: "draft" as const, createdBy: "u1", platforms: ["instagram"], format: null, authorName: null, authorship: null, pillar: null, firstAt: null, hasCopy: true, paid: true },
  { id: "b", title: "Pieza sin pauta", status: "draft" as const, createdBy: "u1", platforms: ["instagram"], format: null, authorName: null, authorship: null, pillar: null, firstAt: null, hasCopy: true, paid: false },
];

// La lista y sus filtros (que ahora van en la barra superior de la pantalla): se renderizan juntos.
const render = (props: { showPaid?: boolean; query?: string }) => {
  const filters = parseContentFilters(new URLSearchParams(props.query ?? ""));
  return (
    renderToStaticMarkup(createElement(ContentListFilters, { filters, authors: [], months: [], showPaid: props.showPaid })) +
    // Lo de adentro del menú «Filtros» (cerrado no se dibuja).
    renderToStaticMarkup(createElement(ContentListFilterFields, { filters, authors: [], months: [], showPaid: !!props.showPaid, active: 0, onSet: () => {}, onClear: () => {} })) +
    renderToStaticMarkup(createElement(ContentList, { rows, filters, timeZone: "UTC", showPaid: props.showPaid }))
  );
};

describe("lista de Contenido · piezas pautadas", () => {
  it("sin permiso para ver anuncios no hay indicador ni filtro: la lista es la de siempre", () => {
    const html = render({ showPaid: false });
    expect(html).not.toContain(">Pautada<");
    expect(html).not.toContain("Pautadas");
    expect(html).not.toContain(">Pauta<");
    expect(html).toContain("Pieza pautada");
    expect(html).toContain("Pieza sin pauta");
    // Sin la prop (como la llamaba la pantalla antes de A2) es lo mismo.
    expect(render({})).toBe(html);
  });

  it("con permiso: el indicador va solo en la pieza con anuncio y aparece el filtro", () => {
    const html = render({ showPaid: true });
    expect(html.match(/>Pautada</g)).toHaveLength(1); // el indicador (no la opción «Pautadas» del filtro)
    expect(html).toContain(">Pauta<");
    expect(html).toContain("No pautadas");
  });

  it("el filtro de la URL deja solo las pautadas, o solo las que no", () => {
    const si = render({ showPaid: true, query: "pautada=si" });
    expect(si).toContain("Pieza pautada");
    expect(si).not.toContain("Pieza sin pauta");
    const no = render({ showPaid: true, query: "pautada=no" });
    expect(no).toContain("Pieza sin pauta");
    expect(no).not.toContain("Pieza pautada");
  });
});
