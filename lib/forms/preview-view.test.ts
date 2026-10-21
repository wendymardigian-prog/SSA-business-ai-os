import { describe, expect, it } from "vitest";
import { buildPreviewData, previewEnding } from "./preview-view";
import { defaultDesign } from "./defaults";
import { newField } from "./fields";

describe("buildPreviewData (F8)", () => {
  const fields = [newField("short_text", "nombre", "Nombre"), newField("hidden", "ref", "ref")];

  it("arma lo que veria quien responde: sin los campos que no se publican y con el diseno del borrador", () => {
    const data = buildPreviewData({ type: "custom", slug: "mi-form", design: { ...defaultDesign("Interno"), title: "Aplicá" }, definition: { fields } });
    expect(data).toMatchObject({ status: "available", slug: "mi-form", type: "custom", version_id: "preview", signature_required: false, contract: null, survey: null });
    expect(data.design.title).toBe("Aplicá");
    expect(data.fields.map((f) => f.key)).toEqual(["nombre", "ref"]);
  });

  it("un contrato lleva su texto, el titulo y la firma", () => {
    const data = buildPreviewData({
      type: "contract",
      slug: "c",
      design: defaultDesign("C"),
      definition: { fields: [], contractText: "1. Objeto" },
      contract: { title: "Acuerdo", acceptLabel: "Acepto", signatureRequired: false },
    });
    expect(data.contract).toEqual({ text: "1. Objeto", version_number: 0, title: "Acuerdo", accept_label: "Acepto", mode: "terms", business_signer: null });
    expect(data.signature_required).toBe(false);
  });

  it("modo Contrato con la firma de ambas partes: lleva el modo y la firma del negocio (con su link temporal)", () => {
    const data = buildPreviewData({
      type: "contract",
      slug: "c",
      design: defaultDesign("C"),
      definition: { fields: [], contractText: "Entre {{respuesta.empresa}}" },
      contract: { title: "A", acceptLabel: "Acepto", signatureRequired: true, mode: "contract", businessSigner: { enabled: true, name: "Laura", role: "Directora" }, signatureUrl: "https://x/firma.png" },
    });
    expect(data.contract).toMatchObject({ mode: "contract", business_signer: { name: "Laura", role: "Directora", signature_url: "https://x/firma.png" } });
  });

  it("un contrato sin configuracion pide firma por defecto; un personalizado nunca", () => {
    expect(buildPreviewData({ type: "contract", slug: "c", design: defaultDesign("C"), definition: { fields: [] } }).signature_required).toBe(true);
    expect(buildPreviewData({ type: "custom", slug: "c", design: defaultDesign("C"), definition: { fields: [] }, contract: { title: "x", acceptLabel: "x", signatureRequired: true } }).signature_required).toBe(false);
  });
});

describe("previewEnding (F8)", () => {
  const context = { formName: "Aplicación", answers: { nombre: "Ana" } };

  it("un mensaje se ve como lo ve la persona, con las variables resueltas", () => {
    expect(previewEnding({ mode: "message", title: "¡Gracias, {{answer.nombre}}!", body: "Recibimos tu {{form.name}}." }, context)).toEqual({
      mode: "message",
      title: "¡Gracias, Ana!",
      body: "Recibimos tu Aplicación.",
    });
  });

  it("el boton del mensaje se conserva", () => {
    const out = previewEnding({ mode: "message", title: "Listo", button: { label: "Agendar", url: "https://ejemplo.test/agenda" } }, context);
    expect(out.button).toEqual({ label: "Agendar", url: "https://ejemplo.test/agenda" });
  });

  it("una variable sin respuesta queda vacia, nunca cruda", () => {
    expect(previewEnding({ mode: "message", title: "Hola {{answer.otro}}" }, context).title).toBe("Hola ");
  });

  it("una redireccion dice a donde llevaria y no se ejecuta", () => {
    expect(previewEnding({ mode: "redirect", url: "https://ejemplo.test/gracias", passParams: false }, context)).toEqual({
      mode: "message",
      title: "",
      body: "Acá la persona va a https://ejemplo.test/gracias.",
    });
    expect(previewEnding({ mode: "redirect", url: "https://ejemplo.test/gracias", passParams: true }, context).body).toContain("Se le suman el id de la respuesta y los UTM");
  });

  it("una direccion a medias no rompe: lo dice", () => {
    const out = previewEnding({ mode: "redirect", url: "ejemplo", passParams: false }, context);
    expect(out.mode).toBe("message");
    expect(out.body).toContain("todavía no es válida");
  });

  it("sin configuracion usa un mensaje vacio valido", () => {
    expect(previewEnding(null, context).mode).toBe("message");
  });
});
