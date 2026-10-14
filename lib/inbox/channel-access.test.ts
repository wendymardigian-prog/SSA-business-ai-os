import { describe, expect, it } from "vitest";
import { SYSTEM_ROLE_PERMISSIONS } from "@/lib/auth/permissions";
import { canReplyOn, canViewPlatform, inboxChannelOf, platformFilterFor, visibleChannels } from "./channel-access";

const canOf = (keys: string[]) => (key: string) => keys.includes(key);

describe("visibleChannels (F20)", () => {
  it("un rol con solo inbox.whatsapp.view ve WhatsApp y ningún otro canal", () => {
    expect(visibleChannels(canOf(["inbox.whatsapp.view"]))).toEqual(["whatsapp"]);
  });

  it("el Member de sistema y los Admin ven los tres", () => {
    for (const keys of [SYSTEM_ROLE_PERMISSIONS.member.keys, SYSTEM_ROLE_PERMISSIONS.admin.keys, SYSTEM_ROLE_PERMISSIONS.owner.keys]) {
      expect(visibleChannels(canOf(keys))).toEqual(["instagram", "whatsapp", "email"]);
    }
  });

  it("sin ninguna clave de bandeja no ve ninguno", () => {
    expect(visibleChannels(canOf(["contacts.view"]))).toEqual([]);
  });
});

describe("filtro de la lista de conversaciones", () => {
  const all = ["instagram", "whatsapp", "email"];

  it("un rol con solo WhatsApp pide solo conversaciones de WhatsApp (nunca Instagram ni email)", () => {
    expect(platformFilterFor(canOf(["inbox.whatsapp.view"]), all)).toEqual(["whatsapp"]);
  });

  it("quien ve todos no filtra nada", () => {
    expect(platformFilterFor(canOf(SYSTEM_ROLE_PERMISSIONS.member.keys), all)).toBeNull();
  });

  it("sin ninguna clave devuelve una lista vacía: no se ve ninguna conversación", () => {
    expect(platformFilterFor(canOf([]), all)).toEqual([]);
  });
});

describe("canReplyOn (F20)", () => {
  it("responder en Instagram pide inbox.instagram.reply, no basta con verlo ni con tener el de otro canal", () => {
    expect(canReplyOn(canOf(["inbox.instagram.view"]), "instagram")).toBe(false);
    expect(canReplyOn(canOf(["inbox.whatsapp.reply"]), "instagram")).toBe(false);
    expect(canReplyOn(canOf(["inbox.instagram.reply"]), "instagram")).toBe(true);
  });

  it("una plataforma sin clave propia se contesta con 'responder' en algún canal", () => {
    expect(inboxChannelOf("telegram")).toBeNull();
    expect(canReplyOn(canOf(["inbox.email.reply"]), "telegram")).toBe(true);
    expect(canReplyOn(canOf([]), "telegram")).toBe(false);
    expect(canViewPlatform(canOf(["inbox.email.view"]), "telegram")).toBe(true);
  });
});
