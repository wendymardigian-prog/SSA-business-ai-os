import { describe, expect, it } from "vitest";
import { editorBarView, parseEditorTab, publishButton, sectionHref, sectionsFor, type BarForm } from "./editor-bar";

const FORM = (over: Partial<BarForm>): BarForm => ({
  id: "f1",
  type: "custom",
  status: "draft",
  eodVariant: null,
  hasUnpublishedChanges: false,
  responseCount: 128,
  ...over,
});
const labels = (view: ReturnType<typeof editorBarView>) => view.tabs.map((t) => t.label);

describe("pestañas por tipo (F7)", () => {
  it("personalizado: Campos · Contacto · Flows · Publicar · Respuestas", () => {
    expect(labels(editorBarView(FORM({}), { canManage: true, route: "editor" }))).toEqual(["Campos", "Contacto", "Flows", "Publicar", "Respuestas"]);
  });

  it("encuesta: la pestaña Encuesta va despues de Campos y es una ruta propia", () => {
    const view = editorBarView(FORM({ type: "survey" }), { canManage: true, route: "editor" });
    expect(labels(view)).toEqual(["Campos", "Encuesta", "Contacto", "Flows", "Publicar", "Respuestas"]);
    expect(view.tabs.find((t) => t.label === "Encuesta")).toMatchObject({ kind: "route", href: "/dashboard/formularios/f1/encuesta" });
  });

  it("contrato: Contrato (dentro del editor) despues de Campos", () => {
    const view = editorBarView(FORM({ type: "contract" }), { canManage: true, route: "editor" });
    expect(labels(view)).toEqual(["Campos", "Contrato", "Contacto", "Flows", "Publicar", "Respuestas"]);
    expect(view.tabs.find((t) => t.label === "Contrato")).toMatchObject({ kind: "section", href: "/dashboard/formularios/f1?tab=contrato" });
  });

  it("fin de dia de setters: Configuración · Preguntas · Canales · Flows · Publicar · Reportes", () => {
    const view = editorBarView(FORM({ type: "eod", eodVariant: "setter" }), { canManage: true, route: "editor" });
    expect(labels(view)).toEqual(["Configuración", "Preguntas", "Canales", "Flows", "Publicar", "Reportes"]);
    expect(view.tabs.at(-1)).toMatchObject({ key: "reportes", href: "/dashboard/formularios/f1/reportes", count: 128 });
  });

  it("fin de dia general: sin Canales", () => {
    const view = editorBarView(FORM({ type: "eod", eodVariant: "general" }), { canManage: true, route: "editor" });
    expect(labels(view)).toEqual(["Configuración", "Preguntas", "Flows", "Publicar", "Reportes"]);
  });

  it("la pestaña Flows se llama Flows (no Automatizaciones) y Respuestas lleva la cantidad", () => {
    const view = editorBarView(FORM({ responseCount: 128 }), { canManage: true, route: "editor" });
    expect(view.tabs.find((t) => t.key === "flows")?.label).toBe("Flows");
    expect(view.tabs.at(-1)).toMatchObject({ label: "Respuestas", count: 128 });
  });

  it("sin la cantidad medida no hay numerito (nunca un 0 inventado)", () => {
    const view = editorBarView(FORM({ responseCount: null }), { canManage: true, route: "editor" });
    expect(view.tabs.at(-1)).not.toHaveProperty("count");
  });
});

describe("pestaña marcada", () => {
  it("en el editor, la que dice la URL (por defecto la primera)", () => {
    expect(editorBarView(FORM({}), { canManage: true, route: "editor" }).tabs.filter((t) => t.active).map((t) => t.key)).toEqual(["campos"]);
    expect(editorBarView(FORM({}), { canManage: true, route: "editor", section: "contacto" }).tabs.filter((t) => t.active).map((t) => t.key)).toEqual(["contacto"]);
  });

  it("en una ruta hermana, la pestaña de esa ruta; en Metricas, ninguna (el boton queda marcado)", () => {
    expect(editorBarView(FORM({}), { canManage: true, route: "respuestas" }).tabs.filter((t) => t.active).map((t) => t.key)).toEqual(["respuestas"]);
    expect(editorBarView(FORM({ type: "survey" }), { canManage: true, route: "encuesta" }).tabs.filter((t) => t.active).map((t) => t.key)).toEqual(["encuesta"]);
    expect(editorBarView(FORM({ type: "eod", eodVariant: "general" }), { canManage: true, route: "reportes" }).tabs.filter((t) => t.active).map((t) => t.key)).toEqual(["reportes"]);
    const metrics = editorBarView(FORM({}), { canManage: true, route: "metricas" });
    expect(metrics.tabs.some((t) => t.active)).toBe(false);
    expect(metrics.metrics).toEqual({ href: "/dashboard/formularios/f1/metricas", active: true });
  });
});

describe("?tab= (F7)", () => {
  it("un valor invalido cae en la primera pestaña", () => {
    expect(parseEditorTab("custom", null, "inventada")).toBe("campos");
    expect(parseEditorTab("custom", null, undefined)).toBe("campos");
    expect(parseEditorTab("eod", "general", "canales")).toBe("configuracion"); // un EOD general no tiene Canales
    expect(parseEditorTab("custom", null, "contrato")).toBe("campos"); // un personalizado no tiene Contrato
    expect(parseEditorTab("custom", null, "encuesta")).toBe("campos"); // la encuesta es una ruta, no una pestaña del editor
  });

  it("acepta las pestañas del tipo, tambien si el valor llega como lista", () => {
    expect(parseEditorTab("custom", null, "publicar")).toBe("publicar");
    expect(parseEditorTab("contract", null, "contrato")).toBe("contrato");
    expect(parseEditorTab("eod", "setter", "canales")).toBe("canales");
    expect(parseEditorTab("custom", null, ["flows", "x"])).toBe("flows");
  });

  it("la primera pestaña es la pantalla sin ?tab=", () => {
    expect(sectionHref("f1", "campos", "campos")).toBe("/dashboard/formularios/f1");
    expect(sectionHref("f1", "contacto", "campos")).toBe("/dashboard/formularios/f1?tab=contacto");
    expect(sectionsFor("eod", "setter").map((s) => s.key)).toEqual(["configuracion", "campos", "canales", "flows", "publicar"]);
  });
});

describe("el boton de publicar (F7)", () => {
  it("borrador o pausado: Publicar", () => {
    expect(publishButton({ status: "draft", hasUnpublishedChanges: false }, true)).toEqual({ kind: "publish", label: "Publicar" });
    expect(publishButton({ status: "paused", hasUnpublishedChanges: true }, true)).toEqual({ kind: "publish", label: "Publicar" });
  });

  it("publicado con cambios: Publicar cambios; sin cambios: Publicado, sin accion", () => {
    expect(publishButton({ status: "published", hasUnpublishedChanges: true }, true)).toEqual({ kind: "publish_changes", label: "Publicar cambios" });
    expect(publishButton({ status: "published", hasUnpublishedChanges: false }, true)).toEqual({ kind: "published", label: "Publicado" });
  });

  it("sin forms.manage no aparece, y archivado tampoco", () => {
    expect(publishButton({ status: "draft", hasUnpublishedChanges: false }, false).kind).toBe("none");
    expect(publishButton({ status: "published", hasUnpublishedChanges: true }, false).kind).toBe("none");
    expect(publishButton({ status: "archived", hasUnpublishedChanges: false }, true).kind).toBe("none");
  });
});

describe("estado, guardado y vista previa (F7)", () => {
  it("el chip dice el estado y 'Cambios sin publicar' solo aparece si esta publicado con cambios", () => {
    expect(editorBarView(FORM({ status: "published", hasUnpublishedChanges: true }), { canManage: true, route: "editor" })).toMatchObject({ status: { label: "Publicado", tone: "published" }, unpublishedBadge: true });
    expect(editorBarView(FORM({ status: "published" }), { canManage: true, route: "editor" }).unpublishedBadge).toBe(false);
    expect(editorBarView(FORM({ status: "draft", hasUnpublishedChanges: true }), { canManage: true, route: "editor" }).unpublishedBadge).toBe(false);
    for (const status of ["draft", "published", "paused", "archived"] as const) {
      expect(editorBarView(FORM({ status }), { canManage: true, route: "editor" }).status.tone).toBe(status);
    }
  });

  it("los textos del guardado y que hacer si falla", () => {
    const view = (saveState: "saved" | "pending" | "saving" | "error" | "conflict") => editorBarView(FORM({}), { canManage: true, route: "editor", saveState }).save;
    expect(view("saved")).toEqual({ state: "saved", label: "Guardado ✓", retry: "none" });
    expect(view("saving")).toMatchObject({ label: "Guardando…", retry: "none" });
    expect(view("pending")).toMatchObject({ label: "Guardando…" });
    expect(view("error")).toEqual({ state: "error", label: "No se guardó", retry: "retry" });
    expect(view("conflict")).toMatchObject({ label: "Alguien más cambió este formulario", retry: "reload" });
  });

  it("el guardado y el nombre editable solo donde hay borrador: en el editor, con forms.manage y sin archivar", () => {
    expect(editorBarView(FORM({}), { canManage: false, route: "editor" })).toMatchObject({ save: null, nameEditable: false });
    expect(editorBarView(FORM({ status: "archived" }), { canManage: true, route: "editor" })).toMatchObject({ save: null, nameEditable: false });
    expect(editorBarView(FORM({}), { canManage: true, route: "respuestas" })).toMatchObject({ save: null, nameEditable: false });
    expect(editorBarView(FORM({}), { canManage: true, route: "editor" })).toMatchObject({ nameEditable: true });
  });

  it("Vista previa en todos los tipos menos fin de dia", () => {
    for (const type of ["custom", "survey", "contract"] as const) expect(editorBarView(FORM({ type }), { canManage: true, route: "editor" }).showPreview).toBe(true);
    expect(editorBarView(FORM({ type: "eod" }), { canManage: true, route: "editor" }).showPreview).toBe(false);
  });

  it("Volver lleva a la lista", () => {
    expect(editorBarView(FORM({}), { canManage: true, route: "editor" }).backHref).toBe("/dashboard/formularios");
  });
});
