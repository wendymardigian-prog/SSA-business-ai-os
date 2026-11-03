import { describe, it, expect } from "vitest";
import { importRetryDelayMinutes, mergeGroupLists } from "./settings";

const live = (jid: string, subject: string) => ({ jid, subject, size: 10, pictureUrl: null, isCommunity: false, announce: false });
const saved = (jid: string, over: Record<string, unknown> = {}) => ({ id: `id-${jid}`, group_jid: jid, subject: `Guardado ${jid}`, in_inbox: true, save_contacts: false, left_at: null, ...over });

describe("mergeGroupLists", () => {
  it("los activados primero, despues por nombre; cada uno con lo guardado", () => {
    const list = mergeGroupLists([live("1@g.us", "Zeta"), live("2@g.us", "alfa"), live("3@g.us", "Beta")], [saved("3@g.us")]);
    expect(list.map((g) => g.subject)).toEqual(["Beta", "alfa", "Zeta"]);
    expect(list[0].saved).toEqual({ id: "id-3@g.us", inInbox: true, saveContacts: false });
    expect(list[1].saved).toBeNull();
  });

  it("un grupo activado del que el numero ya no es parte sigue en la lista, marcado, para poder apagarlo", () => {
    const list = mergeGroupLists([], [saved("9@g.us", { save_contacts: true })]);
    expect(list).toEqual([{ jid: "9@g.us", subject: "Guardado 9@g.us", size: null, missing: true, saved: { id: "id-9@g.us", inInbox: true, saveContacts: true } }]);
  });

  it("uno guardado pero apagado y que ya no esta, no aparece", () => {
    expect(mergeGroupLists([], [saved("9@g.us", { in_inbox: false })])).toEqual([]);
  });
});

describe("importRetryDelayMinutes", () => {
  it("1, 5 y 15 minutos; despues se deja", () => {
    expect([1, 2, 3, 4].map(importRetryDelayMinutes)).toEqual([1, 5, 15, null]);
  });
});
