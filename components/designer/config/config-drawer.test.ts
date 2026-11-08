import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock("@/lib/actions/designer/designs", () => ({
  archiveDesign: vi.fn(),
  deleteDesign: vi.fn(),
  duplicateDesign: vi.fn(),
  updateTemplateSettings: vi.fn(),
  listVersions: vi.fn(async () => ({ ok: true, data: [] })),
  restoreVersion: vi.fn(),
  signDesignAssetUrls: vi.fn(async () => ({ ok: true, data: {} })),
}));
vi.mock("@/lib/actions/designer/automate", () => ({ automationsUsingTemplate: vi.fn(async () => ({ ok: true, data: [] })) }));

import { emptyDoc } from "@/lib/designer/doc/schema";
import { ConfigDrawer, type ConfigSubject } from "./config-drawer";

const doc = emptyDoc("carta_h");
const template: ConfigSubject = {
  kind: "template",
  id: "t1",
  name: "Constancia",
  doc,
  origin: "blank",
  published: false,
  archived: false,
  contentLinked: false,
  generationsCount: 0,
  generation: null,
  template: { verify: true, docType: "constancia", docTypeLabel: null, dateFormat: "long", allowDownload: true },
};

const noop = () => {};
const render = (can: { view: boolean; edit: boolean; publish: boolean; generate: boolean; manage: boolean }, subject: ConfigSubject = template) =>
  renderToString(
    createElement(ConfigDrawer, {
      subject,
      can,
      timeZone: "UTC",
      brand: { name: "Academia Ejemplo", colorHex: "#112233" },
      palette: [],
      uploadedFonts: [],
      customVars: [],
      onClose: noop,
      beforeServer: async () => {},
      onFormatChange: noop,
      onPages: noop,
      onTemplateSettings: noop,
      onReload: noop,
      onShowGenerations: noop,
    }),
  );

const FULL = { view: true, edit: true, publish: true, generate: true, manage: true };
const VIEWER = { view: true, edit: false, publish: false, generate: false, manage: false };

describe("el drawer de Configuración: lo que el permiso no da se OCULTA (F28)", () => {
  it("con todos los permisos hay controles", () => {
    const html = render(FULL);
    expect(html).toContain('aria-label="Formato de fechas"');
    expect(html).toContain("Permitir descargar");
    expect(html).toContain("Se puede verificar");
    expect(html).toContain('role="radiogroup"');
  });

  it("con solo designer.view no se dibuja ningún control: los valores se muestran como texto", () => {
    const html = render(VIEWER);
    expect(html).not.toContain("<select");
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain('role="radiogroup"');
    expect(html).not.toContain("<input");
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("Duplicar");
    expect(html).not.toContain("Archivar");
    expect(html).not.toContain("Borrar definitivamente");
    // Pero los valores se ven.
    expect(html).toContain("Formato de fechas");
    expect(html).toContain("Constancia");
  });

  it("«Permitir descargar» pide designer.publish: con edit pero sin publish no se ve; con publish se ve", () => {
    expect(render({ ...FULL, publish: false })).not.toContain("Permitir descargar");
    expect(render({ ...VIEWER, publish: true })).toContain("Permitir descargar");
    // «Se puede verificar» sigue con designer.edit: con solo publish no hay interruptor de verificación.
    expect(render({ ...VIEWER, publish: true })).not.toContain('role="radiogroup"');
  });

  it("una generación (pieza emitida) no ofrece ajustar la imagen de fondo", () => {
    const withImage = emptyDoc("carta_h");
    withImage.pages[0].background = { color: "#ffffff", image: { path: "ws/img/a.png", fit: "cover", focal: { x: 50, y: 50 } } } as never;
    const generation: ConfigSubject = { ...template, kind: "design", doc: withImage, template: null, generation: { templateId: "t1", templateName: "Constancia", subjectLabel: "Ana Pérez" } };
    const html = render(FULL, generation);
    expect(html).not.toContain('aria-pressed="true"');
    expect(html).not.toContain("Cubrir toda la página</button>");
  });
});
