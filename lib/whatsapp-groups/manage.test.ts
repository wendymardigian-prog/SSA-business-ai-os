import { describe, it, expect } from "vitest";
import {
  GROUP_SUBJECT_MAX,
  inviteMessage,
  parsePhoneList,
  participantsSummary,
  settingActions,
  validateGroupDescription,
  validateGroupSubject,
  validateParticipantAction,
} from "./manage";

describe("validaciones de un grupo", () => {
  it("el nombre: obligatorio, sin espacios de mas y con el tope de WhatsApp", () => {
    expect(validateGroupSubject("  Clase   de IA ")).toEqual({ ok: true, value: "Clase de IA" });
    expect(validateGroupSubject("")).toMatchObject({ ok: false });
    expect(validateGroupSubject("x".repeat(GROUP_SUBJECT_MAX + 1))).toMatchObject({ ok: false });
  });

  it("la descripcion puede quedar vacia", () => {
    expect(validateGroupDescription(" ")).toEqual({ ok: true, value: "" });
    expect(validateGroupDescription("x".repeat(3000))).toMatchObject({ ok: false });
  });

  it("solo las cuatro acciones de miembros", () => {
    expect(["add", "remove", "promote", "demote", "borrar"].map(validateParticipantAction)).toEqual(["add", "remove", "promote", "demote", null]);
  });
});

describe("parsePhoneList", () => {
  it("separa por coma, punto y coma o renglon; normaliza y no repite", () => {
    expect(parsePhoneList("+54 9 11 1111-1111, 5491111111111;\n+506 7000 0000\nhola")).toEqual({
      phones: ["+5491111111111", "+50670000000"],
      invalid: ["hola"],
    });
    expect(parsePhoneList(["5491111111111", ""])).toEqual({ phones: ["+5491111111111"], invalid: [] });
    expect(parsePhoneList(null)).toEqual({ phones: [], invalid: [] });
  });
});

describe("settingActions", () => {
  it("solo lo que cambia", () => {
    expect(settingActions({ announce: false, restrict: false }, { announce: true, restrict: false })).toEqual(["announcement"]);
    expect(settingActions({ announce: true, restrict: true }, { announce: false, restrict: false })).toEqual(["not_announcement", "unlocked"]);
    expect(settingActions({ announce: true, restrict: false }, {})).toEqual([]);
  });
});

describe("textos", () => {
  it("la invitacion lleva el nombre y el link", () => {
    expect(inviteMessage("Clase", "https://chat.whatsapp.com/Abc")).toContain("«Clase»");
    expect(inviteMessage("Clase", "https://chat.whatsapp.com/Abc")).toContain("https://chat.whatsapp.com/Abc");
  });

  it("el resumen cuenta lo que salio, lo que necesita invitacion y lo que fallo", () => {
    expect(participantsSummary("add", [{ status: "ok" }, { status: "ok" }, { status: "needs_invite" }])).toBe(
      "2 personas agregadas. 1 no se pudo agregar por su privacidad: mandale el link.",
    );
    expect(participantsSummary("demote", [{ status: "ok" }])).toBe("1 persona ya no es admin.");
    expect(participantsSummary("remove", [])).toBe("WhatsApp no informó ningún cambio.");
  });
});
