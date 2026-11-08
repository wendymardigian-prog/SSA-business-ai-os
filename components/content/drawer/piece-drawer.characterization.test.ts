/**
 * Caracterización del drawer de la pieza ANTES de sumarle lo del Diseñador IA (DS8, F62 y F65).
 *
 * Fija lo que se ve y lo que llama hoy: el orden de las secciones, la franja de clasificación, la sección «Archivos de la
 * pieza» con la biblioteca, los permisos que ocultan cosas y lo que le pasa a `MediaUploader`. Una pieza SIN diseño
 * tiene que verse exactamente igual después del cambio: sus aserciones no se tocan.
 *
 * Se renderiza en el servidor (sin navegador), como `format-files.test.ts`.
 */

import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PieceData } from "@/lib/content/load-piece";
import type { MediaEntry } from "@/lib/content/media";

const uploaderProps: Array<Record<string, unknown>> = [];

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/actions/content", () => ({ savePostDraft: async () => ({ ok: true }), movePostToColumn: async () => ({ ok: true }) }));
vi.mock("@/lib/actions/copywriter", () => ({ requestCopy: async () => ({ ok: true }) }));
vi.mock("@/lib/actions/content-schedule", () => ({
  markNetworkPublished: async () => ({ ok: true }),
  markPiecePublished: async () => ({ ok: true }),
  scheduleNetworks: async () => ({ ok: true }),
  setNetworkPublishMode: async () => ({ ok: true }),
  unmarkNetworkPublished: async () => ({ ok: true }),
  unscheduleNetwork: async () => ({ ok: true }),
}));
vi.mock("@/lib/actions/content-review", () => ({
  approvePost: async () => ({ ok: true }),
  archivePost: async () => ({ ok: true }),
  requestReview: async () => ({ ok: true }),
  retryFailedNetworks: async () => ({ ok: true }),
  returnPost: async () => ({ ok: true }),
}));
vi.mock("@/lib/actions/content-media", () => ({
  attachMedia: async () => ({ ok: true }),
  removeMedia: async () => ({ ok: true, data: { removedFrom: [] } }),
  requestMediaUpload: async () => ({ ok: false, error: "no" }),
}));
vi.mock("@/lib/actions/content-ad-link", () => ({
  linkAdToPiece: async () => ({ ok: true }),
  searchAdsForPiece: async () => ({ ok: true, data: [] }),
  unlinkAdFromPiece: async () => ({ ok: true }),
  loadPieceAdsSummary: async () => ({ ok: true }),
}));
vi.mock("@/lib/actions/piece-link-destinations", () => ({ loadPieceLinkDestinations: async () => ({ ok: true, data: [] }) }));
// Lo que el drawer le pasa a la biblioteca de archivos, tal cual (el dibujo de la biblioteca lo fija format-files.test.ts).
vi.mock("../media-uploader", () => ({
  MediaUploader: (props: Record<string, unknown>) => {
    uploaderProps.push(props);
    return createElement("div", { "data-testid": "media-uploader" }, "BIBLIOTECA");
  },
}));

const { PieceDrawer } = await import("./piece-drawer");

const img = (id: string, name: string): MediaEntry => ({
  id,
  name,
  storage_path: `ws/post/${id}.jpg`,
  mime_type: "image/jpeg",
  kind: "image",
  size_bytes: 2 * 1024 * 1024,
  width: 1080,
  height: 1350,
});

function data(over: Partial<PieceData> = {}, post: Partial<PieceData["post"]> = {}): PieceData {
  return {
    post: {
      id: "post-1",
      title: "Una pieza de prueba",
      format: "Carrusel",
      idea: null,
      copyStatus: "idle",
      script: "Gancho\n\nDesarrollo\n\nCierre",
      recordingNotes: null,
      pillarId: null,
      offerId: null,
      funnelStage: null,
      reference: null,
      assignedTo: null,
      attributionCode: null,
      authorship: "Ana Pérez · creada el 3 oct",
      caption: "Un caption",
      networks: [{ platform: "instagram", planned_at: null, format: "carousel", files: ["i1", "i2"] }],
      media: [img("i1", "uno.jpg"), img("i2", "dos.jpg")],
      status: "draft",
      aiUnreviewed: false,
      reviewNote: null,
      updatedAt: "2026-10-02T15:00:00Z",
      ...post,
    },
    perms: { create: true, approve: false, publish: false, ai: false, isAuthor: true },
    canEdit: true,
    canAssign: true,
    team: [{ id: "u1", name: "Ana Pérez" }],
    publications: [],
    connected: ["instagram"],
    automations: [],
    channelIdByPlatform: { instagram: "ch-1" },
    publishersByPlatform: { instagram: ["zernio"] },
    defaultPublisherByPlatform: { instagram: "zernio" },
    accounts: [],
    versions: [],
    authorNames: { u1: "Ana Pérez" },
    aiAvailable: false,
    timeZone: "America/Argentina/Buenos_Aires",
    taxonomy: { pillars: [], offers: [], canCreate: false },
    measurement: null,
    ads: [],
    canLinkAds: false,
    ...over,
  } as PieceData;
}

const render = (d: PieceData) => {
  uploaderProps.length = 0;
  return renderToStaticMarkup(createElement(PieceDrawer, { data: d, returnFocus: { current: null }, onClose: () => undefined }));
};

describe("el drawer de la pieza, como está hoy (antes de DS8)", () => {
  it("es el drawer de 900 px de una pieza, con su título editable y el pie fijo", () => {
    const html = render(data());

    expect(html).toContain('data-drawer="piece"');
    expect(html).toContain('aria-label="Título interno"');
    expect(html).toContain('value="Una pieza de prueba"');
    expect(html).toContain("sm:w-[900px]");
    expect(html).toContain("<footer");
  });

  it("las secciones salen en este orden: clasificación, guion, caption, archivos, fecha, redes", () => {
    const html = render(data());
    const order = ['aria-label="Clasificación"', 'aria-label="Guion y caption"', 'aria-label="Caption base"', 'aria-labelledby="archivos"', 'aria-label="Fecha de publicación de la pieza"', 'aria-labelledby="redes"'];
    const positions = order.map((marker) => html.indexOf(marker));

    for (const p of positions) expect(p).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("«Archivos de la pieza» explica que se suben una vez y monta la biblioteca", () => {
    const html = render(data());

    expect(html).toContain("Archivos de la pieza");
    expect(html).toContain("Se suben una vez. Después cada red elige cuáles publica y en qué orden.");
    expect(html).toContain('data-testid="media-uploader"');
    // Sin un diseño vinculado no aparece nada del Diseñador IA.
    expect(html).not.toContain("Diseñador IA");
    expect(html).not.toContain("Del diseño");
    expect(html).not.toContain("El diseño cambió");
  });

  it("le pasa a la biblioteca: la pieza, sus archivos vivos, qué red usa cada uno y si se puede editar", () => {
    render(data());

    expect(uploaderProps).toHaveLength(1);
    const props = uploaderProps[0] as { postId: string; media: MediaEntry[]; usage: Record<string, string[]>; canEdit: boolean; onRemoved: unknown };
    expect(props.postId).toBe("post-1");
    expect(props.media.map((m) => m.id)).toEqual(["i1", "i2"]);
    expect(props.usage).toEqual({ i1: ["instagram"], i2: ["instagram"] });
    expect(props.canEdit).toBe(true);
    expect(typeof props.onRemoved).toBe("function");
  });

  it("un archivo borrado de la biblioteca no se le pasa a la biblioteca", () => {
    render(data({}, { media: [img("i1", "uno.jpg"), { ...img("i2", "dos.jpg"), deleted_at: "2026-10-01T00:00:00Z" }] }));

    expect((uploaderProps[0] as { media: MediaEntry[] }).media.map((m) => m.id)).toEqual(["i1"]);
  });

  it("sin permiso de escritura la biblioteca llega en solo lectura y el drawer avisa", () => {
    const html = render(data({ canEdit: false }));

    expect((uploaderProps[0] as { canEdit: boolean }).canEdit).toBe(false);
    expect(html).toContain("Solo podés mirarla: esta pieza la edita quien la creó o un administrador.");
    expect(html).not.toContain("Agregar una red:");
  });

  it("mientras el copywriter escribe nada se edita y no se muestra el guion", () => {
    const html = render(data({}, { copyStatus: "generating" }));

    expect((uploaderProps[0] as { canEdit: boolean }).canEdit).toBe(false);
    expect(html).toContain("El copywriter está escribiendo el guion y los captions a partir de la idea");
  });

  it("muestra el guion, el caption base y una tarjeta por red", () => {
    const html = render(data());

    expect(html).toContain("Guion");
    expect(html).toContain("Caption base");
    expect(html).toContain("Publicación por red");
    expect(html).toContain("Instagram");
    // Las redes que faltan se ofrecen para agregar.
    expect(html).toContain("Agregar una red:");
    expect(html).toContain("TikTok");
  });

  it("el pie resume las redes y no ofrece Programar a quien no publica", () => {
    const html = render(data());

    expect(html).toContain("0 programadas · 0 tentativas · 0 publicadas");
    expect(html).not.toContain("Publicar ahora");
  });

  it("sin redes conectadas explica cómo planificar igual", () => {
    const html = render(data({ connected: [] }));

    expect(html).toContain("Todavía no hay ninguna red conectada.");
  });
});
