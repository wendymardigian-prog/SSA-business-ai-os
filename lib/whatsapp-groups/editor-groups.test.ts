import { describe, it, expect } from "vitest";
import { editorGroupSections } from "./editor-groups";

const g = (id: string, subject: string, over: Record<string, unknown> = {}) => ({ id, subject, channelLabel: "WhatsApp +1", inInbox: true, saveContacts: false, ...over });

describe("editorGroupSections", () => {
  it("cada comunidad con Avisos primero, y los sueltos al final", () => {
    const sections = editorGroupSections([
      g("1", "Suelto"),
      g("2", "Zeta", { communitySubject: "Mi comunidad" }),
      g("3", "Mi comunidad", { communitySubject: "Mi comunidad", kind: "announce" }),
      g("4", "Alfa", { communitySubject: "Mi comunidad" }),
    ]);
    expect(sections).toEqual([
      { label: "Comunidad Mi comunidad", groups: [{ id: "3", label: "Avisos" }, { id: "4", label: "Alfa" }, { id: "2", label: "Zeta" }] },
      { label: "Grupos sueltos", groups: [{ id: "1", label: "Suelto" }] },
    ]);
  });

  it("con mas de un numero, cada grupo dice de cual es", () => {
    const sections = editorGroupSections([g("1", "A"), g("2", "B", { channelLabel: "WhatsApp +2" })]);
    expect(sections[0].groups.map((x) => x.label)).toEqual(["A · WhatsApp +1", "B · WhatsApp +2"]);
  });
});
