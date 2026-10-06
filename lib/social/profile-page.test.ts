/**
 * La pagina Social (F54).
 */

import { describe, it, expect } from "vitest";
import {
  buildProfile,
  buildUpcoming,
  defaultPlatform,
  followerTrend,
  formatFilters,
  gridRatio,
  latestProfileStats,
  linkedinRows,
  networkTabs,
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
  videos: null,
  syncError: null,
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

describe("las cifras reales del perfil (F100)", () => {
  it("de cada cifra se toma la ultima que se leyo, aunque un dia mas nuevo no la traiga", () => {
    const figures = latestProfileStats([
      { date: "2026-10-01", extra: { profile: { following: 300, posts: 180, views: 5000 } } },
      { date: "2026-10-03", extra: { profile: { following: 310 } } },
      { date: "2026-10-04", extra: {} },
    ]);

    expect(figures).toEqual({ following: 310, posts: 180, videos: null, views: 5000, likes: null });
  });

  it("una cifra que la red no dio queda en null, nunca en cero", () => {
    // Un cero se leeria como "esta cuenta no sigue a nadie".
    const figures = latestProfileStats([{ date: "2026-10-01", extra: { profile: { posts: 12 } } }]);

    expect(figures.following).toBeNull();
    expect(figures.posts).toBe(12);
  });

  it("un cero que la red SI dio se conserva: es un dato", () => {
    expect(latestProfileStats([{ date: "2026-10-01", extra: { profile: { following: 0 } } }]).following).toBe(0);
  });

  it("sin filas, o con un extra raro, no rompe", () => {
    expect(latestProfileStats([])).toEqual({ following: null, posts: null, videos: null, views: null, likes: null });
    expect(latestProfileStats([{ date: "2026-10-01", extra: "basura" }]).posts).toBeNull();
    expect(latestProfileStats([{ date: "2026-10-01", extra: { profile: { posts: "muchos" } } }]).posts).toBeNull();
  });

  it("el orden de las filas no importa: gana la fecha mas nueva", () => {
    const figures = latestProfileStats([
      { date: "2026-10-03", extra: { profile: { posts: 20 } } },
      { date: "2026-10-01", extra: { profile: { posts: 10 } } },
    ]);

    expect(figures.posts).toBe(20);
  });

  it("YouTube muestra los videos y las vistas reales", () => {
    const stats = statsFor(source({ platform: "youtube", followers: 900, videos: 40, totalOther: 120000 }));

    expect(stats.find((s) => s.key === "posts")?.value).toBe(40);
    expect(stats.find((s) => s.key === "views")?.value).toBe(120000);
  });

  it("si la ultima lectura fallo, el perfil lo avisa y sigue mostrando lo ultimo que se leyo", () => {
    const profile = buildProfile(source({ syncError: "Zernio: cuenta sin permisos" }));

    expect(profile.warning).toContain("Zernio: cuenta sin permisos");
    expect(profile.stats.find((s) => s.key === "followers")?.value).toBe(4200);
  });

  it("sin error no hay aviso", () => {
    expect(buildProfile(source()).warning).toBeNull();
  });
});

describe("una pestaña por red, conectada o no (F100)", () => {
  it("siempre las cinco, en orden, marcando cuales estan conectadas", () => {
    expect(networkTabs(["tiktok", "instagram"])).toEqual([
      { platform: "instagram", connected: true },
      { platform: "tiktok", connected: true },
      { platform: "youtube", connected: false },
      { platform: "linkedin", connected: false },
      { platform: "threads", connected: false },
    ]);
  });

  it("sin ninguna conectada siguen las cinco: cada una invita a conectar", () => {
    expect(networkTabs([]).every((t) => !t.connected)).toBe(true);
    expect(networkTabs([])).toHaveLength(5);
  });

  it("arranca en la primera conectada, y si no hay, en Instagram", () => {
    expect(defaultPlatform(["youtube", "threads"])).toBe("youtube");
    expect(defaultPlatform([])).toBe("instagram");
  });
});

describe('la seccion "Proximas" (F100)', () => {
  const NOW = new Date("2026-10-06T12:00:00Z");
  const post = (over: Record<string, unknown> = {}) => ({
    id: "p1",
    title: "Una pieza",
    status: "approved",
    format: "Reel",
    networks: [{ platform: "instagram", planned_at: "2026-10-10T15:00:00Z" }],
    ...over,
  });

  it("lo tentativo (una fecha en la pieza, sin nada en la cola) aparece como tentativo", () => {
    const items = buildUpcoming({ posts: [post()], publications: [], platform: "instagram", now: NOW });

    expect(items).toEqual([
      { contentPostId: "p1", title: "Una pieza", platform: "instagram", at: "2026-10-10T15:00:00Z", kind: "tentative", format: "Reel" },
    ]);
  });

  it("lo programado aparece como programado, con la fecha de la cola", () => {
    const items = buildUpcoming({
      posts: [post()],
      publications: [{ contentPostId: "p1", platform: "instagram", status: "scheduled", scheduledAt: "2026-10-10T16:00:00Z" }],
      platform: "instagram",
      now: NOW,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "scheduled", at: "2026-10-10T16:00:00Z" });
  });

  it("preparando la subida y publicando tambien cuentan como programado", () => {
    for (const status of ["uploading", "publishing"]) {
      const items = buildUpcoming({
        posts: [post()],
        publications: [{ contentPostId: "p1", platform: "instagram", status, scheduledAt: "2026-10-10T16:00:00Z" }],
        platform: "instagram",
        now: NOW,
      });
      expect(items[0].kind).toBe("scheduled");
    }
  });

  it("lo ya publicado NO es una proxima: esta en la grilla", () => {
    const items = buildUpcoming({
      posts: [post({ status: "published" })],
      publications: [{ contentPostId: "p1", platform: "instagram", status: "published", scheduledAt: "2026-10-05T15:00:00Z" }],
      platform: "instagram",
      now: NOW,
    });

    expect(items).toEqual([]);
  });

  it("una fecha tentativa que ya paso no es una proxima", () => {
    const items = buildUpcoming({
      posts: [post({ networks: [{ platform: "instagram", planned_at: "2026-10-01T15:00:00Z" }] })],
      publications: [],
      platform: "instagram",
      now: NOW,
    });

    expect(items).toEqual([]);
  });

  it("una red sin fecha no es una proxima: todavia no se sabe cuando", () => {
    const items = buildUpcoming({
      posts: [post({ networks: [{ platform: "instagram", planned_at: null }] })],
      publications: [],
      platform: "instagram",
      now: NOW,
    });

    expect(items).toEqual([]);
  });

  it("solo las de ESA red", () => {
    const items = buildUpcoming({
      posts: [post({ networks: [{ platform: "instagram", planned_at: "2026-10-10T15:00:00Z" }, { platform: "tiktok", planned_at: "2026-10-11T15:00:00Z" }] })],
      publications: [],
      platform: "tiktok",
      now: NOW,
    });

    expect(items.map((i) => i.platform)).toEqual(["tiktok"]);
  });

  it("una publicacion cancelada o fallida vuelve a ser tentativa (la fecha sigue en la pieza)", () => {
    const items = buildUpcoming({
      posts: [post()],
      publications: [{ contentPostId: "p1", platform: "instagram", status: "cancelled", scheduledAt: "2026-10-10T16:00:00Z" }],
      platform: "instagram",
      now: NOW,
    });

    expect(items[0]).toMatchObject({ kind: "tentative", at: "2026-10-10T15:00:00Z" });
  });

  it("van ordenadas: la que sale primero, primero", () => {
    const items = buildUpcoming({
      posts: [
        post({ id: "tarde", title: "Tarde", networks: [{ platform: "instagram", planned_at: "2026-10-20T15:00:00Z" }] }),
        post({ id: "temprano", title: "Temprano", networks: [{ platform: "instagram", planned_at: "2026-10-08T15:00:00Z" }] }),
      ],
      publications: [],
      platform: "instagram",
      now: NOW,
    });

    expect(items.map((i) => i.contentPostId)).toEqual(["temprano", "tarde"]);
  });

  it("una pieza archivada no aparece", () => {
    const items = buildUpcoming({
      posts: [post({ archivedAt: "2026-10-02T00:00:00Z" })],
      publications: [],
      platform: "instagram",
      now: NOW,
    });

    expect(items).toEqual([]);
  });
});

describe("LinkedIn como lista (F100)", () => {
  const item = (over: Record<string, unknown> = {}) => ({
    socialPostId: "s1",
    contentPostId: "p1",
    caption: "Un texto largo para LinkedIn",
    status: "published",
    publishedAt: "2026-10-03T15:00:00Z",
    scheduledAt: null,
    url: "https://linkedin.com/x",
    lastError: null,
    ...over,
  });

  it("dice el estado en palabras y lleva el link a la publicacion", () => {
    const [row] = linkedinRows([item()]);

    expect(row).toMatchObject({ state: "Publicada", tone: "ok", url: "https://linkedin.com/x" });
  });

  it("una que fallo muestra el motivo", () => {
    const [row] = linkedinRows([item({ status: "failed", publishedAt: null, url: null, lastError: "LinkedIn rechazo el texto" })]);

    expect(row).toMatchObject({ state: "No salió", tone: "error", note: "LinkedIn rechazo el texto" });
  });

  it("una programada muestra su fecha", () => {
    const [row] = linkedinRows([item({ status: "scheduled", publishedAt: null, scheduledAt: "2026-10-09T15:00:00Z" })]);

    expect(row.state).toBe("Programada");
    expect(row.at).toBe("2026-10-09T15:00:00Z");
  });

  it("las mas nuevas primero, y las canceladas no aparecen", () => {
    const rows = linkedinRows([
      item({ socialPostId: "viejo", publishedAt: "2026-10-01T15:00:00Z" }),
      item({ socialPostId: "nuevo", publishedAt: "2026-10-05T15:00:00Z" }),
      item({ socialPostId: "cancelado", status: "cancelled" }),
    ]);

    expect(rows.map((r) => r.socialPostId)).toEqual(["nuevo", "viejo"]);
  });

  it("el texto se recorta para la lista", () => {
    const [row] = linkedinRows([item({ caption: "x".repeat(300) })]);

    expect(row.title.length).toBeLessThanOrEqual(140);
  });

  it("sin texto tiene un titulo igual", () => {
    expect(linkedinRows([item({ caption: null })])[0].title).toBe("Publicación sin texto");
  });
});
