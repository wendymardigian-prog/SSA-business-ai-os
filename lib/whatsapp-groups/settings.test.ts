import { describe, it, expect } from "vitest";
import { cannotWriteReason, groupDisplayName, groupListSections, importRetryDelayMinutes, liveGroupColumns, mergeGroupLists } from "./settings";
import type { EvolutionGroup } from "@/lib/evolution-client";

const live = (jid: string, subject: string, over: Partial<EvolutionGroup> = {}): EvolutionGroup => ({
  jid,
  subject,
  size: 10,
  pictureUrl: null,
  isCommunity: false,
  isCommunityAnnounce: false,
  parentJid: null,
  description: null,
  announce: false,
  restrict: false,
  numberIsAdmin: null,
  ...over,
});
const saved = (jid: string, over: Record<string, unknown> = {}) => ({ id: `id-${jid}`, group_jid: jid, subject: `Guardado ${jid}`, in_inbox: true, save_contacts: false, left_at: null, ...over });

describe("mergeGroupLists", () => {
  it("los activados primero, despues por nombre; cada uno con lo guardado", () => {
    const list = mergeGroupLists([live("1@g.us", "Zeta"), live("2@g.us", "alfa"), live("3@g.us", "Beta")], [saved("3@g.us")]);
    expect(list.map((g) => g.subject)).toEqual(["Beta", "alfa", "Zeta"]);
    expect(list[0].saved).toEqual({ id: "id-3@g.us", inInbox: true, saveContacts: false });
    expect(list[1].saved).toBeNull();
  });

  it("un grupo activado del que el numero ya no es parte sigue en la lista, marcado, con su comunidad guardada", () => {
    const list = mergeGroupLists([], [saved("9@g.us", { save_contacts: true, parent_group_jid: "5@g.us", community_subject: "Mi comunidad" })]);
    expect(list).toEqual([
      {
        jid: "9@g.us",
        subject: "Guardado 9@g.us",
        size: null,
        kind: "group",
        communityJid: "5@g.us",
        communitySubject: "Mi comunidad",
        announce: false,
        numberIsAdmin: null,
        missing: true,
        saved: { id: "id-9@g.us", inInbox: true, saveContacts: true },
      },
    ]);
  });

  it("uno guardado pero apagado y que ya no esta, no aparece", () => {
    expect(mergeGroupLists([], [saved("9@g.us", { in_inbox: false })])).toEqual([]);
  });

  it("la comunidad madre no es un item: le da el nombre a sus grupos, y el de Avisos queda marcado", () => {
    const list = mergeGroupLists(
      [
        live("100@g.us", "Mi comunidad", { isCommunity: true }),
        live("101@g.us", "Mi comunidad", { isCommunityAnnounce: true, parentJid: "100@g.us", announce: true }),
        live("102@g.us", "Clase", { parentJid: "100@g.us" }),
      ],
      [],
    );
    expect(list.map((g) => [g.jid, g.kind, g.communitySubject])).toEqual([
      ["102@g.us", "group", "Mi comunidad"],
      ["101@g.us", "announce", "Mi comunidad"],
    ]);
  });
});

describe("groupListSections", () => {
  it("cada comunidad con Avisos primero y despues los activos; los sueltos al final", () => {
    const items = mergeGroupLists(
      [
        live("200@g.us", "Zeta comunidad", { isCommunity: true }),
        live("201@g.us", "Zeta comunidad", { isCommunityAnnounce: true, parentJid: "200@g.us" }),
        live("202@g.us", "Bravo", { parentJid: "200@g.us" }),
        live("203@g.us", "Alfa", { parentJid: "200@g.us" }),
        live("100@g.us", "Academia", { isCommunity: true }),
        live("101@g.us", "Grupo A", { parentJid: "100@g.us" }),
        live("300@g.us", "Suelto"),
      ],
      [saved("202@g.us")],
    );
    const sections = groupListSections(items);
    expect(sections.map((s) => s.community?.subject ?? null)).toEqual(["Academia", "Zeta comunidad", null]);
    expect(sections[1].items.map((i) => i.jid)).toEqual(["201@g.us", "202@g.us", "203@g.us"]);
    expect(sections[2].items.map((i) => i.subject)).toEqual(["Suelto"]);
  });

  it("sin grupos sueltos no hay seccion vacia; una comunidad sin nombre se llama «Comunidad»", () => {
    const sections = groupListSections(mergeGroupLists([live("101@g.us", "G", { parentJid: "100@g.us" })], []));
    expect(sections).toEqual([expect.objectContaining({ community: { jid: "100@g.us", subject: "Comunidad" } })]);
  });
});

describe("liveGroupColumns", () => {
  it("guarda tipo, comunidad y permisos; un admin desconocido no pisa lo anterior", () => {
    const cols = liveGroupColumns(live("101@g.us", "Mi comunidad", { isCommunityAnnounce: true, parentJid: "100@g.us", announce: true }), "Mi comunidad");
    expect(cols).toMatchObject({ kind: "announce", parent_group_jid: "100@g.us", community_subject: "Mi comunidad", announce: true });
    expect(cols).not.toHaveProperty("number_is_admin");
    expect(liveGroupColumns(live("1@g.us", "x", { numberIsAdmin: false }), "ignorado")).toMatchObject({ number_is_admin: false, community_subject: null, kind: "group" });
  });
});

describe("groupDisplayName y cannotWriteReason", () => {
  it("el de Avisos se llama Avisos; un grupo suelto no tiene comunidad", () => {
    expect(groupDisplayName({ subject: "Mi comunidad", kind: "announce", communitySubject: "Mi comunidad" })).toEqual({ community: "Mi comunidad", name: "Avisos" });
    expect(groupDisplayName({ subject: "Clase", kind: "group", communitySubject: null })).toEqual({ community: null, name: "Clase" });
  });

  it("solo frena cuando se sabe que el numero no es admin de un grupo donde solo escriben admins", () => {
    expect(cannotWriteReason({ announce: true, numberIsAdmin: false })).toMatch(/Solo los admins/);
    expect(cannotWriteReason({ announce: true, numberIsAdmin: null })).toBeNull();
    expect(cannotWriteReason({ announce: false, numberIsAdmin: false })).toBeNull();
  });
});

describe("importRetryDelayMinutes", () => {
  it("1, 5 y 15 minutos; despues se deja", () => {
    expect([1, 2, 3, 4].map(importRetryDelayMinutes)).toEqual([1, 5, 15, null]);
  });
});
