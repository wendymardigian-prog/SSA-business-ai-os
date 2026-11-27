import { describe, it, expect } from "vitest";
import { EMPTY_INBOX_FILTERS, parseListType, type InboxFilters } from "./filters";
import { groupsCanMatch, groupsForLoaded, mergeInboxRows } from "./unified-list";

const f = (over: Partial<InboxFilters>): InboxFilters => ({ ...EMPTY_INBOX_FILTERS, ...over });
const at = (hour: number) => `2026-11-06T${String(hour).padStart(2, "0")}:00:00+00:00`;
const group = (id: string, lastMessageAt: string | null) => ({ id, lastMessageAt });
const chat = (id: string, last_message_at: string | null) => ({ id, last_message_at });

describe("parseListType", () => {
  it("acepta chats y grupos; lo demas es los dos", () => {
    expect(parseListType("chats")).toBe("chats");
    expect(parseListType("grupos")).toBe("grupos");
    expect(parseListType("")).toBe("");
    expect(parseListType("inventado")).toBe("");
  });

  it("un favorito con ?vista=grupos sigue abriendo solo los grupos, salvo que ?tipo= diga otra cosa", () => {
    expect(parseListType("", "grupos")).toBe("grupos");
    expect(parseListType("chats", "grupos")).toBe("chats");
  });
});

describe("groupsCanMatch", () => {
  it("por defecto entran (Abiertas, sin filtros)", () => {
    expect(groupsCanMatch(EMPTY_INBOX_FILTERS)).toBe(true);
    expect(groupsCanMatch(f({ listType: "grupos" }))).toBe(true);
    expect(groupsCanMatch(f({ status: "all" }))).toBe(true);
  });

  it("Solo chats los saca", () => {
    expect(groupsCanMatch(f({ listType: "chats" }))).toBe(false);
  });

  it("un grupo nunca esta cerrado ni pospuesto", () => {
    expect(groupsCanMatch(f({ status: "closed" }))).toBe(false);
    expect(groupsCanMatch(f({ status: "snoozed" }))).toBe(false);
  });

  it("lo que un grupo no tiene lo saca", () => {
    for (const over of [
      { tagIds: ["t"] },
      { assignment: "mias" },
      { agentError: true },
      { needsHuman: true },
      { awaiting: "responder" as const },
      { onlyUnidentified: true },
    ]) {
      expect(groupsCanMatch(f(over))).toBe(false);
    }
  });

  it("ocultar conocidos y clientes no lo saca: un grupo no es un contacto", () => {
    expect(groupsCanMatch(f({ hideKnown: true, hideCustomers: true }))).toBe(true);
  });

  it("el ?canal= viejo solo lo deja con WhatsApp", () => {
    expect(groupsCanMatch(f({ platforms: ["instagram"] }))).toBe(false);
    expect(groupsCanMatch(f({ platforms: ["instagram", "whatsapp"] }))).toBe(true);
  });
});

describe("groupsForLoaded", () => {
  const groups = [group("muy-nuevo", at(23)), group("medio", at(15)), group("viejo", at(5)), group("sin-mensajes", null)];

  it("con mas para cargar, solo los que no son mas viejos que la ultima conversacion cargada", () => {
    expect(groupsForLoaded(groups, at(12), true).map((g) => g.id)).toEqual(["muy-nuevo", "medio"]);
  });

  it("un grupo a la misma hora que la ultima cargada ya se muestra", () => {
    expect(groupsForLoaded([group("empate", at(12))], at(12), true).map((g) => g.id)).toEqual(["empate"]);
  });

  it("sin nada mas para cargar, todos, tambien los que no tienen mensajes", () => {
    expect(groupsForLoaded(groups, at(12), false)).toEqual(groups);
  });

  it("sin conversaciones cargadas, todos", () => {
    expect(groupsForLoaded(groups, undefined, false)).toEqual(groups);
  });
});

describe("mergeInboxRows", () => {
  const ids = (items: ReturnType<typeof mergeInboxRows<ReturnType<typeof chat>, ReturnType<typeof group>>>) => items.map((i) => i.row.id);

  it("intercala de mas nuevo a mas viejo", () => {
    const items = mergeInboxRows([chat("c1", at(20)), chat("c2", at(10))], [group("g1", at(22)), group("g2", at(15)), group("g3", at(1))]);
    expect(ids(items)).toEqual(["g1", "c1", "g2", "c2", "g3"]);
    expect(items[0].kind).toBe("group");
    expect(items[1].kind).toBe("conversation");
  });

  it("a la misma hora va primero la conversacion", () => {
    expect(ids(mergeInboxRows([chat("c", at(10))], [group("g", at(10))]))).toEqual(["c", "g"]);
  });

  it("no reordena las conversaciones aunque vengan en otro orden (lo decide la base)", () => {
    expect(ids(mergeInboxRows([chat("nulo", null), chat("c", at(1))], []))).toEqual(["nulo", "c"]);
  });

  it("una lista vacia no rompe nada", () => {
    expect(mergeInboxRows([], [])).toEqual([]);
    expect(ids(mergeInboxRows([], [group("g", null)]))).toEqual(["g"]);
    expect(ids(mergeInboxRows([chat("c", null)], []))).toEqual(["c"]);
  });
});
