/**
 * La pagina Social (F54).
 */

import { describe, it, expect } from "vitest";
import {
  buildProfile,
  followerTrend,
  formatFilters,
  gridRatio,
  statsFor,
  type ProfileSource,
} from "./profile-page";

const source = (over: Partial<ProfileSource> = {}): ProfileSource => ({
  platform: "instagram",
  username: "minegocio",
  displayName: "Mi negocio",
  bio: "Marketing",
  website: null,
  avatarUrl: null,
  followers: 4200,
  following: 300,
  posts: 180,
  totalOther: null,
  syncedAt: "2026-10-01T06:00:00Z",
  ...over,
});

describe("las cifras de cada red (F54)", () => {
  it("Instagram cuenta publicaciones, seguidores y seguidos", () => {
    expect(statsFor(source()).map((s) => s.label)).toEqual([
      "Publicaciones",
      "Seguidores",
      "Seguidos",
    ]);
  });

  it("YouTube habla de suscriptores y videos, no de seguidores y posts", () => {
    // Las mismas tres etiquetas para todas obligarian a traducir mentalmente.
    expect(statsFor(source({ platform: "youtube" })).map((s) => s.label)).toEqual([
      "Suscriptores",
      "Videos",
      "Vistas",
    ]);
  });

  it("TikTok pone los me gusta totales", () => {
    const stats = statsFor(source({ platform: "tiktok", totalOther: 90000 }));

    expect(stats.find((s) => s.key === "likes")?.value).toBe(90000);
  });

  it("Threads solo tiene seguidores", () => {
    expect(statsFor(source({ platform: "threads" }))).toHaveLength(1);
  });
});

describe("el perfil completo (F54)", () => {
  it("dice de donde salen los datos y cuando", () => {
    const profile = buildProfile(source());

    expect(profile.sourceLabel).toContain("Zernio y la Graph de Meta");
    expect(profile.sourceLabel).toContain("1 oct");
  });

  it("si nunca se leyo, lo dice en vez de mostrar una fecha vacia", () => {
    expect(buildProfile(source({ syncedAt: null })).sourceLabel).toContain("Todavia no se leyeron");
  });
});

describe("la forma de la grilla (F54)", () => {
  it("cada red usa la suya", () => {
    // Una grilla cuadrada recorta el Reel y deja aire en el video.
    expect(gridRatio("instagram")).toBe("3 / 4");
    expect(gridRatio("tiktok")).toBe("9 / 16");
    expect(gridRatio("youtube")).toBe("16 / 9");
  });

  it("una red que no conocemos cae en cuadrado", () => {
    expect(gridRatio("marte")).toBe("1 / 1");
  });
});

describe("los filtros de formato (F54)", () => {
  it("son los de esa red", () => {
    expect(formatFilters("youtube").map((f) => f.value)).toEqual(["video", "short"]);
    expect(formatFilters("instagram").map((f) => f.value)).toContain("reel");
  });

  it("una red sin formatos no muestra el filtro", () => {
    expect(formatFilters("marte")).toEqual([]);
  });
});

describe("la tendencia de seguidores (F54)", () => {
  it("es la diferencia entre el primero y el ultimo", () => {
    const trend = followerTrend([
      { date: "2026-09-01", followers: 4000 },
      { date: "2026-10-01", followers: 4200 },
    ]);

    expect(trend.change).toBe(200);
    expect(trend.series).toHaveLength(2);
  });

  it("con un solo punto no hay tendencia", () => {
    // Un "0%" diria que la cuenta no crecio, que no es lo que se sabe.
    expect(followerTrend([{ date: "2026-10-01", followers: 4200 }]).change).toBeNull();
  });

  it("los dias sin dato no entran en la serie", () => {
    const trend = followerTrend([
      { date: "2026-09-01", followers: 4000 },
      { date: "2026-09-15", followers: null },
      { date: "2026-10-01", followers: 4200 },
    ]);

    expect(trend.series).toHaveLength(2);
  });
});
