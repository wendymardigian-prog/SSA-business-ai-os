import { describe, expect, it } from "vitest";
import { addToReach, classifyRecipient, emptyReach, type AudienceContact } from "./audience";

const base: AudienceContact = {
  id: "c1",
  phone: null,
  whatsapp_phone: null,
  email: null,
  email_status: "subscribed",
  do_not_contact: false,
  is_subscribed: true,
};

describe("WhatsApp", () => {
  it("quien ya escribió a este número: su id en el canal (también un @lid)", () => {
    expect(classifyRecipient(base, { kind: "whatsapp", linkedSenderId: "123@lid" })).toEqual({ ok: true, target: "123@lid", linked: true });
  });

  it("solo con teléfono: afuera salvo que se sume, y normalizado", () => {
    const c = { ...base, phone: "011 15 4444-5555", whatsapp_phone: "+54 9 11 4444 5555" };
    expect(classifyRecipient(c, { kind: "whatsapp" })).toEqual({ ok: false, reason: "phone_only_excluded" });
    expect(classifyRecipient(c, { kind: "whatsapp", includePhoneOnly: true })).toEqual({ ok: true, target: "+5491144445555", linked: false });
  });

  it("sin teléfono, no contactar y sin difusiones por chat", () => {
    expect(classifyRecipient(base, { kind: "whatsapp", includePhoneOnly: true })).toEqual({ ok: false, reason: "no_phone" });
    expect(classifyRecipient({ ...base, do_not_contact: true }, { kind: "whatsapp", linkedSenderId: "+1" })).toEqual({ ok: false, reason: "do_not_contact" });
    expect(classifyRecipient({ ...base, is_subscribed: false }, { kind: "whatsapp", linkedSenderId: "+1" })).toEqual({ ok: false, reason: "chat_unsubscribed" });
  });
});

describe("email (marketing)", () => {
  it("con email suscripto, sale", () => {
    expect(classifyRecipient({ ...base, email: " Ana@X.com " }, { kind: "email" })).toEqual({ ok: true, target: "ana@x.com", linked: true });
  });

  it("cada estado que no recibe marketing tiene su motivo", () => {
    for (const [status, reason] of [
      ["unsubscribed", "email_unsubscribed"],
      ["bounced", "email_bounced"],
      ["complained", "email_complained"],
      ["not_subscribed", "email_not_subscribed"],
    ] as const) {
      expect(classifyRecipient({ ...base, email: "a@x.com", email_status: status }, { kind: "email" })).toEqual({ ok: false, reason });
    }
  });

  it("sin email y no contactar", () => {
    expect(classifyRecipient(base, { kind: "email" })).toEqual({ ok: false, reason: "no_email" });
    expect(classifyRecipient({ ...base, email: "a@x.com", do_not_contact: true }, { kind: "email" })).toEqual({ ok: false, reason: "do_not_contact" });
  });

  it("is_subscribed (difusiones por chat) no aplica al email", () => {
    expect(classifyRecipient({ ...base, email: "a@x.com", is_subscribed: false }, { kind: "email" }).ok).toBe(true);
  });
});

describe("el resumen", () => {
  it("cuenta enviables, ya escribieron, solo teléfono y motivos", () => {
    const r = emptyReach();
    addToReach(r, { ok: true, target: "+1", linked: true });
    addToReach(r, { ok: true, target: "+2", linked: false });
    addToReach(r, { ok: false, reason: "phone_only_excluded" });
    addToReach(r, { ok: false, reason: "no_phone" });
    expect(r).toEqual({ total: 4, sendable: 2, linked: 1, phoneOnly: 2, skipped: { phone_only_excluded: 1, no_phone: 1 } });
  });
});
