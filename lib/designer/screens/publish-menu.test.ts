import { describe, expect, it } from "vitest";
import { publishMenuView, voidReasonProblem } from "./publish-menu";

const LINK = "https://links.negocio.test/d/K8F2-WQ4M-7TQA";
const publisher = { publish: true, generate: false };
const props = (extra: Partial<Parameters<typeof publishMenuView>[0]> = {}) => ({ format: "v45" as const, can: publisher, verification: null, ...extra });

describe("menú Publicar", () => {
  it("sin publicar: «Publicar», el aviso, «Publicar ahora» y la descarga", () => {
    const v = publishMenuView(props(), { published: false, link: LINK });
    expect(v).toMatchObject({ visible: true, trigger: { text: "Publicar", published: false }, publishNow: true, unpublish: false, downloadToggle: true, indexingToggle: false });
    expect(v.note).toBe("Crea un link público: quien lo tenga lo puede ver.");
    // El link se ve, pero todavía no funciona.
    expect(v.link).toEqual({ url: LINK, live: false });
    expect(v.copy).toBe(false);
    expect(v.viewAsPublic).toBe(false);
  });

  it("sin el link armado todavía lo dice", () => {
    expect(publishMenuView(props(), { published: false, link: null }).linkHint).toBe("El link aparece al publicar.");
  });

  it("publicado: «Publicado», copiar, ver como el público y despublicar; sin «Publicar ahora»", () => {
    const v = publishMenuView(props(), { published: true, link: LINK });
    expect(v).toMatchObject({ trigger: { text: "Publicado", published: true }, publishNow: false, unpublish: true, copy: true, viewAsPublic: true });
    expect(v.link).toEqual({ url: LINK, live: true });
  });

  it("una página web ofrece «aparecer en buscadores» y no la descarga", () => {
    const v = publishMenuView(props({ format: "web" }), { published: false, link: LINK });
    expect(v).toMatchObject({ downloadToggle: false, indexingToggle: true });
  });

  it("una pieza que no es web nunca ofrece buscadores", () => {
    for (const format of ["carta_v", "carta_h", "a4_v", "a4_h", "sq", "v45", "story", "wide"] as const) {
      expect(publishMenuView(props({ format }), { published: false, link: LINK }).indexingToggle).toBe(false);
    }
  });
});

describe("lo que el permiso no da se oculta", () => {
  it("sin ningún permiso del menú, no hay menú", () => {
    expect(publishMenuView(props({ can: { publish: false, generate: false } }), { published: true, link: LINK }).visible).toBe(false);
    // Anular sin una pieza con verificación tampoco da menú.
    expect(publishMenuView(props({ can: { publish: false, generate: true } }), { published: true, link: LINK }).visible).toBe(false);
  });

  it("sin designer.publish: nada de publicar, despublicar ni opciones", () => {
    const v = publishMenuView(props({ can: { publish: false, generate: true }, verification: { docType: "certificado", docTypeLabel: null, status: "valid" } }), { published: true, link: LINK });
    expect(v).toMatchObject({ visible: true, publishNow: false, unpublish: false, downloadToggle: false, indexingToggle: false });
    expect(v.verification?.canVoid).toBe(true);
  });

  it("sin designer.generate no hay «Anular», aunque pueda publicar", () => {
    const v = publishMenuView(props({ verification: { docType: "certificado", docTypeLabel: null, status: "valid" } }), { published: true, link: LINK });
    expect(v.verification).toMatchObject({ text: "Verificación: Certificado válido", canVoid: false });
  });
});

describe("hay cambios sin publicar (F48b)", () => {
  it("publicado y editado después: el aviso y el botón «Publicar cambios»", () => {
    const v = publishMenuView(props(), { published: true, link: LINK, stale: true });
    expect(v.staleNotice).toEqual({ text: "Hay cambios sin publicar", button: "Publicar cambios" });
    // Sigue siendo «Publicado»: el link funciona, con la versión anterior.
    expect(v.trigger).toEqual({ text: "Publicado", published: true });
  });

  it("sin cambios, sin publicar, o sin designer.publish, no hay aviso", () => {
    expect(publishMenuView(props(), { published: true, link: LINK, stale: false }).staleNotice).toBeNull();
    expect(publishMenuView(props(), { published: true, link: LINK }).staleNotice).toBeNull();
    expect(publishMenuView(props(), { published: false, link: LINK, stale: true }).staleNotice).toBeNull();
    expect(publishMenuView(props({ can: { publish: false, generate: true }, verification: { docType: "certificado", docTypeLabel: null, status: "valid" } }), { published: true, link: LINK, stale: true }).staleNotice).toBeNull();
  });
});

describe("anular (F47)", () => {
  it("el botón y el título se nombran con el tipo de documento", () => {
    const can = { publish: true, generate: true };
    const v = (docType: "certificado" | "constancia" | "diploma" | "otro", label: string | null = null) =>
      publishMenuView(props({ can, verification: { docType, docTypeLabel: label, status: "valid" } }), { published: true, link: LINK }).verification;
    expect(v("certificado")).toMatchObject({ voidLabel: "Anular certificado…", voidTitle: "Anular certificado", canVoid: true });
    expect(v("constancia")?.voidLabel).toBe("Anular constancia…");
    expect(v("diploma")?.text).toBe("Verificación: Diploma válido");
    expect(v("otro", "Credencial")).toMatchObject({ voidLabel: "Anular credencial…", text: "Verificación: Verificado" });
  });

  it("una pieza ya anulada no se anula de nuevo y lo dice", () => {
    const v = publishMenuView(props({ can: { publish: true, generate: true }, verification: { docType: "constancia", docTypeLabel: null, status: "void" } }), { published: true, link: LINK });
    expect(v.verification).toMatchObject({ text: "Verificación: Constancia anulada", canVoid: false });
  });

  it("una pieza con verificación tiene link vivo aunque no esté «publicada»", () => {
    const v = publishMenuView(props({ can: { publish: false, generate: true }, verification: { docType: "certificado", docTypeLabel: null, status: "valid" } }), { published: false, link: LINK });
    expect(v).toMatchObject({ copy: true, viewAsPublic: true });
  });

  it("el motivo es obligatorio y tiene tope", () => {
    expect(voidReasonProblem("")).toMatch(/motivo/i);
    expect(voidReasonProblem("   \n ")).toMatch(/motivo/i);
    expect(voidReasonProblem("Nombre mal escrito")).toBeNull();
    expect(voidReasonProblem("x".repeat(501))).toMatch(/demasiado largo/);
    expect(voidReasonProblem("x".repeat(500))).toBeNull();
  });
});
