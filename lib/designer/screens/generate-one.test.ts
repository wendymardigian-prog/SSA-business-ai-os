import { describe, expect, it } from "vitest";
import { emptyDoc } from "../doc/schema";
import { DOC_TYPE_LABELS, issueButtonLabel } from "../verification";
import { buildGenerateOneInput, busyLabel, CODE_PLACEHOLDER, initialEmail, missingRows, previewHtml, previewValues, submitReason, variableRows, type GenerateOneState } from "./generate-one";
import { templateDoc } from "../testing/generation-fixtures";

const customVars = [
  { key: "nombre_en_el_certificado", label: "Nombre como lo quiere en el certificado", sample: "Ana Pérez", default: null },
  { key: "curso", label: "Curso", sample: "", default: "Curso general" },
];
const usedKeys = ["contact.first_name", "design.code", "curso", "nombre_en_el_certificado", "design.issued_on"];

const rows = (over: { values?: Record<string, string>; missingKeys?: string[]; overrides?: Record<string, string> } = {}) =>
  variableRows({ usedKeys, customVars, values: over.values ?? {}, missingKeys: over.missingKeys ?? [], overrides: over.overrides ?? {} });

describe("las variables del modal (F50)", () => {
  it("las propias primero, después las del sistema y el código al final", () => {
    expect(rows().map((r) => [r.key, r.kind])).toEqual([
      ["curso", "own"],
      ["nombre_en_el_certificado", "own"],
      ["contact.first_name", "system"],
      ["design.issued_on", "system"],
      ["design.code", "code"],
    ]);
  });

  it("una propia sin valor por defecto es obligatoria; con valor por defecto no", () => {
    const [curso, nombre] = rows({ values: { curso: "Curso general" } });
    expect(curso).toMatchObject({ key: "curso", required: false, empty: false, value: "Curso general" });
    expect(nombre).toMatchObject({ key: "nombre_en_el_certificado", required: true, empty: true, editable: true });
  });

  it("un dato del sistema que falta (el nombre de pila del contacto) es obligatorio hasta que se completa", () => {
    const falta = rows({ missingKeys: ["contact.first_name"] }).find((r) => r.key === "contact.first_name");
    expect(falta).toMatchObject({ required: true, empty: true });
    const completado = rows({ missingKeys: ["contact.first_name"], overrides: { "contact.first_name": "Lu" } }).find((r) => r.key === "contact.first_name");
    expect(completado).toMatchObject({ required: true, empty: false, value: "Lu" });
  });

  it("el código no se escribe: dice que lo asigna el sistema", () => {
    expect(rows().find((r) => r.key === "design.code")).toEqual({ key: "design.code", label: "Código de verificación", kind: "code", value: CODE_PLACEHOLDER, required: false, empty: false, editable: false });
  });

  it("lo puesto a mano gana sobre lo que dice el servidor, y se ve enseguida", () => {
    const nombre = rows({ values: { nombre_en_el_certificado: "" }, overrides: { nombre_en_el_certificado: "  Lu  " } }).find((r) => r.key === "nombre_en_el_certificado");
    expect(nombre).toMatchObject({ value: "Lu", empty: false });
  });

  it("missingRows lista lo obligatorio sin valor", () => {
    expect(missingRows(rows()).map((r) => r.key)).toEqual(["nombre_en_el_certificado"]);
    expect(missingRows(rows({ overrides: { nombre_en_el_certificado: "Lu" } }))).toEqual([]);
  });
});

describe("la vista previa con los datos reales (F50)", () => {
  it("lo que falta se ve como «‹Nombre›» y el código con un ejemplo", () => {
    const r = rows({ values: { "contact.first_name": "Lucía", "design.issued_on": "7 de noviembre de 2026" } });
    const values = previewValues(r, { "contact.first_name": "Lucía", "design.issued_on": "7 de noviembre de 2026", curso: "Curso general" }, {});
    expect(values.nombre_en_el_certificado).toBe("‹Nombre como lo quiere en el certificado›");
    expect(values["design.code"]).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(values["contact.first_name"]).toBe("Lucía");
  });

  it("dibuja con el MISMO renderPageHTML (modo público) y los valores reales, sin scripts", () => {
    const html = previewHtml(templateDoc(), { nombre_en_el_certificado: "Lucía Ferreyra de Salas", "design.issued_on": "7 de noviembre de 2026", "design.code": "K8F2-WQ4M-7TQA" }, {}, []);
    expect(html).toContain("Lucía Ferreyra de Salas");
    expect(html).toContain("7 de noviembre de 2026");
    expect(html).toContain("K8F2-WQ4M-7TQA");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("{{");
  });

  it("un valor con HTML no se ejecuta: sale escapado", () => {
    const html = previewHtml(templateDoc(), { nombre_en_el_certificado: '<img src=x onerror="alert(1)">' }, {}, []);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("un documento vacío también se dibuja", () => {
    expect(previewHtml(emptyDoc("carta_h"), {}, {}, [])).toContain("<");
  });
});

describe("cuándo se puede confirmar (F50)", () => {
  const tpl = { doc_type: "certificado", doc_type_label: null };
  const state = (over: Partial<GenerateOneState> = {}): GenerateOneState => ({
    contactId: "c1",
    rows: rows({ overrides: { nombre_en_el_certificado: "Lu" } }),
    publish: true,
    emailOn: false,
    email: initialEmail("certificado"),
    contactHasEmail: true,
    existing: null,
    replace: false,
    ...over,
  });

  it("listo: nada impide confirmar", () => {
    expect(submitReason(state(), tpl)).toBeNull();
  });

  it("sin contacto, lo pide primero", () => {
    expect(submitReason(state({ contactId: null }), tpl)).toBe("Elegí para quién es la pieza.");
  });

  it("generar sin un valor obligatorio lo pide antes de confirmar, con su nombre en español", () => {
    expect(submitReason(state({ rows: rows() }), tpl)).toBe("Completá: Nombre como lo quiere en el certificado.");
  });

  it("si ya tiene una válida, avisa con el texto del tipo hasta que se confirme el reemplazo", () => {
    const withExisting = state({ existing: { code: "K8F2-WQ4M-7TQA" } });
    expect(submitReason(withExisting, tpl)).toBe("Ya tiene un certificado válido (código K8F2-WQ4M-7TQA): ¿reemplazarlo?");
    expect(submitReason(state({ existing: { code: "K8F2-WQ4M-7TQA" }, replace: true }), tpl)).toBeNull();
    expect(submitReason(withExisting, { doc_type: "constancia", doc_type_label: null })).toBe("Ya tiene una constancia válida (código K8F2-WQ4M-7TQA): ¿reemplazarla?");
  });

  it("con email: el contacto tiene que tener email y el asunto y el mensaje no pueden estar vacíos", () => {
    expect(submitReason(state({ emailOn: true, contactHasEmail: false }), tpl)).toBe("Este contacto no tiene email.");
    expect(submitReason(state({ emailOn: true, email: { subject: " ", body: "x" } }), tpl)).toBe("Escribí el asunto del email.");
    expect(submitReason(state({ emailOn: true }), tpl)).toBeNull();
  });

  it("el email que se propone lleva el link de la pieza y habla del tipo de documento", () => {
    expect(initialEmail("constancia").subject).toBe("Tu constancia");
    expect(initialEmail(null).subject).toBe("Tu pieza");
    expect(initialEmail("constancia").body).toContain("{{design.link}}");
  });
});

describe("lo que se manda a generateOne", () => {
  const base: GenerateOneState = { contactId: "c1", rows: [], publish: true, emailOn: false, email: { subject: " Tu certificado ", body: " Acá " }, contactHasEmail: true, existing: null, replace: false };

  it("solo lo puesto a mano, con la publicación y sin email si no se pidió", () => {
    expect(buildGenerateOneInput("t1", base, { nombre: " Lu ", vacio: "  " })).toEqual({ templateId: "t1", contactId: "c1", overrides: { nombre: " Lu " }, publish: true, email: null });
  });

  it("con email: asunto y mensaje recortados", () => {
    expect(buildGenerateOneInput("t1", { ...base, emailOn: true }, {}).email).toEqual({ subject: "Tu certificado", body: "Acá" });
  });

  it("el reemplazo solo va si ya tenía una válida y se confirmó", () => {
    expect(buildGenerateOneInput("t1", { ...base, existing: { code: "X" }, replace: true }, {})).toMatchObject({ replaceExisting: true });
    expect(buildGenerateOneInput("t1", { ...base, existing: { code: "X" }, replace: false }, {})).not.toHaveProperty("replaceExisting");
    expect(buildGenerateOneInput("t1", { ...base, existing: null, replace: true }, {})).not.toHaveProperty("replaceExisting");
  });
});

describe("los textos salen del tipo de documento (verification.ts)", () => {
  it("el botón y el título cambian con el tipo, para los cuatro", () => {
    expect((["certificado", "constancia", "diploma"] as const).map((t) => issueButtonLabel({ verify: true, doc_type: t, doc_type_label: null }))).toEqual(["Emitir certificado", "Emitir constancia", "Emitir diploma"]);
    expect(issueButtonLabel({ verify: true, doc_type: "otro", doc_type_label: "Credencial" })).toBe("Emitir credencial");
    expect(issueButtonLabel({ verify: false, doc_type: null, doc_type_label: null })).toBe("Generar para…");
    expect(Object.keys(DOC_TYPE_LABELS)).toHaveLength(4);
  });

  it("el texto mientras se genera", () => {
    expect(busyLabel("Emitir constancia")).toBe("Emitiendo…");
    expect(busyLabel("Generar para…")).toBe("Generando…");
  });
});
