import { describe, expect, it } from "vitest";
import { designPlatformChoices, networkLabel, pieceChoices, pieceSummary, type PieceRow } from "./content-pieces";
import type { NetworkEntry } from "@/lib/content/redistribution";

const row = (over: Partial<PieceRow> = {}): PieceRow => ({
  id: "p1",
  title: "Una pieza",
  status: "draft",
  networks: [{ platform: "instagram", planned_at: null, format: "carousel" }],
  media: [],
  created_by: "ana",
  assigned_to: null,
  ...over,
});

describe("networkLabel y pieceSummary", () => {
  it("la red con su formato de Contenido, o sola si todavía no tiene", () => {
    expect(networkLabel({ platform: "instagram", format: "carousel" })).toBe("Instagram Carrusel");
    expect(networkLabel({ platform: "linkedin", format: "pdf" })).toBe("LinkedIn Carrusel PDF");
    expect(networkLabel({ platform: "tiktok", format: null })).toBe("TikTok");
    expect(networkLabel({ platform: "threads" })).toBe("Threads");
  });

  it("el resumen dice el estado y las redes, o que no tiene ninguna todavía", () => {
    expect(pieceSummary("draft", [{ platform: "instagram", format: "carousel" }, { platform: "linkedin", format: "pdf" }])).toBe("Borrador · Instagram Carrusel · LinkedIn Carrusel PDF");
    expect(pieceSummary("in_review", [])).toBe("En revision · sin redes todavía");
  });
});

describe("pieceChoices: las piezas que se pueden elegir para vincular", () => {
  it("un administrador ve todas, en el orden en que llegan", () => {
    const out = pieceChoices([row({ id: "a", created_by: "otra" }), row({ id: "b", created_by: "otro" })], { viewer: { id: "ana", role: "admin" } });

    expect(out.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("un Member solo ve las que creó o tiene asignadas (las que no puede escribir no se ofrecen)", () => {
    const out = pieceChoices([row({ id: "mia" }), row({ id: "ajena", created_by: "otra" }), row({ id: "asignada", created_by: "otra", assigned_to: "ana" })], { viewer: { id: "ana", role: "member" } });

    expect(out.map((p) => p.id)).toEqual(["mia", "asignada"]);
  });

  it("lleva el resumen, las redes con su formato y si ya tiene un diseño", () => {
    const [piece] = pieceChoices([row({ networks: [{ platform: "instagram", planned_at: null, format: "carousel" }, { platform: "tiktok", planned_at: null }] })], { viewer: { id: "ana", role: "owner" }, designedPostIds: new Set(["p1"]) });

    expect(piece).toMatchObject({ id: "p1", title: "Una pieza", statusLabel: "Borrador", summary: "Borrador · Instagram Carrusel · TikTok", hasDesign: true });
    expect(piece.networks).toEqual([
      { platform: "instagram", label: "Instagram Carrusel", format: "carousel" },
      { platform: "tiktok", label: "TikTok", format: null },
    ]);
  });

  it("una pieza con archivos de un diseño en su biblioteca cuenta como «ya tiene un diseño»", () => {
    const withFiles = row({ media: [{ id: "x", storage_path: "ws/p/x.png", mime_type: "image/png", kind: "image", size_bytes: 1, design_id: "d1", design_page: 1 }] });
    const [piece] = pieceChoices([withFiles, row({ id: "p2" })], { viewer: { id: "ana", role: "owner" } });

    expect(piece.hasDesign).toBe(true);
    expect(pieceChoices([row()], { viewer: { id: "ana", role: "owner" } })[0].hasDesign).toBe(false);
  });

  it("datos raros no rompen: sin redes ni biblioteca", () => {
    const [piece] = pieceChoices([row({ networks: null, media: "x" })], { viewer: { id: "ana", role: "owner" } });

    expect(piece.networks).toEqual([]);
    expect(piece.summary).toBe("Borrador · sin redes todavía");
  });
});

describe("designPlatformChoices: para qué red diseñar desde la pieza", () => {
  const net = (platform: string, format?: string): NetworkEntry => ({ platform, planned_at: null, format });

  it("las redes de la pieza que se arman con un diseño, con la publicación que ya eligió", () => {
    expect(designPlatformChoices([net("instagram", "carousel"), net("youtube", "video"), net("linkedin", "pdf")])).toEqual([
      { platform: "instagram", label: "Instagram · Carrusel", isNew: false },
      { platform: "linkedin", label: "LinkedIn · Carrusel PDF", isNew: false },
    ]);
  });

  it("una red sin formato de diseño (un Reel) se ofrece igual, por su nombre", () => {
    expect(designPlatformChoices([net("instagram", "reel")])).toEqual([{ platform: "instagram", label: "Instagram", isNew: false }]);
  });

  it("si ninguna de sus redes se arma con un diseño, ofrece sumar las que sí", () => {
    expect(designPlatformChoices([net("youtube", "video")]).map((c) => [c.platform, c.isNew])).toEqual([["instagram", true], ["tiktok", true], ["linkedin", true], ["threads", true]]);
    expect(designPlatformChoices([]).every((c) => c.isNew)).toBe(true);
  });
});
