import { describe, it, expect } from "vitest";
import { sumAccountsByDay } from "./content-load";

const row = (platform: string, date: string, followers: number | null, gained: number | null = null, lost: number | null = null) => ({
  platform,
  date,
  followers,
  followersGained: gained,
  followersLost: lost,
});

describe("sumAccountsByDay (varias cuentas por red)", () => {
  it("con una cuenta por red no cambia nada", () => {
    const rows = [row("instagram", "2026-10-01", 100, 3, 1), row("tiktok", "2026-10-01", 50)];
    expect(sumAccountsByDay(rows)).toEqual(rows);
  });

  it("suma los seguidores de las cuentas de una red en el mismo dia, y no mezcla redes ni dias", () => {
    const out = sumAccountsByDay([
      row("instagram", "2026-10-01", 100, 3, 1),
      row("instagram", "2026-10-01", 40, 2, 0),
      row("instagram", "2026-10-02", 150),
      row("tiktok", "2026-10-01", 50),
    ]);
    expect(out).toEqual([
      row("instagram", "2026-10-01", 140, 5, 1),
      row("instagram", "2026-10-02", 150),
      row("tiktok", "2026-10-01", 50),
    ]);
  });

  it("un dato que ninguna cuenta dio queda en null, no en cero", () => {
    const out = sumAccountsByDay([row("instagram", "2026-10-01", null), row("instagram", "2026-10-01", null)]);
    expect(out[0].followers).toBeNull();
    // Si una cuenta lo dio y la otra no, cuenta lo que se sabe.
    const partial = sumAccountsByDay([row("instagram", "2026-10-01", 80), row("instagram", "2026-10-01", null)]);
    expect(partial[0].followers).toBe(80);
  });
});
