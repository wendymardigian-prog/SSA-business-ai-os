/**
 * Lo del Diseñador IA en el drawer de la pieza (DS8, F62 y F65): el botón, el grupo «Del diseño…», el aviso «El diseño
 * cambió» y lo que se oculta sin permiso. Una pieza SIN diseño sigue viéndose igual (`piece-drawer.characterization.test.ts`).
 */

import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PieceData } from "@/lib/content/load-piece";
import type { MediaEntry } from "@/lib/content/media";
import type { PieceDesign, PieceDesigner } from "@/lib/designer/content-link-types";

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
vi.mock("@/lib/actions/designer/content", () => ({
  designFromPiece: async () => ({ ok: true, data: { designId: "d9", href: "/dashboard/disenos/d/d9?desde=pieza" } }),
  syncToPiece: async () => ({ ok: true, data: { queued: true } }),
  keepPieceFiles: async () => ({ ok: true, data: undefined }),
}));

const { PieceDrawer } = await import("./piece-drawer");

const page = (n: number, version = 4): MediaEntry => ({
  id: `design-d1-${n}`,
  name: `Carrusel · página ${n}`,
  storage_path: `ws/post/design-d1-${n}.png`,
  mime_type: "image/png",
  kind: "image",
  size_bytes: 1024 * 1024,
  width: 1080,
  height: 1350,
  design_id: "d1",
  design_page: n,
  design_version: version,
});
const manual: MediaEntry = { id: "foto", name: "foto.jpg", storage_path: "ws/post/foto.jpg", mime_type: "image/jpeg", kind: "image", size_bytes: 1024 * 1024, width: 1080, height: 1080 };

const design = (over: Partial<PieceDesign> = {}): PieceDesign => ({ id: "d1", name: "Carrusel de prueba", network: "instagram", rev: 4, linked: true, archived: false, canOpen: true, ...over });
const designer = (over: Partial<PieceDesigner> = {}): PieceDesigner => ({ canDesign: true, canView: true, designs: [], ...over });

function data(over: Partial<PieceData> = {}, networks: PieceData["post"]["networks"] = [{ platform: "instagram", planned_at: null, format: "carousel", files: ["design-d1-1", "design-d1-2"] }]): PieceData {
  return {
    post: {
      id: "post-1",
      title: "Una pieza de prueba",
      format: "Carrusel",
      idea: null,
      copyStatus: "idle",
      script: "Gancho\n\nCierre",
      recordingNotes: null,
      pillarId: null,
      offerId: null,
      funnelStage: null,
      reference: null,
      assignedTo: null,
      attributionCode: null,
      authorship: null,
      caption: "Un caption",
      networks,
      media: [page(1), page(2), manual],
      status: "draft",
      aiUnreviewed: false,
      reviewNote: null,
      updatedAt: "2026-10-02T15:00:00Z",
    },
    perms: { create: true, approve: false, publish: false, ai: false, isAuthor: true },
    canEdit: true,
    canAssign: true,
    team: [],
    publications: [],
    connected: ["instagram"],
    automations: [],
    channelIdByPlatform: { instagram: "ch-1" },
    publishersByPlatform: { instagram: ["zernio"] },
    defaultPublisherByPlatform: { instagram: "zernio" },
    accounts: [],
    versions: [],
    authorNames: {},
    aiAvailable: false,
    timeZone: "America/Argentina/Buenos_Aires",
    taxonomy: { pillars: [], offers: [], canCreate: false },
    measurement: null,
    ads: [],
    canLinkAds: false,
    designer: designer({ designs: [design()] }),
    ...over,
  } as PieceData;
}

const render = (d: PieceData) => renderToStaticMarkup(createElement(PieceDrawer, { data: d, returnFocus: { current: null }, onClose: () => undefined }));

const scheduled = { platform: "instagram", status: "scheduled", scheduledAt: "2026-12-01T10:00:00Z", publishedAt: null, origin: "system", onProvider: false, url: null, lastError: null, lastErrorKind: null, attempts: 0, warning: null, actualVisibility: null } as never;

describe("el grupo «Del diseño …» en la biblioteca (F65)", () => {
  it("los archivos del diseño van juntos bajo su encabezado, con «Abrir el diseño»; los demás, aparte", () => {
    const html = render(data());

    expect(html).toContain("Del diseño Carrusel de prueba · 2 archivos · vinculado");
    expect(html).toContain("Abrir el diseño");
    expect(html).toContain('href="/dashboard/disenos/d/d1?desde=pieza"');
    // El archivo subido a mano sigue en su lista de siempre.
    expect(html).toContain('aria-label="Archivos de la pieza"');
    expect(html.indexOf("Del diseño Carrusel de prueba")).toBeLessThan(html.indexOf('aria-label="Archivos de la pieza"'));
    expect(html).toContain("foto.jpg");
    expect(html).toContain("Carrusel · página 1");
  });

  it("un diseño que ya no está vinculado lo dice", () => {
    const html = render(data({ designer: designer({ designs: [design({ linked: false, network: null })] }) }));

    expect(html).toContain("2 archivos · ya no está vinculado");
  });

  it("sin permiso para ver diseños, el grupo se ve pero sin «Abrir el diseño»", () => {
    const html = render(data({ designer: designer({ canDesign: false, canView: false, designs: [] }) }));

    expect(html).toContain("Del diseño · 2 archivos · ya no está vinculado");
    expect(html).not.toContain("Abrir el diseño");
  });
});

describe("«✦ Diseñar con el Diseñador IA» (F62)", () => {
  it("una pieza sin diseño ofrece diseñar", () => {
    const html = render(data({ designer: designer(), post: { ...data().post, media: [manual] } }));

    expect(html).toContain("✦ Diseñar con el Diseñador IA");
    expect(html).not.toContain("Abrir el diseño");
    expect(html).not.toContain("Diseñar otra versión");
  });

  it("con un diseño vinculado: «Abrir el diseño» y «✦ Diseñar otra versión»", () => {
    const html = render(data());

    expect(html).toContain("✦ Diseñar otra versión");
    expect(html).not.toContain("✦ Diseñar con el Diseñador IA");
  });

  it("con varias redes, pregunta para cuál antes de pedir (no pide solo)", () => {
    const html = render(data({ designer: designer() }, [{ platform: "instagram", planned_at: null, format: "carousel", files: [] }, { platform: "linkedin", planned_at: null, format: "pdf", files: [] }]));

    expect(html).toContain("✦ Diseñar con el Diseñador IA");
    expect(html).toContain('aria-expanded="false"');
  });

  it("CRITERIO: sin permiso de diseñar el botón no está (no se deshabilita)", () => {
    const html = render(data({ designer: designer({ canDesign: false, designs: [design()] }) }));

    expect(html).not.toContain("Diseñar con el Diseñador IA");
    expect(html).not.toContain("Diseñar otra versión");
    // Ver sigue siendo ver.
    expect(html).toContain("Abrir el diseño");
  });

  it("una pieza que la persona no puede escribir no ofrece diseñar (aunque tenga los permisos)", () => {
    const html = render(data({ canEdit: false, designer: designer({ canDesign: false }) }));

    expect(html).not.toContain("✦ Diseñar");
  });

  it("sin el dato del Diseñador IA el drawer se ve como siempre", () => {
    const html = render(data({ designer: undefined, post: { ...data().post, media: [manual] } }));

    expect(html).not.toContain("✦ Diseñar");
    expect(html).not.toContain("Abrir el diseño");
    expect(html).not.toContain("Del diseño");
  });
});

describe("«El diseño cambió» (F64)", () => {
  const changed = (over: Partial<PieceData> = {}) => data({ publications: [scheduled], designer: designer({ designs: [design({ rev: 5 })] }), ...over }, [{ platform: "instagram", planned_at: "2026-12-01T10:00:00Z", format: "carousel", files: ["design-d1-1", "design-d1-2"] }]);

  it("CRITERIO: una pieza programada con el diseño más nuevo avisa, con «Actualizar los archivos» y «Dejar como está»", () => {
    const html = render(changed());

    expect(html).toContain("El diseño cambió");
    expect(html).toContain("La pieza está programada: los archivos no se cambiaron solos.");
    expect(html).toContain("Actualizar los archivos");
    expect(html).toContain("Dejar como está");
    // Va ARRIBA de Archivos.
    expect(html.indexOf("El diseño cambió")).toBeLessThan(html.indexOf('aria-labelledby="archivos"'));
  });

  it("sin permiso para actuar (designer.edit + content.create y escribir la pieza), el aviso se ve SIN botones (auditoría Ola 3)", () => {
    const html = render(changed({ designer: designer({ canDesign: false, designs: [design({ rev: 5 })] }) }));
    expect(html).toContain("El diseño cambió");
    expect(html).not.toContain("Actualizar los archivos");
    expect(html).not.toContain("Dejar como está");
  });

  it("no avisa si los archivos son de la versión actual del diseño", () => {
    const html = render(changed({ designer: designer({ designs: [design({ rev: 4 })] }) }));

    expect(html).not.toContain("El diseño cambió");
  });

  it("una pieza en borrador no avisa: se actualiza sola, y lo dice", () => {
    const html = render(data({ designer: designer({ designs: [design({ rev: 5 })] }) }));

    expect(html).not.toContain("El diseño cambió");
    expect(html).toContain("Actualizando los archivos con la versión nueva del diseño…");
  });

  it("una red publicada nunca avisa ni dice que se actualiza", () => {
    const published = { ...(scheduled as object), status: "published", publishedAt: "2026-11-09T00:00:00Z" } as never;
    const html = render(changed({ publications: [published] }));

    expect(html).not.toContain("El diseño cambió");
    expect(html).not.toContain("Actualizando los archivos");
  });

  it("un diseño recién vinculado dice que se están preparando los archivos", () => {
    const html = render(data({ designer: designer({ designs: [design({ id: "nuevo" })] }), post: { ...data().post, media: [manual] } }));

    expect(html).toContain("Preparando los archivos del diseño…");
  });
});
