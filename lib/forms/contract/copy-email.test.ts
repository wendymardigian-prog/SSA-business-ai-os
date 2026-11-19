import { describe, it, expect } from "vitest";
import { copyEmailVariables, renderCopyEmail, stripUnresolvedFormLinks, unavailableFormLink } from "./copy-email";

const facts = {
  contactName: "María José Rojas",
  signerName: "Maria J. Rojas",
  signerEmail: "maria@x.com",
  workspaceName: "ALMA",
  title: "Políticas · Islandia",
  signedAtText: "12 de noviembre de 2026",
  serviceId: "22222222-2222-4222-8222-222222222222",
  saleId: null,
};

describe("copyEmailVariables", () => {
  it("usa el nombre del contacto y su primera palabra para saludar; servicio y venta solo si son ids", () => {
    const v = copyEmailVariables(facts);
    expect(v.contact).toMatchObject({ first_name: "María", name: "María José Rojas", email: "maria@x.com" });
    expect(v.service).toEqual({ id: facts.serviceId });
    expect(v.sale).toBeUndefined();
    expect(copyEmailVariables({ ...facts, serviceId: "no-es-un-id" }).service).toBeUndefined();
  });

  it("si el contacto tiene un nombre de relleno, usa el que escribió al firmar", () => {
    expect((copyEmailVariables({ ...facts, contactName: "@maria.rojas" }).contact as { name: string }).name).toBe("Maria J. Rojas");
    expect((copyEmailVariables({ ...facts, contactName: null }).contact as { name: string }).name).toBe("Maria J. Rojas");
  });
});

describe("renderCopyEmail", () => {
  it("pega las variables, respeta el respaldo vacío y deja los links a formularios para después", () => {
    const out = renderCopyEmail(
      { subject: "Hola, {{contact.first_name|}}. Firmaste {{contract.title}}", body: '<p>Hola, {{contact.first_name|}}.</p><p><a href="{{form_link.onb}}">Seguir</a></p>' },
      copyEmailVariables({ ...facts, contactName: "F", signerName: "" }),
    );
    expect(out.subject).toBe("Hola. Firmaste Políticas · Islandia");
    expect(out.bodyIsHtml).toBe(true);
    expect(out.body).toContain('href="{{form_link.onb}}"');
    expect(out.body).toContain("Hola.");
  });

  it("en un cuerpo HTML, los valores se escapan", () => {
    const out = renderCopyEmail({ subject: "x", body: "<p>{{contact.name}}</p>" }, copyEmailVariables({ ...facts, contactName: "<script>x</script> Ana" }));
    expect(out.body).not.toContain("<script>");
  });
});

describe("stripUnresolvedFormLinks", () => {
  it("saca los tokens que quedaron sin firmar", () => {
    expect(stripUnresolvedFormLinks('<a href="{{form_link.onb}}">Seguir</a> y {{ form_link.otro }}')).toBe('<a href="">Seguir</a> y ');
  });
});

describe("unavailableFormLink", () => {
  it("devuelve el primer formulario que no está publicado, o null", () => {
    expect(unavailableFormLink(["onboarding", "otro"], ["Onboarding"])).toBe("otro");
    expect(unavailableFormLink(["onboarding"], ["onboarding"])).toBeNull();
    expect(unavailableFormLink([], [])).toBeNull();
  });
});
