import { describe, it, expect } from "vitest";
import {
  buildBoard,
  evaluateDrop,
  redistributionChip,
  reorder,
  type BoardIdea,
  type BoardPost,
} from "./board";
import type { ContentPermissions } from "./status";

const member: ContentPermissions = { create: true, approve: false, publish: false, isAuthor: true };
const admin: ContentPermissions = { create: true, approve: true, publish: true, isAuthor: false };

const idea = (over: Partial<BoardIdea> = {}): BoardIdea => ({
  kind: "idea",
  id: "i1",
  title: "Una idea",
  format: null,
  status: "nueva",
  createdBy: "u1",
  position: 10,
  ...over,
});

const post = (over: Partial<BoardPost> = {}): BoardPost => ({
  kind: "post",
  id: "p1",
  title: "Una pieza",
  format: "reel",
  status: "draft",
  createdBy: "u1",
  position: 10,
  networks: [],
  hasCopy: false,
  hasCaption: false,
  copyFromAi: false,
  materialStatus: "pendiente",
  ...over,
});

describe("armar el tablero (F20)", () => {
  it("son siete columnas, siempre, aunque esten vacias", () => {
    const board = buildBoard([], []);

    expect(board).toHaveLength(7);
    expect(board.every((c) => c.count === 0)).toBe(true);
  });

  it("las ideas nuevas van a su columna", () => {
    const board = buildBoard([idea()], []);

    expect(board[0].cards).toHaveLength(1);
    expect(board[0].label).toBe("Ideas");
  });

  it("una idea aprobada no se muestra: ya vive como post", () => {
    // Si no, la misma cosa se cuenta dos veces en el tablero.
    const board = buildBoard([idea({ status: "aprobada" }), idea({ id: "i2", status: "descartada" })], []);

    expect(board[0].count).toBe(0);
  });

  it("los tres finales caen en Publicado", () => {
    const board = buildBoard([], [
      post({ id: "a", status: "published" }),
      post({ id: "b", status: "failed" }),
      post({ id: "c", status: "partially_published" }),
    ]);

    expect(board.find((c) => c.column === "published")!.count).toBe(3);
  });

  it("dentro de la columna manda la posicion", () => {
    const board = buildBoard([], [
      post({ id: "b", position: 20, title: "B" }),
      post({ id: "a", position: 10, title: "A" }),
    ]);

    expect(board.find((c) => c.column === "draft")!.cards.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("soltar una tarjeta", () => {
  it("mover a produccion la propia pieza esta bien", () => {
    expect(evaluateDrop({ perms: member, post: post(), target: "in_production" })).toEqual({
      ok: true,
      status: "in_production",
    });
  });

  it("a una columna no permitida se revierte con el motivo", () => {
    const result = evaluateDrop({
      perms: member,
      post: post({ status: "in_review" }),
      target: "approved",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.length).toBeGreaterThan(10);
  });

  it("una pieza no vuelve a ser una idea", () => {
    expect(evaluateDrop({ perms: admin, post: post(), target: "ideas" }).ok).toBe(false);
  });

  it("a Programado sin ninguna fecha: se abre el editor en vez de mover", () => {
    // El criterio de F20: no falla en silencio ni programa cualquier cosa.
    const result = evaluateDrop({
      perms: admin,
      post: post({ status: "approved", networks: [] }),
      target: "scheduled",
    });

    expect(result).toMatchObject({ ok: false, openEditor: true });
  });

  it("a Programado sin aprobar: tambien se abre el editor", () => {
    const result = evaluateDrop({
      perms: admin,
      post: post({ status: "draft", networks: [{ platform: "instagram", at: "2026-10-01T15:00:00Z", status: null }] }),
      target: "scheduled",
    });

    expect(result).toMatchObject({ ok: false, openEditor: true });
  });

  it("a Programado, aprobada y con fecha: se mueve", () => {
    const result = evaluateDrop({
      perms: admin,
      post: post({
        status: "approved",
        networks: [{ platform: "instagram", at: "2026-10-01T15:00:00Z", status: null }],
      }),
      target: "scheduled",
    });

    expect(result).toEqual({ ok: true, status: "scheduled" });
  });

  it("un Member no puede programar aunque todo lo demas este listo", () => {
    const result = evaluateDrop({
      perms: member,
      post: post({
        status: "approved",
        networks: [{ platform: "instagram", at: "2026-10-01T15:00:00Z", status: null }],
      }),
      target: "scheduled",
    });

    expect(result).toEqual({ ok: false, reason: expect.stringContaining("publicar") });
  });

  it("publicar no se hace arrastrando", () => {
    expect(evaluateDrop({ perms: admin, post: post({ status: "scheduled" }), target: "published" }).ok).toBe(
      false,
    );
  });
});

describe("reordenar dentro de una columna", () => {
  const cards = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("mover al principio renumera todo", () => {
    expect(reorder(cards, "c", 0)).toEqual([
      { id: "c", position: 10 },
      { id: "a", position: 20 },
      { id: "b", position: 30 },
    ]);
  });

  it("mover al final tambien", () => {
    expect(reorder(cards, "a", 2).map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("un indice fuera de rango se acomoda en vez de romper", () => {
    expect(reorder(cards, "a", 99).map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(reorder(cards, "c", -5).map((c) => c.id)).toEqual(["c", "a", "b"]);
  });

  it("las posiciones nunca se repiten", () => {
    // Con posiciones intercaladas, despues de varias movidas dos tarjetas
    // terminan con el mismo numero y el orden se vuelve impredecible.
    const result = reorder(cards, "b", 0);
    expect(new Set(result.map((c) => c.position)).size).toBe(3);
  });

  it("una tarjeta que no esta igual devuelve un orden valido", () => {
    expect(reorder(cards, "no-existe", 0)).toHaveLength(3);
  });
});

describe("el chip de redistribucion", () => {
  it("avisa que red queda programada despues de publicar", () => {
    const chip = redistributionChip([
      { platform: "instagram", at: "2026-09-20T15:00:00Z", status: "published" },
      { platform: "youtube", at: "2026-10-03T15:00:00Z", status: "scheduled", redistribution: true },
    ]);

    expect(chip).toContain("youtube");
    expect(chip).toContain("↻");
  });

  it("sin redistribucion pendiente no hay chip", () => {
    expect(
      redistributionChip([{ platform: "instagram", at: "2026-09-20T15:00:00Z", status: "published" }]),
    ).toBeNull();
  });

  it("con varias, se resume", () => {
    const chip = redistributionChip([
      { platform: "youtube", at: "2026-10-03T15:00:00Z", status: "scheduled", redistribution: true },
      { platform: "linkedin", at: "2026-10-04T15:00:00Z", status: "scheduled", redistribution: true },
    ]);

    expect(chip).toContain("2 redes");
  });
});
