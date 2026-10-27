import { describe, expect, it } from "vitest";
import { buildTimeline, channelOf, compareTouchesNewestFirst, TIMELINE_PAGE_SIZE, type TimelineTouch } from "./touch-timeline";

const PIECE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let n = 0;
const touch = (over: Partial<TimelineTouch> & { occurred_at: string }): TimelineTouch => {
  n += 1;
  return {
    id: `t-${String(n).padStart(4, "0")}`,
    source: "instagram",
    medium: null,
    content_label: null,
    content_post_id: null,
    origin: "dm",
    created_at: over.occurred_at,
    ...over,
  };
};

describe("buildTimeline: orden y marcas", () => {
  // Orgánico A (1/10), directo (5/10), pauta B (8/10), directo (12/10).
  const a = touch({ id: "A", occurred_at: "2026-10-01T10:00:00Z", origin: "comment", medium: "comment", content_post_id: PIECE, content_label: "Reel A", channel: "organic" });
  const d1 = touch({ id: "D1", occurred_at: "2026-10-05T10:00:00Z", source: "whatsapp", channel: "direct" });
  const b = touch({ id: "B", occurred_at: "2026-10-08T10:00:00Z", origin: "form", medium: "paid_social", ad_id: "123", channel: "paid" });
  const d2 = touch({ id: "D2", occurred_at: "2026-10-12T10:00:00Z", source: "whatsapp", channel: "direct" });

  it("del mas nuevo al mas viejo", () => {
    const tl = buildTimeline([a, d1, b, d2]);
    expect(tl.items.map((i) => i.id)).toEqual(["D2", "B", "D1", "A"]);
  });

  it("marca Primer toque, Ultimo toque y Ultimo con origen (el ultimo no directo)", () => {
    const tl = buildTimeline([a, d1, b, d2]);
    const byId = Object.fromEntries(tl.items.map((i) => [i.id, i.marks]));
    expect(byId).toEqual({ D2: ["last"], B: ["last_origin"], D1: [], A: ["first"] });
    expect(tl.firstTouchId).toBe("A");
    expect(tl.lastTouchId).toBe("D2");
    expect(tl.lastOriginTouchId).toBe("B");
    expect(tl.items.find((i) => i.id === "B")?.markLabels).toEqual(["Último con origen"]);
    expect(tl.items.find((i) => i.id === "A")?.markLabels).toEqual(["Primer toque"]);
  });

  it("si el ultimo toque ya tiene origen, lleva las dos marcas", () => {
    const tl = buildTimeline([a, d1, b]);
    expect(tl.items[0].id).toBe("B");
    expect(tl.items[0].marks).toEqual(["last", "last_origin"]);
  });

  it("un solo toque es primero y ultimo a la vez", () => {
    const tl = buildTimeline([a]);
    expect(tl.items[0].marks).toEqual(["first", "last", "last_origin"]);
  });

  it("sin ningun toque con origen no hay 'ultimo con origen'", () => {
    const tl = buildTimeline([d1, d2]);
    expect(tl.lastOriginTouchId).toBeNull();
    expect(tl.items.flatMap((i) => i.marks)).not.toContain("last_origin");
  });

  it("sin toques: pagina vacia, sin romper", () => {
    expect(buildTimeline([])).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: TIMELINE_PAGE_SIZE,
      pageCount: 1,
      hasPrev: false,
      hasNext: false,
      firstTouchId: null,
      lastTouchId: null,
      lastOriginTouchId: null,
    });
  });

  it("desempata como record_contact_touch: occurred_at, created_at, id (todo descendente)", () => {
    const same = "2026-10-01T10:00:00Z";
    const x = touch({ id: "x", occurred_at: same, created_at: "2026-10-01T10:00:05Z" });
    const y = touch({ id: "y", occurred_at: same, created_at: "2026-10-01T10:00:09Z" });
    const z = touch({ id: "z", occurred_at: same, created_at: "2026-10-01T10:00:09Z" });
    expect(buildTimeline([x, y, z]).items.map((i) => i.id)).toEqual(["z", "y", "x"]);
    expect([x, y, z].sort(compareTouchesNewestFirst).map((t) => t.id)).toEqual(["z", "y", "x"]);
  });

  it("no muta la lista de entrada", () => {
    const input = [a, d1, b, d2];
    buildTimeline(input);
    expect(input.map((t) => t.id)).toEqual(["A", "D1", "B", "D2"]);
  });

  it("canal y origen en palabras, pieza con link y anuncio", () => {
    const tl = buildTimeline([a, b]);
    const itemB = tl.items.find((i) => i.id === "B")!;
    const itemA = tl.items.find((i) => i.id === "A")!;
    expect(itemB.channelLabel).toBe("Pauta");
    expect(itemB.originLabel).toBe("Formulario"); // @plantilla-quitar(formularios)
    // @plantilla-sin(formularios): expect(itemB.originLabel).toBe("form");
    expect(itemB.adId).toBe("123");
    expect(itemA.channelLabel).toBe("Orgánico");
    expect(itemA.originLabel).toBe("Comentario");
    expect(itemA.view.piece).toBe("Reel A");
    expect(itemA.view.href).toContain(PIECE);
    expect(itemA.contentPostId).toBe(PIECE);
  });

  it("un origen desconocido se muestra tal cual y el clic tiene nombre", () => {
    const tl = buildTimeline([touch({ id: "c", occurred_at: "2026-10-01T10:00:00Z", origin: "link_click", medium: "dm_link" }), touch({ id: "r", occurred_at: "2026-10-02T10:00:00Z", origin: "raro" })]);
    expect(tl.items.find((i) => i.id === "c")?.originLabel).toBe("Clic en un link");
    expect(tl.items.find((i) => i.id === "r")?.originLabel).toBe("raro");
    // medium dm_link => organico, calculado porque la fila no trae canal.
    expect(tl.items.find((i) => i.id === "c")?.channel).toBe("organic");
  });
});

describe("buildTimeline: paginacion de a 50", () => {
  const many = Array.from({ length: 120 }, (_, i) =>
    touch({ id: `m-${String(i).padStart(3, "0")}`, occurred_at: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString(), channel: i === 3 ? "organic" : "direct" }),
  );

  it("tres paginas: 50, 50 y 20", () => {
    const p1 = buildTimeline(many, { page: 1 });
    const p2 = buildTimeline(many, { page: 2 });
    const p3 = buildTimeline(many, { page: 3 });
    expect([p1.items.length, p2.items.length, p3.items.length]).toEqual([50, 50, 20]);
    expect(p1.total).toBe(120);
    expect(p1.pageCount).toBe(3);
    expect([p1.hasPrev, p1.hasNext]).toEqual([false, true]);
    expect([p3.hasPrev, p3.hasNext]).toEqual([true, false]);
    expect(p1.items[0].id).toBe("m-119");
    expect(p3.items.at(-1)?.id).toBe("m-000");
  });

  it("las marcas se calculan sobre todos los toques, no sobre la pagina", () => {
    const p1 = buildTimeline(many, { page: 1 });
    expect(p1.firstTouchId).toBe("m-000");
    expect(p1.lastOriginTouchId).toBe("m-003");
    // El 'Primer toque' no esta en la pagina 1, pero si en la 3.
    expect(p1.items.flatMap((i) => i.marks)).toEqual(["last"]);
    expect(buildTimeline(many, { page: 3 }).items.at(-1)?.marks).toEqual(["first"]);
    expect(buildTimeline(many, { page: 3 }).items.find((i) => i.id === "m-003")?.marks).toEqual(["last_origin"]);
  });

  it("una pagina fuera de rango o invalida se lleva al borde", () => {
    expect(buildTimeline(many, { page: 99 }).page).toBe(3);
    expect(buildTimeline(many, { page: 0 }).page).toBe(1);
    expect(buildTimeline(many, { page: -4 }).page).toBe(1);
    expect(buildTimeline(many, { page: NaN }).page).toBe(1);
  });

  it("el tamaño de pagina se puede cambiar, con limites", () => {
    expect(buildTimeline(many, { pageSize: 10 }).pageCount).toBe(12);
    expect(buildTimeline(many, { pageSize: 0 }).pageSize).toBe(TIMELINE_PAGE_SIZE);
    expect(buildTimeline(many, { pageSize: 5000 }).pageSize).toBe(200);
  });
});

describe("channelOf", () => {
  it("usa el canal guardado y calcula el que falta", () => {
    expect(channelOf(touch({ occurred_at: "2026-10-01T00:00:00Z", channel: "referral" }))).toBe("referral");
    expect(channelOf(touch({ occurred_at: "2026-10-01T00:00:00Z", origin: "form", gclid: "x" }))).toBe("paid");
    expect(channelOf(touch({ occurred_at: "2026-10-01T00:00:00Z", origin: "form" }))).toBe("direct");
    expect(channelOf(touch({ occurred_at: "2026-10-01T00:00:00Z", channel: "invalido", origin: "dm", source: "instagram" }))).toBe("organic");
    expect(channelOf(touch({ occurred_at: "2026-10-01T00:00:00Z", content_post_id: PIECE, origin: "form" }))).toBe("organic");
  });
});
