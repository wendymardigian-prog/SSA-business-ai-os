import { describe, expect, it } from "vitest";
import type { MediaEntry } from "./media";
import type { NetworkEntry } from "./redistribution";
import type { PieceDesign, PieceDesigner } from "@/lib/designer/content-link-types";
import { designGroups } from "@/lib/designer/content-sync";
import {
  DESIGN_BUTTON_TEXT,
  designChangedNotices,
  designGroupViews,
  designerActions,
  hasPendingSync,
  mergeSyncedFiles,
  openDesignHref,
  preparingDesigns,
  showsDesignerSection,
  singleDesignPlatform,
} from "./piece-designs";

const file = (id: string, extra: Partial<MediaEntry> = {}): MediaEntry => ({ id, storage_path: `ws/post/${id}.png`, mime_type: "image/png", kind: "image", size_bytes: 10, ...extra });
const page = (designId: string, n: number, version = 4): MediaEntry => file(`design-${designId}-${n}`, { design_id: designId, design_page: n, design_version: version });

const design = (over: Partial<PieceDesign> = {}): PieceDesign => ({ id: "d1", name: "Carrusel de prueba", network: "instagram", rev: 4, linked: true, archived: false, canOpen: true, ...over });
const designer = (over: Partial<PieceDesigner> = {}): PieceDesigner => ({ canDesign: true, canView: true, designs: [], ...over });
const net = (platform: string, format?: string): NetworkEntry => ({ platform, planned_at: null, format });

describe("designGroups agrupa por design_id (F65)", () => {
  it("CRITERIO: los archivos de un diseño van juntos, los subidos a mano quedan afuera", () => {
    const groups = designGroups([file("foto"), page("d1", 2), page("d1", 1), page("d2", 1)]);

    expect(groups.map((g) => [g.designId, g.entries.map((e) => e.id)])).toEqual([
      ["d1", ["design-d1-1", "design-d1-2"]],
      ["d2", ["design-d2-1"]],
    ]);
  });
});

describe("designGroupViews: «Del diseño … · N archivos · vinculado»", () => {
  const media = [file("manual"), page("d1", 1), page("d1", 2), page("d1", 3)];

  it("el encabezado dice el nombre, cuántos archivos y que sigue vinculado", () => {
    const [view] = designGroupViews({ media, designs: [design()], networkStates: { instagram: "tent" }, canView: true });

    expect(view.heading).toBe("Del diseño Carrusel de prueba · 3 archivos · vinculado");
    expect(view.openHref).toBe("/dashboard/disenos/d/d1?desde=pieza");
    expect(view.entries.map((e) => e.id)).toEqual(["design-d1-1", "design-d1-2", "design-d1-3"]);
  });

  it("un archivo se dice en singular", () => {
    const [view] = designGroupViews({ media: [page("d1", 1)], designs: [design()], networkStates: {}, canView: true });

    expect(view.heading).toBe("Del diseño Carrusel de prueba · 1 archivo · vinculado");
  });

  it("un diseño desvinculado lo dice y no queda nada pendiente", () => {
    const [view] = designGroupViews({ media, designs: [design({ linked: false, network: null, rev: 9 })], networkStates: {}, canView: true });

    expect(view.heading).toContain("ya no está vinculado");
    expect(view.status).toBe("synced");
  });

  it("sin permiso para ver diseños no se ofrece «Abrir el diseño» ni se conoce el nombre", () => {
    const [view] = designGroupViews({ media, designs: [], networkStates: {}, canView: false });

    expect(view.heading).toBe("Del diseño · 3 archivos · ya no está vinculado");
    expect(view.openHref).toBeNull();
    expect(designGroupViews({ media, designs: [design()], networkStates: {}, canView: false })[0].openHref).toBeNull();
    expect(designGroupViews({ media, designs: [design({ canOpen: false })], networkStates: {}, canView: true })[0].openHref).toBeNull();
  });

  it("con los archivos al día no hay nada pendiente; si el diseño cambió, depende del estado de la red", () => {
    const view = (rev: number, state: "tent" | "sched" | "pub" | "fail") => designGroupViews({ media, designs: [design({ rev })], networkStates: { instagram: state }, canView: true })[0].status;

    expect(view(4, "sched")).toBe("synced");
    expect(view(5, "tent")).toBe("pending");
    expect(view(5, "sched")).toBe("changed");
    expect(view(5, "fail")).toBe("changed");
    expect(view(5, "pub")).toBe("synced");
  });

  it("sin archivos de diseño, no hay grupos (la pieza se ve como siempre)", () => {
    expect(designGroupViews({ media: [file("a"), file("b")], designs: [design()], networkStates: {}, canView: true })).toEqual([]);
  });
});

describe("«El diseño cambió»: el aviso de arriba de Archivos (F64)", () => {
  const media = [page("d1", 1), page("d1", 2)];

  it("aparece con una red programada y el diseño más nuevo, con los dos botones del prototipo", () => {
    const views = designGroupViews({ media, designs: [design({ rev: 5 })], networkStates: { instagram: "sched" }, canView: true });

    expect(designChangedNotices(views)).toEqual([
      { designId: "d1", name: "Carrusel de prueba", title: "El diseño cambió", body: "La pieza está programada: los archivos no se cambiaron solos.", update: "Actualizar los archivos", keep: "Dejar como está" },
    ]);
  });

  it("con la publicación fallida avisa de la red", () => {
    const views = designGroupViews({ media, designs: [design({ rev: 5 })], networkStates: { instagram: "fail" }, canView: true });

    expect(designChangedNotices(views)[0].body).toBe("La publicación en Instagram falló: los archivos no se cambiaron solos.");
  });

  it("no aparece si la pieza está en borrador, está publicada o los archivos están al día", () => {
    for (const [rev, state] of [[5, "tent"], [5, "pub"], [4, "sched"]] as const) {
      expect(designChangedNotices(designGroupViews({ media, designs: [design({ rev })], networkStates: { instagram: state }, canView: true }))).toEqual([]);
    }
  });

  it("«Dejar como está» lo apaga: los archivos pasan a ser de la versión actual", () => {
    const kept = [page("d1", 1, 5), page("d1", 2, 5)];

    expect(designChangedNotices(designGroupViews({ media: kept, designs: [design({ rev: 5 })], networkStates: { instagram: "sched" }, canView: true }))).toEqual([]);
  });
});

describe("lo que todavía se está preparando", () => {
  it("un diseño recién vinculado sin archivos todavía", () => {
    expect(preparingDesigns({ media: [], designs: [design()] }).map((d) => d.id)).toEqual(["d1"]);
    expect(preparingDesigns({ media: [page("d1", 1)], designs: [design()] })).toEqual([]);
    expect(preparingDesigns({ media: [], designs: [design({ linked: false }), design({ id: "d2", archived: true })] })).toEqual([]);
  });

  it("el drawer sigue preguntando solo si hay algo que el servidor va a actualizar solo", () => {
    const pending = designGroupViews({ media: [page("d1", 1)], designs: [design({ rev: 5 })], networkStates: { instagram: "tent" }, canView: true });
    const changed = designGroupViews({ media: [page("d1", 1)], designs: [design({ rev: 5 })], networkStates: { instagram: "sched" }, canView: true });

    expect(hasPendingSync(pending, [])).toBe(true);
    expect(hasPendingSync(changed, [])).toBe(false);
    expect(hasPendingSync([], [design()])).toBe(true);
    expect(hasPendingSync([], [])).toBe(false);
  });
});

describe("los botones del Diseñador IA en Archivos (F62)", () => {
  it("CRITERIO: sin permiso se ocultan (no se deshabilitan)", () => {
    expect(designerActions({ designer: undefined, networks: [net("instagram", "carousel")] })).toEqual({ design: null, open: [] });
    expect(designerActions({ designer: designer({ canDesign: false, canView: false }), networks: [net("instagram")] })).toEqual({ design: null, open: [] });
  });

  it("con permiso y sin diseño: «✦ Diseñar con el Diseñador IA» con las redes de la pieza", () => {
    const out = designerActions({ designer: designer(), networks: [net("instagram", "carousel"), net("linkedin", "pdf")] });

    expect(out.design?.label).toBe("✦ Diseñar con el Diseñador IA");
    expect(out.design?.choices.map((c) => c.platform)).toEqual(["instagram", "linkedin"]);
    expect(out.open).toEqual([]);
  });

  it("con un diseño vinculado: «Abrir el diseño» y «✦ Diseñar otra versión»", () => {
    const out = designerActions({ designer: designer({ designs: [design()] }), networks: [net("instagram", "carousel")] });

    expect(out.design?.label).toBe("✦ Diseñar otra versión");
    expect(out.design?.preferred).toEqual(["instagram"]);
    expect(out.open).toEqual([{ designId: "d1", name: "Carrusel de prueba", href: openDesignHref("d1") }]);
  });

  it("quien puede ver pero no diseñar solo ve «Abrir el diseño»; quien puede diseñar pero no ver, solo el botón de diseñar", () => {
    const viewOnly = designerActions({ designer: designer({ canDesign: false, designs: [design()] }), networks: [net("instagram")] });
    const designOnly = designerActions({ designer: designer({ canView: false, designs: [design()] }), networks: [net("instagram")] });

    expect(viewOnly.design).toBeNull();
    expect(viewOnly.open).toHaveLength(1);
    expect(designOnly.design?.label).toBe("✦ Diseñar otra versión");
    expect(designOnly.open).toEqual([]);
  });

  it("un diseño desvinculado o archivado no cuenta como vinculado", () => {
    const out = designerActions({ designer: designer({ designs: [design({ linked: false }), design({ id: "d2", archived: true })] }), networks: [net("instagram")] });

    expect(out.design?.label).toBe("✦ Diseñar con el Diseñador IA");
    expect(out.open).toEqual([]);
  });

  it("con una sola red de la pieza se pide directo; con varias, o ninguna, se pregunta «¿Para qué red?»", () => {
    const one = designerActions({ designer: designer(), networks: [net("instagram", "carousel")] }).design!;
    const many = designerActions({ designer: designer(), networks: [net("instagram"), net("linkedin")] }).design!;
    const none = designerActions({ designer: designer(), networks: [] }).design!;

    expect(singleDesignPlatform(one)).toBe("instagram");
    expect(singleDesignPlatform(many)).toBeNull();
    expect(singleDesignPlatform(none)).toBeNull();
    expect(DESIGN_BUTTON_TEXT.chooseNetwork).toBe("¿Para qué red?");
  });

  it("la sección solo se dibuja si hay algo para mostrar", () => {
    const empty = designerActions({ designer: undefined, networks: [] });

    expect(showsDesignerSection(empty, [], [])).toBe(false);
    expect(showsDesignerSection(designerActions({ designer: designer(), networks: [] }), [], [])).toBe(true);
    expect(showsDesignerSection(empty, designGroupViews({ media: [page("d1", 1)], designs: [], networkStates: {}, canView: false }), [])).toBe(true);
    expect(showsDesignerSection(empty, [], [design()])).toBe(true);
  });
});

describe("mergeSyncedFiles: la sincronización llega mientras la persona escribe", () => {
  const withFiles = (platform: string, files: string[], extra: Partial<NetworkEntry> = {}): NetworkEntry => ({ platform, planned_at: null, format: "carousel", files, ...extra });

  it("CRITERIO: si la persona no tocó los archivos, el borrador toma los que puso la sincronización y conserva lo que escribió", () => {
    const draft = [withFiles("instagram", [], { caption: "Lo que estoy escribiendo" })];
    const out = mergeSyncedFiles(draft, [withFiles("instagram", [])], [withFiles("instagram", ["design-d1-1", "design-d1-2"])]);

    expect(out[0]).toMatchObject({ caption: "Lo que estoy escribiendo", files: ["design-d1-1", "design-d1-2"] });
  });

  it("si la persona SÍ cambió los archivos de esa red, gana lo suyo", () => {
    const draft = [withFiles("instagram", ["foto"])];
    const out = mergeSyncedFiles(draft, [withFiles("instagram", [])], [withFiles("instagram", ["design-d1-1"])]);

    expect(out[0].files).toEqual(["foto"]);
  });

  it("si la sincronización no cambió los archivos, no se toca nada (el mismo borrador)", () => {
    const draft = [withFiles("instagram", ["a", "b"])];

    expect(mergeSyncedFiles(draft, [withFiles("instagram", ["a", "b"])], [withFiles("instagram", ["a", "b"], { caption: "otra" })])).toEqual(draft);
  });

  it("solo cambia las redes que la sincronización tocó; las demás quedan igual", () => {
    const draft = [withFiles("instagram", []), withFiles("linkedin", ["x"], { format: "pdf" })];
    const out = mergeSyncedFiles(draft, [withFiles("instagram", []), withFiles("linkedin", ["x"])], [withFiles("instagram", ["design-d1-1"]), withFiles("linkedin", ["x"])]);

    expect(out.map((n) => n.files)).toEqual([["design-d1-1"], ["x"]]);
  });

  it("una red que la persona agregó o que el servidor no tiene se deja como está", () => {
    const draft = [withFiles("tiktok", [])];

    expect(mergeSyncedFiles(draft, [], [withFiles("tiktok", ["design-d1-1"])])).toEqual(draft);
    expect(mergeSyncedFiles(draft, [withFiles("tiktok", [])], [])).toEqual(draft);
  });

  it("no muta lo que recibe", () => {
    const draft = [withFiles("instagram", [])];
    const copy = JSON.parse(JSON.stringify(draft));
    mergeSyncedFiles(draft, [withFiles("instagram", [])], [withFiles("instagram", ["design-d1-1"])]);

    expect(draft).toEqual(copy);
  });
});
