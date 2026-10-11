import { describe, it, expect } from "vitest";
import { availableDashboards, activeDashboard, comingSoonDashboards, DASHBOARDS } from "./available";

const todo = () => true;
const nada = () => false;
const solo = (...keys: string[]) => (p: string) => keys.includes(p);

describe("B3 · que dashboards se ven", () => {
  it("con todos los permisos se ven los seis", () => {
    expect(availableDashboards(todo).map((d) => d.key)).toEqual([
      "chat",
      "content",
      "agenda",
      "calls",
      "ads",
      "unified",
    ]);
  });

  it("Llamadas sale del permiso calls.view y de nada mas", () => {
    expect(availableDashboards(solo("calls.view")).map((d) => d.key)).toEqual(["calls"]);
    expect(availableDashboards(solo("dashboards.agenda.view")).map((d) => d.key)).not.toContain("calls");
  });

  it("Agenda sale de su propio permiso", () => {
    expect(availableDashboards(solo("dashboards.agenda.view")).map((d) => d.key)).toEqual(["agenda"]);
    expect(availableDashboards(solo("dashboards.chat.view")).map((d) => d.key)).not.toContain("agenda");
  });

  it("Meta Ads y Unificado aparecen SIEMPRE para quien tiene el permiso", () => {
    // No dependen de que Meta este conectado: una opcion que no se ve es una
    // opcion que no existe. Sin cuenta, la pantalla ofrece conectarla.
    const keys = availableDashboards(solo("dashboards.ads.view")).map((d) => d.key);
    expect(keys).toContain("ads");
    expect(keys).toContain("unified");
  });

  it("sin el permiso de anuncios, esos dos no se ven", () => {
    const keys = availableDashboards(
      solo("dashboards.chat.view", "dashboards.content.view"),
    ).map((d) => d.key);
    expect(keys).toEqual(["chat", "content"]);
  });

  it("sin ningun permiso, ninguno", () => {
    expect(availableDashboards(nada)).toEqual([]);
  });

  it("la etiqueta de anuncios dice Meta Ads, que es como se llama", () => {
    expect(DASHBOARDS.find((d) => d.key === "ads")?.label).toBe("Meta Ads");
  });

  it("cada uno tiene su linea de que se ve ahi", () => {
    expect(DASHBOARDS.every((d) => d.description.length > 0)).toBe(true);
  });
});

describe("cual esta abierto", () => {
  it("sale de la ruta", () => {
    expect(activeDashboard("/dashboard/dashboards/ads")?.key).toBe("ads");
  });

  it("tambien en una subruta, como el detalle de una campana", () => {
    expect(activeDashboard("/dashboard/dashboards/ads/campaigns/123")?.key).toBe("ads");
  });

  it("fuera de los dashboards, ninguno", () => {
    expect(activeDashboard("/dashboard/inbox")).toBeNull();
    expect(activeDashboard(null)).toBeNull();
  });
});

describe("lo que todavia no existe", () => {
  // El mecanismo de "Proximamente" queda para el proximo dashboard que se anuncie
  // antes de existir; hoy ninguno esta en ese estado.
  it("ningun dashboard esta anunciado como Proximamente", () => {
    expect(comingSoonDashboards(todo)).toEqual([]);
  });

  it("Gasto de IA ya no esta en el selector: los topes viven en Agentes", () => {
    expect(DASHBOARDS.map((d) => d.key)).not.toContain("ai-spend");
  });
});
