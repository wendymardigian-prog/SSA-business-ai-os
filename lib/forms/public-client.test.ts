import { describe, it, expect } from "vitest";
import {
  answersForSubmit,
  buildPayload,
  buildSubmitFormData,
  checkClientFiles,
  describeFailure,
  isAvailable,
  paramsToRecord,
  submitLabelOf,
  toFormFields,
} from "./public-client";
import { newField } from "./fields";

describe("toFormFields", () => {
  it("completa lo que la definición pública no trae", () => {
    const [field] = toFormFields([{ key: "campana", type: "hidden", hidden: { source: "url_param", param: "utm_campaign" } }]);
    expect(field).toMatchObject({ key: "campana", label: "campana", required: false, hidden: { source: "url_param", param: "utm_campaign" } });
  });
});

describe("describeFailure", () => {
  it("errores por campo", () => {
    expect(describeFailure(400, { error: "invalid", fields: { email: "Ingresá un email válido" } })).toMatchObject({
      kind: "fields",
      fields: { email: "Ingresá un email válido" },
    });
  });

  it("ya respondió, el formulario cambió y no disponible", () => {
    expect(describeFailure(409, { error: "already_answered" }).kind).toBe("already_answered");
    expect(describeFailure(409, { error: "form_changed" }).kind).toBe("form_changed");
    expect(describeFailure(404, { error: "unavailable" }).kind).toBe("unavailable");
  });

  it("cualquier otra cosa es un error general con un mensaje que dice qué hacer", () => {
    const failure = describeFailure(500, null);
    expect(failure.kind).toBe("general");
    expect(failure.message).toMatch(/Probá de nuevo/);
    expect(describeFailure(429, {}).kind).toBe("general");
  });
});

describe("checkClientFiles", () => {
  const field = { ...newField("file", "cv", "CV"), file: { accept: ["application/pdf"], maxMb: 1, maxFiles: 1 }, required: true };

  it("obligatorio sin archivos", () => {
    expect(checkClientFiles(field, [])).toMatch(/al menos un archivo/);
    expect(checkClientFiles({ ...field, required: false }, [])).toBeNull();
  });

  it("tamaño, cantidad y tipo", () => {
    expect(checkClientFiles(field, [{ name: "a.pdf", size: 2 * 1024 * 1024, type: "application/pdf" }])).toMatch(/pesa más de 1 MB/);
    expect(checkClientFiles(field, [{ name: "a.pdf", size: 10, type: "application/pdf" }, { name: "b.pdf", size: 10, type: "application/pdf" }])).toMatch(/hasta 1 archivo/);
    expect(checkClientFiles(field, [{ name: "a.exe", size: 10, type: "application/x-msdownload" }])).toMatch(/no está permitido/);
    expect(checkClientFiles(field, [{ name: "a.pdf", size: 10, type: "application/pdf" }])).toBeNull();
  });
});

describe("el pedido", () => {
  it("buildPayload arma la forma que valida el servidor", () => {
    const payload = buildPayload({
      idempotencyKey: "k",
      versionId: "v",
      answers: { a: 1 },
      honeypot: "",
      attribution: { utm_source: "meta" },
      timezone: "America/Costa_Rica",
      origin: "site",
      sitePath: "/contacto",
    });
    expect(payload).toMatchObject({
      idempotency_key: "k",
      version_id: "v",
      honeypot: "",
      client_meta: { timezone: "America/Costa_Rica" },
      origin: "site",
      site_path: "/contacto",
    });
    expect(payload).not.toHaveProperty("signature");
  });

  it("buildSubmitFormData: un campo payload y los archivos como file:<clave>", () => {
    const file = new File(["%PDF-1.4 hola mundo"], "cv.pdf", { type: "application/pdf" });
    const form = buildSubmitFormData({ a: 1 }, { cv: [file] });
    expect(JSON.parse(String(form.get("payload")))).toEqual({ a: 1 });
    expect((form.get("file:cv") as File).name).toBe("cv.pdf");
  });

  it("answersForSubmit pasa números como números y no manda vacíos ni archivos", () => {
    const fields = [newField("number", "n", "n"), newField("nps", "nps", "nps"), newField("short_text", "t", "t"), newField("file", "f", "f")];
    expect(answersForSubmit(fields, { n: "5", nps: 9, t: "", f: "x" })).toEqual({ n: 5, nps: 9 });
  });
});

describe("otras", () => {
  it("isAvailable", () => {
    expect(isAvailable({ status: "unavailable" })).toBe(false);
    expect(isAvailable(null)).toBe(false);
  });

  it("submitLabelOf", () => {
    expect(submitLabelOf({ submitLabel: "Aplicar" }, "custom")).toBe("Aplicar");
    expect(submitLabelOf({}, "custom")).toBe("Enviar");
    expect(submitLabelOf({}, "contract")).toBe("Firmar y enviar");
  });

  it("paramsToRecord", () => {
    expect(paramsToRecord("?a=1&b=2&a=3")).toEqual({ a: "1", b: "2" });
  });
});
