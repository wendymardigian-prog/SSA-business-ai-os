import { describe, it, expect } from "vitest";
import { notifyRecipients, contactOutcome, notificationContent } from "./notify";

describe("notifyRecipients", () => {
  it("apagado: a nadie", () => {
    expect(notifyRecipients({ notifyEnabled: false, notifyUserIds: ["u1"] })).toEqual([]);
  });
  it("sin personas elegidas: Owner y Admin (null)", () => {
    expect(notifyRecipients({ notifyEnabled: true, notifyUserIds: [] })).toEqual([null]);
  });
  it("con personas: una por cada una, sin repetir", () => {
    expect(notifyRecipients({ notifyEnabled: true, notifyUserIds: ["u1", "u2", "u1", ""] })).toEqual(["u1", "u2"]);
  });
});

describe("contactOutcome", () => {
  it("distingue creado, vinculado y sin contacto", () => {
    expect(contactOutcome({ contactId: "c1", contactCreated: true })).toBe("created");
    expect(contactOutcome({ contactId: "c1", contactCreated: false })).toBe("linked");
    expect(contactOutcome({ contactId: null, contactCreated: false })).toBe("none");
  });
});

describe("notificationContent", () => {
  it("nombra el formulario y no lleva datos de la persona", () => {
    const { title, body } = notificationContent({ formName: "Aplicación", type: "custom", outcome: "created" });
    expect(title).toBe("Nueva respuesta en «Aplicación»");
    expect(body).toMatch(/contacto nuevo/);
  });
  it("la encuesta lo dice", () => {
    expect(notificationContent({ formName: "NPS", type: "survey", outcome: "none" }).title).toBe("Nueva respuesta a la encuesta «NPS»");
  });
  it("un nombre vacío no rompe el título", () => {
    expect(notificationContent({ formName: "  ", type: "custom", outcome: "linked" }).title).toBe("Nueva respuesta en «Formulario»");
  });
});
