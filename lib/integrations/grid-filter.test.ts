import { describe, it, expect } from "vitest";
import { providersBySection } from "./providers";
import { filterSections, countByChip } from "./grid-filter";
import type { IntegrationStatus } from "./status";

const sections = providersBySection();

function statusOf(statuses: Record<string, IntegrationStatus>) {
  return (id: string) => {
    const status = statuses[id];
    return status ? { status } : undefined;
  };
}

describe("filterSections", () => {
  it("sin filtros, se ven las dos secciones completas", () => {
    const result = filterSections(sections, statusOf({}), { chip: null, onlyAttention: false });
    expect(result.map((g) => g.section)).toEqual(["connections", "ai"]);
    expect(result.flatMap((g) => g.providers).length).toBe(14);
  });

  it("un chip solo filtra Conexiones; Inteligencia artificial no se toca", () => {
    const result = filterSections(sections, statusOf({}), { chip: "mensajeria", onlyAttention: false });
    const bySection = Object.fromEntries(result.map((g) => [g.section, g.providers.map((p) => p.id)]));

    expect(bySection.connections).toEqual(["zernio", "evolution"]);
    // La seccion de IA sigue entera, sin filtrar por el chip.
    expect(bySection.ai?.length).toBe(5);
  });

  it("el chip 'publicacion' trae zernio (mensajeria+publicacion), postproxy, linkedin, threads y google", () => {
    const result = filterSections(sections, statusOf({}), { chip: "publicacion", onlyAttention: false });
    const connections = result.find((g) => g.section === "connections");
    expect(connections?.providers.map((p) => p.id)).toEqual([
      "zernio",
      "postproxy",
      "linkedin",
      "threads",
      "google",
    ]);
  });

  it("Meta no lleva el chip 'publicacion': solo lee anuncios, no publica", () => {
    const result = filterSections(sections, statusOf({}), { chip: "publicacion", onlyAttention: false });
    const connections = result.find((g) => g.section === "connections");
    expect(connections?.providers.map((p) => p.id)).not.toContain("meta");
  });

  it("Meta aparece con el chip 'anuncios'", () => {
    const result = filterSections(sections, statusOf({}), { chip: "anuncios", onlyAttention: false });
    const connections = result.find((g) => g.section === "connections");
    expect(connections?.providers.map((p) => p.id)).toEqual(["meta"]);
  });

  it("'Requiere atencion' se aplica a las dos secciones a la vez que un chip", () => {
    const statuses: Record<string, IntegrationStatus> = {
      zernio: "attention",
      evolution: "connected",
      anthropic: "error",
      openai: "connected",
    };
    const result = filterSections(sections, statusOf(statuses), {
      chip: "mensajeria",
      onlyAttention: true,
    });
    const bySection = Object.fromEntries(result.map((g) => [g.section, g.providers.map((p) => p.id)]));
    // El chip solo filtra Conexiones: Evolution sale por "Requiere atencion"
    // (esta "connected"), Zernio se queda.
    expect(bySection.connections).toEqual(["zernio"]);
    // El chip no toca IA, pero "Requiere atencion" si: Anthropic (error) se ve.
    expect(bySection.ai).toEqual(["anthropic"]);
  });

  it("una integracion sin estado conocido no entra en 'Requiere atencion'", () => {
    const result = filterSections(sections, statusOf({}), { chip: null, onlyAttention: true });
    expect(result).toEqual([]);
  });
});

describe("countByChip", () => {
  it("cuenta las cards de Conexiones por chip, sin tocar IA", () => {
    const counts = countByChip(sections);
    expect(counts.mensajeria).toBe(2); // zernio, evolution
    expect(counts.publicacion).toBe(5); // zernio, postproxy, linkedin, threads, google
    expect(counts.anuncios).toBe(1); // meta
    expect(counts.email).toBe(2); // resend_inbound, resend
  });
});
