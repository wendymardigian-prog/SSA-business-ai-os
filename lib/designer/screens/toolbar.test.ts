import { describe, expect, it } from "vitest";
import { CONTENT_FORMATS, editorActions, formatChoices, type EditorCan, type EditorDesign } from "./toolbar";

const ALL: EditorCan = { view: true, edit: true, publish: true, generate: true, manage: true, automate: true };
const MEMBER: EditorCan = { view: true, edit: true, publish: false, generate: false, manage: false };
const VIEWER: EditorCan = { view: true, edit: false, publish: false, generate: false, manage: false };

const design = (patch: Partial<EditorDesign> = {}): EditorDesign => ({
  kind: "design",
  format: "v45",
  origin: "ai",
  published: false,
  isGeneration: false,
  status: "draft",
  archived: false,
  verify: false,
  docType: null,
  docTypeLabel: null,
  generationsCount: 0,
  linkedToContent: false,
  ...patch,
});
const template = (patch: Partial<EditorDesign> = {}): EditorDesign => design({ kind: "template", format: "carta_h", ...patch });

describe("barra superior del editor (F17)", () => {
  it("un diseño de redes: Usar en contenido, Exportar y Publicar", () => {
    const a = editorActions(design(), ALL);
    expect(a.useInContent).toEqual({ visible: true, label: "Usar en contenido" });
    expect(a.exportMenu).toMatchObject({ visible: true, label: "Exportar ▾", enabled: true });
    expect(a.publish).toEqual({ visible: true, label: "Publicar", published: false });
    expect(a.tabs).toBeNull();
    expect(a.back).toEqual({ label: "Diseños", href: "/dashboard/disenos" });
    expect(a.automate.visible).toBe(false);
    expect(a.primary.visible).toBe(false);
  });

  it("publicado y vinculado cambian los rótulos", () => {
    const a = editorActions(design({ published: true, linkedToContent: true }), ALL);
    expect(a.publish.label).toBe("● Publicado ▾");
    expect(a.useInContent.label).toBe("En contenido ▾");
    expect(a.status).toEqual({ label: "Publicado", tone: "ok" });
  });

  it("lo que el permiso no da se OCULTA, no se deshabilita", () => {
    const member = editorActions(design(), MEMBER);
    expect(member.publish.visible).toBe(false);
    expect(member.exportMenu.visible).toBe(true);
    expect(member.useInContent.visible).toBe(true);
    const viewer = editorActions(design(), VIEWER);
    expect(viewer.exportMenu.visible).toBe(false);
    expect(viewer.useInContent.visible).toBe(false);
    expect(viewer.publish.visible).toBe(false);
    expect(viewer.config.visible).toBe(true);
    expect(viewer.format.mode).toBe("fixed");
  });

  it("«Usar en contenido» solo para formatos de redes (no una página web, ni certificados)", () => {
    expect(CONTENT_FORMATS).toContain("v45");
    expect(editorActions(design({ format: "web" }), ALL).useInContent.visible).toBe(false);
    expect(editorActions(design({ format: "carta_h" }), ALL).useInContent.visible).toBe(false);
    expect(editorActions(design({ format: "story" }), ALL).useInContent.visible).toBe(true);
    // Ni las generaciones ni las plantillas.
    expect(editorActions(design({ isGeneration: true }), ALL).useInContent.visible).toBe(false);
    expect(editorActions(template({ format: "sq" }), ALL).useInContent.visible).toBe(false);
  });

  it("una página web no se exporta: el botón está deshabilitado con el motivo", () => {
    const a = editorActions(design({ format: "web" }), ALL);
    expect(a.exportMenu.enabled).toBe(false);
    expect(a.exportMenu.disabledReason).toContain("no se exporta");
    expect(editorActions(design({ format: "v45" }), ALL).exportMenu.disabledReason).toBeNull();
  });

  it("un diseño cargado de HTML lleva la etiqueta fija «… · del archivo»", () => {
    const a = editorActions(design({ origin: "html", format: "wide" }), ALL);
    expect(a.format).toEqual({ mode: "fixed", label: "Presentación 16:9 · del archivo", options: [] });
  });

  it("el formato es un desplegable con quien edita, y una página web siempre es fija", () => {
    const a = editorActions(design(), ALL);
    expect(a.format.mode).toBe("select");
    expect(a.format.options).not.toContain("web");
    expect(a.format.options).toContain("story");
    expect(editorActions(design({ format: "web" }), ALL).format.mode).toBe("fixed");
    expect(formatChoices("web")).toEqual(["web"]);
    expect(formatChoices("sq")).not.toContain("web");
  });

  it("una plantilla: pestañas con el contador, Exportar prueba, Automatizar y Generar para…", () => {
    const a = editorActions(template({ generationsCount: 23 }), ALL);
    expect(a.tabs).toEqual([
      { id: "diseno", label: "Diseño" },
      { id: "generaciones", label: "Generaciones (23)" },
    ]);
    expect(a.exportMenu.label).toBe("Exportar prueba ▾");
    expect(a.automate.visible).toBe(true);
    expect(a.primary).toEqual({ visible: true, label: "Generar para…" });
    expect(a.generateMany.visible).toBe(true);
    expect(a.publish.visible).toBe(false);
    expect(a.back).toEqual({ label: "Plantillas", href: "/dashboard/disenos?tab=plantillas" });
    expect(a.status).toEqual({ label: "Plantilla", tone: "pur" });
  });

  it("con verificación, el botón principal dice «Emitir <tipo>»", () => {
    expect(editorActions(template({ verify: true, docType: "constancia" }), ALL).primary.label).toBe("Emitir constancia");
    expect(editorActions(template({ verify: true, docType: "certificado" }), ALL).primary.label).toBe("Emitir certificado");
    expect(editorActions(template({ verify: true, docType: "otro", docTypeLabel: "Credencial" }), ALL).primary.label).toBe("Emitir credencial");
    // Sin verificación (aunque quede un tipo guardado), «Generar para…».
    expect(editorActions(template({ verify: false, docType: "diploma" }), ALL).primary.label).toBe("Generar para…");
  });

  it("generar y automatizar se ocultan sin su permiso", () => {
    const a = editorActions(template(), MEMBER);
    expect(a.primary.visible).toBe(false);
    expect(a.generateMany.visible).toBe(false);
    expect(a.automate.visible).toBe(false);
    expect(a.exportMenu.visible).toBe(true);
    expect(editorActions(template(), { ...MEMBER, generate: true }).primary.visible).toBe(true);
    expect(editorActions(template(), { ...MEMBER, automate: true }).automate.visible).toBe(true);
  });

  it("una generación muestra su estado y no se publica ni se usa en contenido desde acá", () => {
    expect(editorActions(design({ isGeneration: true, status: "void" }), ALL).status).toEqual({ label: "Anulado", tone: "bad" });
    expect(editorActions(design({ isGeneration: true, status: "ready" }), ALL).status.label).toBe("Generado");
    expect(editorActions(design({ isGeneration: true }), ALL).format.mode).toBe("fixed");
  });

  it("un archivado no se publica ni genera y lo dice", () => {
    const a = editorActions(design({ archived: true, published: true }), ALL);
    expect(a.status.label).toBe("Archivado");
    expect(a.publish.visible).toBe(false);
    expect(editorActions(template({ archived: true }), ALL).primary.visible).toBe(false);
  });
});
