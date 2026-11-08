import { describe, expect, it } from "vitest";
import {
  archiveDecision,
  canDelete,
  configSections,
  deleteBlockers,
  FIT_OPTIONS,
  formatChangeOutcome,
  GENERATION_NOT_ARCHIVABLE,
  SECTION_TITLES,
  showsVerification,
  type DeleteInput,
} from "./config";

const del = (patch: Partial<DeleteInput> = {}): DeleteInput => ({ kind: "design", isGeneration: false, published: false, everPublished: false, generationsCount: 0, linkedToContent: false, canManage: true, ...patch });

describe("drawer de Configuración (F28)", () => {
  it("un diseño: formato, marca, versiones y más", () => {
    expect(configSections({ kind: "design", isGeneration: false, hasBackgroundImage: false })).toEqual(["format", "brand", "versions", "more"]);
  });

  it("la imagen de fondo aparece solo si el diseño tiene una", () => {
    expect(configSections({ kind: "design", isGeneration: false, hasBackgroundImage: true })).toContain("fit");
    expect(configSections({ kind: "design", isGeneration: false, hasBackgroundImage: false })).not.toContain("fit");
  });

  it("una plantilla suma fechas, «Al generar» y «Dónde se usa»", () => {
    expect(configSections({ kind: "template", isGeneration: false, hasBackgroundImage: true })).toEqual(["format", "fit", "brand", "dates", "generate", "uses", "versions", "more"]);
  });

  it("una generación suma «Origen»", () => {
    const sections = configSections({ kind: "design", isGeneration: true, hasBackgroundImage: false });
    expect(sections).toContain("origin");
    expect(sections).not.toContain("uses");
  });

  it("cada sección tiene su título en español", () => {
    for (const id of configSections({ kind: "template", isGeneration: true, hasBackgroundImage: true })) expect(SECTION_TITLES[id]).toBeTruthy();
    expect(FIT_OPTIONS.map((o) => o.label)).toEqual(["Cubrir toda la página", "Ajustar sin recortar"]);
  });
});

describe("archivar (F28)", () => {
  it("archivar un diseño PUBLICADO pide confirmación, y confirmado lo despublica", () => {
    const input = { kind: "design" as const, published: true, isGeneration: false, archived: false };
    expect(archiveDecision(input, false)).toMatchObject({ action: "confirm" });
    expect(archiveDecision(input, true)).toEqual({ action: "archive", unpublish: true });
  });

  it("un borrador o una plantilla se archivan directo", () => {
    expect(archiveDecision({ kind: "design", published: false, isGeneration: false, archived: false }, false)).toEqual({ action: "archive", unpublish: false });
    expect(archiveDecision({ kind: "template", published: false, isGeneration: false, archived: false }, false)).toEqual({ action: "archive", unpublish: false });
  });

  it("una pieza emitida no se archiva, y uno ya archivado ya está", () => {
    expect(archiveDecision({ kind: "design", published: true, isGeneration: true, archived: false }, true)).toEqual({ action: "blocked", reason: GENERATION_NOT_ARCHIVABLE });
    expect(archiveDecision({ kind: "design", published: false, isGeneration: false, archived: true }, false)).toEqual({ action: "already" });
  });
});

describe("borrar definitivamente (F28)", () => {
  it("solo un borrador sin uso y con designer.manage", () => {
    expect(deleteBlockers(del())).toEqual([]);
    expect(canDelete(del())).toBe(true);
  });

  it("uno con generaciones se RECHAZA", () => {
    const reasons = deleteBlockers(del({ kind: "template", generationsCount: 3 }));
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("3 piezas generadas");
    expect(deleteBlockers(del({ kind: "template", generationsCount: 1 }))[0]).toContain("1 pieza generada");
    expect(canDelete(del({ generationsCount: 1 }))).toBe(false);
  });

  it("publicado, publicado alguna vez, vinculado a Contenido o una pieza emitida: no", () => {
    expect(canDelete(del({ published: true }))).toBe(false);
    expect(canDelete(del({ everPublished: true }))).toBe(false);
    expect(canDelete(del({ linkedToContent: true }))).toBe(false);
    expect(canDelete(del({ isGeneration: true }))).toBe(false);
  });

  it("sin designer.manage no se borra", () => {
    expect(canDelete(del({ canManage: false }))).toBe(false);
    expect(deleteBlockers(del({ canManage: false }))[0]).toContain("administra");
  });

  it("junta todos los motivos", () => {
    expect(deleteBlockers(del({ published: true, generationsCount: 2, linkedToContent: true, canManage: false })).length).toBe(4);
  });
});

describe("verificación y formato (F28)", () => {
  it("al pasar a un formato no impreso, se apaga sola con el aviso", () => {
    expect(formatChangeOutcome({ verify: true }, "sq")).toEqual({ verify: false, notice: "Este formato no admite verificación" });
    expect(formatChangeOutcome({ verify: true }, "a4_v")).toEqual({ verify: true, notice: null });
    expect(formatChangeOutcome({ verify: false }, "sq")).toEqual({ verify: false, notice: null });
  });

  it("el interruptor y el selector de tipo solo se muestran en formatos impresos", () => {
    for (const format of ["carta_v", "carta_h", "a4_v", "a4_h"] as const) expect(showsVerification(format)).toBe(true);
    for (const format of ["sq", "v45", "story", "wide", "web"] as const) expect(showsVerification(format)).toBe(false);
  });
});
