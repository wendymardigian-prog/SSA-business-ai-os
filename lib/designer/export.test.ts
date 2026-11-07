import { describe, expect, it, vi } from "vitest";
import { emptyDoc, type DesignDoc } from "./doc/schema";
import { FORMAT_KEYS, FORMATS } from "./formats";
import { EXPORT_GIVE_UP_MS, WEB_NOT_EXPORTABLE, exportDownloadName, exportPlan, exportStampAgeMs, isValidExportStamp, newExportStamp, slugifyFileName, storedExportFile } from "./export";
import { runDesignRender } from "./jobs/render";
import { exportFolder } from "./storage";
import { MemoryDb } from "./testing/memory-db";
import type { RenderRequest } from "./render-client";

/** Un documento con N páginas. */
function docWith(format: Parameters<typeof emptyDoc>[0], pages: number): DesignDoc {
  const doc = emptyDoc(format);
  for (let i = 1; i < pages; i++) doc.pages.push({ ...doc.pages[0], id: `pg_extra${i}` });
  return doc;
}

describe("exportPlan (F46)", () => {
  it("PDF: un solo pedido con todas las páginas, al tamaño real del formato", () => {
    const plan = exportPlan(docWith("carta_v", 3), "pdf");
    expect(plan).toMatchObject({ ok: true, kind: "pdf", scale: 1, width: 816, height: 1056, pageCount: 3, pages: [0, 1, 2] });
    if (!plan.ok) return;
    expect(plan.requests).toEqual([{ format: "pdf", pages: [0, 1, 2], width: 816, height: 1056, scale: 1 }]);
    expect(plan.stored).toEqual({ file: "document.pdf", contentType: "application/pdf" });
  });

  it("los impresos salen ×1 y las redes y presentaciones ×2", () => {
    for (const key of FORMAT_KEYS) {
      if (key === "web") continue;
      const plan = exportPlan(emptyDoc(key), "pdf");
      expect(plan.ok && plan.scale).toBe(["carta_v", "carta_h", "a4_v", "a4_h"].includes(key) ? 1 : 2);
      expect(plan.ok && plan.width).toBe(FORMATS[key].width);
    }
  });

  it("ZIP: un PNG por página, con los nombres 01.png, 02.png…", () => {
    const plan = exportPlan(docWith("v45", 3), "zip");
    expect(plan).toMatchObject({ ok: true, kind: "zip", scale: 2, pages: [0, 1, 2], inner: ["01.png", "02.png", "03.png"] });
    if (!plan.ok) return;
    expect(plan.requests).toEqual([{ format: "png", pages: [0, 1, 2], width: 1080, height: 1350, scale: 2 }]);
    expect(plan.stored.file).toBe("imagenes.zip");
  });

  it("PNG: una sola página (la pedida), con su nombre", () => {
    const plan = exportPlan(docWith("story", 4), "png", 2);
    expect(plan).toMatchObject({ ok: true, kind: "png", pages: [2], inner: null });
    if (!plan.ok) return;
    expect(plan.requests).toEqual([{ format: "png", pages: [2], width: 1080, height: 1920, scale: 2 }]);
    expect(plan.stored).toEqual({ file: "page-03.png", contentType: "image/png" });
  });

  it("PNG sin página es la primera", () => {
    const plan = exportPlan(docWith("sq", 2), "png");
    expect(plan.ok && plan.pages).toEqual([0]);
  });

  it("una página que no existe se rechaza", () => {
    for (const page of [2, -1, 1.5, Number.NaN]) expect(exportPlan(docWith("sq", 2), "png", page)).toEqual({ ok: false, error: "Esa página no existe en este diseño" });
  });

  it("una página web no se exporta, sea cual sea el tipo", () => {
    for (const kind of ["pdf", "zip", "png"] as const) expect(exportPlan(emptyDoc("web"), kind)).toEqual({ ok: false, error: WEB_NOT_EXPORTABLE });
  });
});

describe("nombres de archivo", () => {
  it("un nombre legible, sin tildes ni símbolos", () => {
    expect(slugifyFileName("Certificado · Ana Pérez")).toBe("certificado-ana-perez");
    expect(slugifyFileName("  ¡¡Año Nuevo!!  ")).toBe("ano-nuevo");
    expect(slugifyFileName("???")).toBe("diseno");
    expect(slugifyFileName("a".repeat(200)).length).toBeLessThanOrEqual(80);
  });

  it("el nombre de lo que se baja sale del diseño y del tipo", () => {
    expect(exportDownloadName("Certificado · Ana Pérez", "pdf")).toBe("certificado-ana-perez.pdf");
    expect(exportDownloadName("Carrusel de lanzamiento", "zip")).toBe("carrusel-de-lanzamiento-imagenes.zip");
    expect(exportDownloadName("Carrusel de lanzamiento", "png")).toBe("carrusel-de-lanzamiento.png");
    expect(exportDownloadName("Carrusel de lanzamiento", "png", 2)).toBe("carrusel-de-lanzamiento-pagina-3.png");
  });

  it("storedExportFile no necesita el documento", () => {
    expect(storedExportFile("png", 0).file).toBe("page-01.png");
    expect(storedExportFile("png", 11).file).toBe("page-12.png");
  });
});

describe("la marca de una exportación", () => {
  it("la arma quien pide y se valida estricto (nunca una ruta)", () => {
    const stamp = newExportStamp(new Date("2026-11-07T12:00:00Z"), () => 0.123456789);
    expect(isValidExportStamp(stamp)).toBe(true);
    for (const bad of ["", "../x", "1/2", "12345", "abc-def", `${stamp}/..`, 7]) expect(isValidExportStamp(bad)).toBe(false);
  });

  it("dos marcas del mismo instante se distinguen por el azar", () => {
    const now = new Date("2026-11-07T12:00:00Z");
    expect(newExportStamp(now, () => 0.11)).not.toBe(newExportStamp(now, () => 0.77));
  });

  it("cuenta cuánto lleva pidiéndose", () => {
    const now = new Date("2026-11-07T12:10:00Z");
    const stamp = newExportStamp(new Date("2026-11-07T12:00:00Z"), () => 0.5);
    expect(exportStampAgeMs(stamp, now)).toBe(10 * 60_000);
    expect(exportStampAgeMs("no-es-nuestra", now)).toBeNull();
    expect(EXPORT_GIVE_UP_MS).toBeGreaterThan(21 * 60_000);
  });
});

describe("exportPlan es la misma cuenta que hace el job design_render", () => {
  const WS = "11111111-2222-3333-4444-555555555555";
  const DESIGN = "aaaaaaaa-2222-3333-4444-555555555555";

  for (const [format, pages] of [["carta_h", 2], ["v45", 3], ["wide", 4]] as const) {
    for (const kind of ["pdf", "zip", "png"] as const) {
      it(`${format} · ${kind}`, async () => {
        const doc = docWith(format, pages);
        const db = new MemoryDb({
          designs: [{ id: DESIGN, workspace_id: WS, doc, format, code: "K8F2-WQ4M-7TQA", rev: 1, values: {}, template_id: null, renders: {}, attempts: 0 }],
          workspaces: [{ id: WS, design_settings: {} }],
        });
        const requests: RenderRequest[] = [];
        const render = vi.fn(async (req: RenderRequest) => {
          requests.push(req);
          const count = req.pages ? req.pages.length : 1;
          return {
            version: "t",
            files: req.format === "pdf" ? [{ page: 0, contentType: "application/pdf" as const, bytes: new Uint8Array([37]) }] : Array.from({ length: count }, (_, page) => ({ page, contentType: "image/png" as const, bytes: new Uint8Array([1]) })),
          };
        });
        const page = kind === "png" ? 1 : undefined;
        const plan = exportPlan(doc, kind, page);
        if (!plan.ok) throw new Error(plan.error);

        const out = await runDesignRender(db.client, { designId: DESIGN, purpose: "export", exportKind: kind, page, stamp: "s1" }, { render, now: () => new Date("2026-11-07T12:00:00Z"), schedule: vi.fn() });

        expect(out).toEqual({ status: "exported", paths: [`${exportFolder(WS, DESIGN, "s1")}/${plan.stored.file}`] });
        expect(requests).toHaveLength(plan.requests.length);
        requests.forEach((req, i) => {
          const wanted = plan.requests[i];
          expect({ format: req.format, width: req.width, height: req.height, scale: req.scale, count: req.pages ? req.pages.length : 1 }).toEqual({
            format: wanted.format,
            width: wanted.width,
            height: wanted.height,
            scale: wanted.scale,
            count: wanted.pages.length,
          });
        });
      });
    }
  }
});
