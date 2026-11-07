import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyDoc } from "../doc/schema";
import { DOC_TYPES } from "../verification";
import { CODE, DESIGN, WS, rpcDesign, rpcGeneration } from "../testing/public-fixtures";
import { decidePublicView, issuedDate, parsePublicDesign, parseRenders, pieceMaxWidth, publicDescription, publicTitle, withBaseTarget, type PublicDesign } from "./model";

const parse = (raw: Record<string, unknown>): PublicDesign => {
  const parsed = parsePublicDesign(raw);
  if (!parsed) throw new Error("no se pudo leer");
  return parsed;
};
const view = (raw: Record<string, unknown>) => decidePublicView(parse(raw));

describe("parsePublicDesign", () => {
  it("lee lo que devuelve design_public_get", () => {
    expect(parse(rpcDesign())).toMatchObject({ code: CODE, format: "carta_h", kind: "design", status: "ready", published: true, pageCount: 1, rendered: true, businessName: "Academia Ejemplo" });
  });

  it("algo que no tiene la forma esperada es null (404)", () => {
    for (const bad of [null, undefined, "x", [], {}, rpcDesign({ format: "otro" }), rpcDesign({ kind: "x" }), rpcDesign({ status: "raro" }), rpcDesign({ page_count: 0 }), rpcDesign({ code: null })]) {
      expect(parsePublicDesign(bad)).toBeNull();
    }
  });

  it("nunca deja pasar datos de la persona ni del negocio, aunque la respuesta los trajera", () => {
    const tainted = rpcGeneration({ email: "ana@example.test", phone: "+5491100000000", subject_contact_id: "c0ffee00-0000-4000-8000-000000000000", workspace_id: WS, values: { "contact.email": "ana@example.test" } });
    const json = JSON.stringify([parse(tainted), view(tainted)]);
    for (const secret of ["ana@example.test", "5491100000000", "c0ffee00", WS, "subject", "workspace_id"]) expect(json).not.toContain(secret);
  });
});

describe("design_public_get (la función de la base) no devuelve datos de la persona", () => {
  const sql = readFileSync(resolve(__dirname, "../../../supabase/migrations/00320_designer_tables.sql"), "utf8");
  const body = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.design_public_get"), sql.indexOf("REVOKE ALL ON FUNCTION public.design_public_get"));
  const keys = [...body.slice(body.indexOf("jsonb_build_object(")).matchAll(/^\s+'([a-z_]+)',/gm)].map((m) => m[1]);

  it("encontró las claves que devuelve", () => {
    expect(keys.length).toBeGreaterThan(15);
    expect(keys).toContain("business_name");
  });

  it("ninguna es el email, el teléfono, el id del sujeto ni el negocio", () => {
    for (const key of keys) expect(key).not.toMatch(/email|phone|telefono|contact|subject|values|workspace_id|source_ref/);
  });

  it("el documento solo se devuelve para una página web propia", () => {
    expect(body).toMatch(/'doc', CASE WHEN v_d\.format = 'web' AND NOT v_is_generation THEN v_d\.doc END/);
  });
});

describe("parseRenders", () => {
  const prefix = `${WS}/${DESIGN}/3-1`;
  it("acepta las rutas de la carpeta del propio diseño", () => {
    expect(parseRenders({ version: "3-1", pdf_path: `${prefix}/document.pdf`, pages: [`${prefix}/page-01.png`] }, WS, DESIGN)).toEqual({ version: "3-1", pdfPath: `${prefix}/document.pdf`, pages: [`${prefix}/page-01.png`] });
  });

  it("descarta una ruta de otro diseño, de otro negocio, de las exportaciones o que se sale de la carpeta", () => {
    const other = `${WS}/bbbbbbbb-2222-3333-4444-555555555555/3-1/page-01.png`;
    expect(parseRenders({ pages: [other] }, WS, DESIGN)).toBeNull();
    expect(parseRenders({ pages: [`99999999-2222-3333-4444-555555555555/${DESIGN}/x/page-01.png`] }, WS, DESIGN)).toBeNull();
    expect(parseRenders({ pages: [`${WS}/${DESIGN}/exports/s1/page-01.png`] }, WS, DESIGN)).toBeNull();
    expect(parseRenders({ pages: [`${prefix}/../../otro.png`] }, WS, DESIGN)).toBeNull();
    expect(parseRenders({ pages: [`${prefix}/page-01.png`, other] }, WS, DESIGN)?.pages).toEqual([`${prefix}/page-01.png`]);
  });

  it("sin archivos, null", () => {
    for (const raw of [null, {}, { pages: [] }, "x", []]) expect(parseRenders(raw, WS, DESIGN)).toBeNull();
  });
});

describe("qué se muestra para cada combinación (F43)", () => {
  it("un diseño propio publicado y renderizado se ve como pieza, con su descarga", () => {
    const v = view(rpcDesign());
    expect(v).toMatchObject({ screen: "pieces", verification: null, voidStamp: false, indexable: false, showName: true });
    expect(v.download).toEqual({ allowed: true, ready: true, option: { formato: "pdf", label: "Descargar PDF" } });
  });

  it("sin archivos todavía: «Se está preparando», y la descarga se pide pero no se ofrece", () => {
    const v = view(rpcDesign({ rendered: false }));
    expect(v.screen).toBe("preparing");
    expect(v.download).toMatchObject({ allowed: true, ready: false });
  });

  it("con la descarga apagada no hay descarga", () => {
    expect(view(rpcDesign({ allow_download: false })).download).toEqual({ allowed: false, ready: false, option: null });
  });

  it("un diseño de redes baja imágenes: un ZIP si son varias y un PNG si es una", () => {
    expect(view(rpcDesign({ format: "v45", page_count: 4 })).download.option).toMatchObject({ formato: "zip" });
    expect(view(rpcDesign({ format: "v45", page_count: 1 })).download.option).toMatchObject({ formato: "png", pagina: 1 });
  });

  it("una página web se muestra desde su documento, sin descarga", () => {
    const v = view(rpcDesign({ format: "web", doc: emptyDoc("web") }));
    expect(v).toMatchObject({ screen: "web", indexable: false });
    expect(v.download).toEqual({ allowed: false, ready: false, option: null });
  });

  it("una página web sin documento no se muestra", () => {
    expect(view(rpcDesign({ format: "web", doc: null })).screen).toBe("preparing");
  });

  it("solo una web publicada con «Permitir que aparezca en buscadores» se indexa", () => {
    expect(view(rpcDesign({ format: "web", doc: emptyDoc("web"), allow_indexing: true })).indexable).toBe(true);
    expect(view(rpcDesign({ format: "web", doc: emptyDoc("web"), allow_indexing: false })).indexable).toBe(false);
    // Una pieza que no es web nunca se indexa, aunque la bandera estuviera prendida.
    expect(view(rpcDesign({ format: "carta_h", allow_indexing: true })).indexable).toBe(false);
    expect(view(rpcDesign({ kind: "generation", format: "web", doc: emptyDoc("web"), allow_indexing: true, published: true, verify: false })).indexable).toBe(false);
  });

  it("el ancho: 760 en verticales y cuadradas, 1000 en horizontales", () => {
    expect(pieceMaxWidth("carta_v")).toBe(760);
    expect(pieceMaxWidth("v45")).toBe(760);
    expect(pieceMaxWidth("story")).toBe(760);
    expect(pieceMaxWidth("sq")).toBe(760);
    expect(pieceMaxWidth("carta_h")).toBe(1000);
    expect(pieceMaxWidth("wide")).toBe(1000);
    expect(view(rpcDesign({ format: "a4_v" })).maxWidth).toBe(760);
  });
});

describe("generaciones con verificación: solo se muestra lista (válida) o anulada", () => {
  it("lista: recuadro «válido» con el negocio, la fecha y el código", () => {
    const v = view(rpcGeneration());
    expect(v.screen).toBe("pieces");
    expect(v.verification).toEqual({
      status: "valid",
      title: "Certificado válido",
      text: `✅ Certificado válido · emitido por Academia Ejemplo el 7 de noviembre de 2026 · Código ${CODE}`,
      reason: null,
    });
    expect(v.download.allowed).toBe(true);
  });

  it("anulada: «anulado» con su motivo, sin Descargar, con el sello", () => {
    const v = view(rpcGeneration({ status: "void", void_reason: "Nombre mal escrito", voided_at: "2026-11-08T10:00:00Z" }));
    expect(v.verification).toEqual({ status: "void", title: "Certificado anulado", text: "⛔ Certificado anulado · Motivo: Nombre mal escrito", reason: "Nombre mal escrito" });
    expect(v.download).toEqual({ allowed: false, ready: false, option: null });
    expect(v.voidStamp).toBe(true);
    expect(v.screen).toBe("pieces");
  });

  for (const status of ["queued", "rendering", "failed", "draft"]) {
    it(`en estado «${status}» muestra «Se está preparando»: sin datos, sin verificación y sin Descargar`, () => {
      const raw = rpcGeneration({ status, rendered: false });
      const v = view(raw);
      expect(v).toEqual({ screen: "preparing", verification: null, voidStamp: false, download: { allowed: false, ready: false, option: null }, indexable: false, maxWidth: 1000, showName: false });
      expect(publicTitle(parse(raw), v)).toBe("Diseño");
      expect(publicDescription(parse(raw), v)).toBe("Academia Ejemplo");
    });
  }

  it("un estado que falló nunca se cuenta: se ve igual que uno que se está preparando", () => {
    expect(view(rpcGeneration({ status: "failed", rendered: false }))).toEqual(view(rpcGeneration({ status: "queued", rendered: false })));
  });

  const cases: Record<string, { valid: string; void: string }> = {
    certificado: { valid: `✅ Certificado válido · emitido por Academia Ejemplo el 7 de noviembre de 2026 · Código ${CODE}`, void: "⛔ Certificado anulado · Motivo: Error de carga" },
    constancia: { valid: `✅ Constancia válida · emitida por Academia Ejemplo el 7 de noviembre de 2026 · Código ${CODE}`, void: "⛔ Constancia anulada · Motivo: Error de carga" },
    diploma: { valid: `✅ Diploma válido · emitido por Academia Ejemplo el 7 de noviembre de 2026 · Código ${CODE}`, void: "⛔ Diploma anulado · Motivo: Error de carga" },
    otro: { valid: `✅ Verificado · Credencial emitido por Academia Ejemplo el 7 de noviembre de 2026 · Código ${CODE}`, void: "⛔ Anulado · Credencial · Motivo: Error de carga" },
  };
  for (const type of DOC_TYPES) {
    it(`tipo «${type}»: el recuadro sale de su tipo (válido y anulado)`, () => {
      const base = { doc_type: type, doc_type_label: type === "otro" ? "Credencial" : null };
      expect(view(rpcGeneration(base)).verification?.text).toBe(cases[type].valid);
      expect(view(rpcGeneration({ ...base, status: "void", void_reason: "Error de carga" })).verification?.text).toBe(cases[type].void);
    });
  }

  it("la fecha de emisión es la del negocio, no la del servidor", () => {
    // 01:30 UTC del 8 es todavía el 7 en Buenos Aires.
    expect(issuedDate("2026-11-08T01:30:00Z", "America/Argentina/Buenos_Aires")).toBe("7 de noviembre de 2026");
    expect(issuedDate("2026-11-08T01:30:00Z", "UTC")).toBe("8 de noviembre de 2026");
    expect(issuedDate("2026-11-08T01:30:00Z", "Zona/Inexistente")).toBe("8 de noviembre de 2026");
    expect(issuedDate(null, "UTC")).toBe("");
  });

  it("una generación publicada de una plantilla sin verificación se ve como una pieza más, sin recuadro", () => {
    const v = view(rpcGeneration({ verify: false, doc_type: null, published: true }));
    expect(v.screen).toBe("pieces");
    expect(v.verification).toBeNull();
  });

  it("una anulada se ve anulada aunque su plantilla ya no verifique", () => {
    const v = view(rpcGeneration({ verify: false, doc_type: null, published: true, status: "void", void_reason: "Duplicada" }));
    expect(v.verification).toMatchObject({ status: "void", text: "⛔ Anulado · Documento · Motivo: Duplicada" });
    expect(v.download.allowed).toBe(false);
  });

  it("una anulada sin motivo dice «sin motivo» en vez de quedar vacía", () => {
    expect(view(rpcGeneration({ status: "void", void_reason: null })).verification?.reason).toBe("sin motivo");
  });
});

describe("la tarjeta y la pestaña", () => {
  it("con la pieza lista, el título es su nombre y la descripción el recuadro", () => {
    const raw = rpcGeneration();
    const v = view(raw);
    expect(publicTitle(parse(raw), v)).toBe("Certificado · Ana Pérez");
    expect(publicDescription(parse(raw), v)).toContain("Certificado válido");
  });

  it("sin recuadro, la descripción es el negocio", () => {
    const raw = rpcDesign();
    expect(publicDescription(parse(raw), view(raw))).toBe("Academia Ejemplo");
  });
});

describe("withBaseTarget", () => {
  it("hace que los links abran en una pestaña nueva", () => {
    expect(withBaseTarget("<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>")).toContain('<head><base target="_blank">');
  });
});
