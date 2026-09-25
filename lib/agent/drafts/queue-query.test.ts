import { describe, it, expect } from "vitest";
import { compareQueue, draftOwner, matchesOwner, parseDraftFilters } from "./queue-query";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

describe("de quien es un borrador", () => {
  it("setter; sin setter, vendedor; sin ninguno, sin asignar", () => {
    expect(draftOwner({ setter_id: "s", vendedor_id: "v" })).toBe("s");
    expect(draftOwner({ setter_id: null, vendedor_id: "v" })).toBe("v");
    expect(draftOwner({ setter_id: null, vendedor_id: null })).toBeNull();
  });

  it("filtro por persona", () => {
    expect(matchesOwner("u-1", "mios", "u-1")).toBe(true);
    expect(matchesOwner("u-2", "mios", "u-1")).toBe(false);
    expect(matchesOwner(null, "sin-asignar", "u-1")).toBe(true);
    expect(matchesOwner("u-2", "u-2", "u-1")).toBe(true);
    expect(matchesOwner(null, "todos", "u-1")).toBe(true);
  });
});

describe("filtros de la URL", () => {
  it("por defecto: mios y pendientes; un id que no es del workspace se ignora", () => {
    expect(parseDraftFilters({}, { memberIds: ["u-1"], channelIds: [] })).toMatchObject({ quien: "mios", estado: "pendientes", ventana: "" });
    expect(parseDraftFilters({ quien: "u-99" }, { memberIds: ["u-1"], channelIds: [] }).quien).toBe("mios");
    expect(parseDraftFilters({ quien: "u-1", ventana: "por-vencer" }, { memberIds: ["u-1"], channelIds: [] })).toMatchObject({ quien: "u-1", ventana: "por-vencer" });
  });
});

describe("orden de la cola", () => {
  it("lo que vence antes primero; cerrados y sin ventana al fondo", () => {
    const rows = [
      { id: "sin-ventana", sendable_until: null, created_at: at(-10) },
      { id: "cerrado", sendable_until: at(-1), created_at: at(-30) },
      { id: "tarde", sendable_until: at(20), created_at: at(-4) },
      { id: "pronto", sendable_until: at(2), created_at: at(-22) },
    ];
    expect([...rows].sort((a, b) => compareQueue(a, b, NOW)).map((r) => r.id)).toEqual(["pronto", "tarde", "cerrado", "sin-ventana"]);
  });

  it("con dos canales de plazos distintos, manda la ventana y no la fecha", () => {
    const wa = { sendable_until: at(1), created_at: at(-1) };
    const ig = { sendable_until: at(10), created_at: at(-14) };
    expect(compareQueue(wa, ig, NOW)).toBeLessThan(0);
  });
});
