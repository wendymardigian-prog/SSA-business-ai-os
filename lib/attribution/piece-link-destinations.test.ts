import { describe, expect, it } from "vitest";
import {
  buildEventDestinations,
  CUSTOM_DESTINATION,
  destinationHint,
  destinationKey,
  destinationUrl,
  selectedDestination,
  type PieceLinkDestinations,
} from "./piece-link-destinations";
import { composePieceLink } from "./piece-link";

const BASE = "https://links.negocio.com";
const event = (over: Record<string, unknown> = {}) => ({ id: "e-1", title: "Llamada de ventas", slug: "ventas", status: "active", owner_user_id: "u-1", ...over });
const profile = (over: Record<string, unknown> = {}) => ({ user_id: "u-1", username: "ana", display_name: "Ana Pérez", is_active: true, ...over });

describe("buildEventDestinations", () => {
  it("arma el link público con el dominio del negocio", () => {
    expect(buildEventDestinations({ events: [event()], profiles: [profile()], base: BASE })).toEqual([
      { kind: "event", id: "e-1", label: "Llamada de ventas", url: "https://links.negocio.com/calendario/ana/ventas" },
    ]);
  });

  it("ofrece los ocultos (abren con el link directo) y los marca; deja afuera los inactivos", () => {
    const out = buildEventDestinations({
      events: [event({ id: "a" }), event({ id: "h", title: "Mentoría", slug: "m", status: "hidden" }), event({ id: "i", status: "inactive" })],
      profiles: [profile()],
      base: BASE,
    });
    expect(out.map((d) => [d.id, d.label])).toEqual([
      ["a", "Llamada de ventas"],
      ["h", "Mentoría · oculto"],
    ]);
  });

  it("deja afuera los de un perfil apagado, sin usuario o sin perfil (su link da 404)", () => {
    const out = buildEventDestinations({
      events: [event({ id: "off", owner_user_id: "u-off" }), event({ id: "blank", owner_user_id: "u-blank" }), event({ id: "none", owner_user_id: "u-none" })],
      profiles: [profile({ user_id: "u-off", is_active: false }), profile({ user_id: "u-blank", username: "  " })],
      base: BASE,
    });
    expect(out).toEqual([]);
  });

  it("con más de una persona atendiendo, cada evento dice quién", () => {
    const out = buildEventDestinations({
      events: [event(), event({ id: "e-2", owner_user_id: "u-2" })],
      profiles: [profile(), profile({ user_id: "u-2", username: "beto", display_name: "" })],
      base: BASE,
    });
    expect(out.map((d) => d.label)).toEqual(["Llamada de ventas · Ana Pérez", "Llamada de ventas · beto"]);
  });

  it("una persona con perfil apagado no cuenta como segunda persona", () => {
    const out = buildEventDestinations({
      events: [event(), event({ id: "e-2", owner_user_id: "u-2" })],
      profiles: [profile(), profile({ user_id: "u-2", is_active: false })],
      base: BASE,
    });
    expect(out.map((d) => d.label)).toEqual(["Llamada de ventas"]);
  });
});

describe("el destino elegido", () => {
  const destinations: PieceLinkDestinations = {
    forms: [{ kind: "form", id: "f-1", label: "Aplicación", url: `${BASE}/f/aplicacion` }],
    events: [{ kind: "event", id: "e-1", label: "Llamada", url: `${BASE}/calendario/ana/ventas` }],
  };

  it("«Otro link» usa lo escrito; elegir un destino usa su link; volver recupera lo escrito", () => {
    const typed = "https://mi-web.com/programa";
    expect(destinationUrl(selectedDestination(CUSTOM_DESTINATION, destinations), typed)).toBe(typed);
    expect(destinationUrl(selectedDestination("form:f-1", destinations), typed)).toBe(`${BASE}/f/aplicacion`);
    expect(destinationUrl(selectedDestination(CUSTOM_DESTINATION, destinations), typed)).toBe(typed);
  });

  it("un destino que ya no está en la lista (o antes de cargar) cae a lo escrito", () => {
    expect(selectedDestination("form:borrado", destinations)).toBeNull();
    expect(selectedDestination("event:e-1", null)).toBeNull();
  });

  it("la clave distingue formularios de agendas con el mismo id", () => {
    expect(destinationKey({ kind: "form", id: "x" })).not.toBe(destinationKey({ kind: "event", id: "x" }));
  });

  it("el link armado lleva los cuatro parámetros de la pieza", () => {
    for (const d of [...destinations.forms, ...destinations.events]) {
      const res = composePieceLink({ url: d.url, platform: "instagram", pieceTitle: "Reel", contentCode: "c8k2f" });
      expect(res.ok).toBe(true);
      const params = res.ok ? new URL(res.url).searchParams : new URLSearchParams();
      expect(Object.fromEntries(params)).toEqual({ utm_source: "instagram", utm_medium: "organic_social", utm_campaign: "reel", utm_content: "c8k2f" });
    }
  });
});

describe("destinationHint", () => {
  it("dice qué pasa según el destino", () => {
    expect(destinationHint(null)).toMatch(/sin seguimiento/);
    expect(destinationHint({ kind: "event", id: "e", label: "", url: "" })).toMatch(/agende.*atribuida a esta pieza/);
    expect(destinationHint({ kind: "form", id: "f", label: "", url: "" })).toMatch(/complete.*atribuida a esta pieza/);
    expect(destinationHint({ kind: "form", id: "f", label: "", url: "", noContact: true })).toMatch(/no suma a esta pieza/); // @plantilla-quitar(formularios)
  });
});
