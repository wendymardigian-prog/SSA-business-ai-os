import { describe, it, expect } from "vitest";
import { EMPTY_INBOX_FILTERS, countActiveFilters, type InboxFilters } from "./filters";
import { countMenuFilters, describeInboxFilters } from "./filter-summary";

const catalog = {
  platforms: [
    { value: "instagram", label: "Instagram" },
    { value: "whatsapp", label: "WhatsApp" },
    { value: "email", label: "Email" },
  ],
  tags: [
    { id: "t1", name: "vip" },
    { id: "t2", name: "frio" },
  ],
  members: [{ userId: "u1", label: "Ana" }],
};

const f = (over: Partial<InboxFilters>): InboxFilters => ({ ...EMPTY_INBOX_FILTERS, ...over });

describe("countMenuFilters (el numero del boton, I3)", () => {
  it("sin nada, cero", () => {
    expect(countMenuFilters(EMPTY_INBOX_FILTERS)).toBe(0);
  });

  it("la busqueda y el estado no cuentan: viven afuera del popover", () => {
    const filters = f({ search: "ana", status: "closed" });
    expect(countActiveFilters(filters)).toBe(2);
    expect(countMenuFilters(filters)).toBe(0);
  });

  it("tres cosas puestas adentro son tres, haya o no busqueda", () => {
    const three = f({ platforms: ["instagram"], tagIds: ["t1", "t2"], needsHuman: true });
    expect(countMenuFilters(three)).toBe(3);
    expect(countMenuFilters({ ...three, search: "ana", status: "all" })).toBe(3);
  });

  it("cuenta igual que countActiveFilters para todo lo que si esta adentro", () => {
    const all = f({
      platforms: ["instagram"],
      tagIds: ["t1"],
      assignment: "u1",
      datePreset: "7d",
      agentError: true,
      needsHuman: true,
    });
    expect(countMenuFilters(all)).toBe(countActiveFilters(all));
  });
});

describe("describeInboxFilters (la linea de resumen, I3)", () => {
  it("el ejemplo del documento: Abiertas · Instagram · 2 tags", () => {
    expect(describeInboxFilters(f({ platforms: ["instagram"], tagIds: ["t1", "t2"] }), catalog)).toEqual([
      "Abiertas",
      "Instagram",
      "2 tags",
    ]);
  });

  it("siempre arranca por el estado", () => {
    expect(describeInboxFilters(f({ status: "snoozed" }), catalog)).toEqual(["Pospuestas"]);
  });

  it("muestra la busqueda entre comillas", () => {
    expect(describeInboxFilters(f({ search: "ana" }), catalog)).toEqual(["Abiertas", '"ana"']);
  });

  it("dos canales se nombran, tres se cuentan", () => {
    expect(describeInboxFilters(f({ platforms: ["instagram", "whatsapp"] }), catalog)).toEqual([
      "Abiertas",
      "Instagram",
      "WhatsApp",
    ]);
    expect(
      describeInboxFilters(f({ platforms: ["instagram", "whatsapp", "email"] }), catalog),
    ).toEqual(["Abiertas", "3 canales"]);
  });

  it("un tag se nombra", () => {
    expect(describeInboxFilters(f({ tagIds: ["t1"] }), catalog)).toEqual(["Abiertas", "#vip"]);
  });

  it("la asignacion se dice con el nombre de la persona", () => {
    expect(describeInboxFilters(f({ assignment: "u1" }), catalog)).toContain("Asignadas a Ana");
    expect(describeInboxFilters(f({ assignment: "sin-asignar" }), catalog)).toContain("Sin asignar");
    expect(describeInboxFilters(f({ assignment: "agente-ia" }), catalog)).toContain(
      "Asignadas al agente IA",
    );
  });

  it("la fecha: el preset, o el rango con las dos puntas", () => {
    expect(describeInboxFilters(f({ datePreset: "7d" }), catalog)).toContain("Ultimos 7 dias");
    expect(
      describeInboxFilters(
        f({ datePreset: "custom", dateFrom: "2026-09-01", dateTo: "2026-09-15" }),
        catalog,
      ),
    ).toContain("Del 1/9 al 15/9");
    expect(describeInboxFilters(f({ datePreset: "custom" }), catalog)).toContain("Rango personalizado");
  });

  it("las dos marcas del agente", () => {
    expect(describeInboxFilters(f({ agentError: true, needsHuman: true }), catalog)).toEqual([
      "Abiertas",
      "Con error del agente",
      "Necesita humano",
    ]);
  });
});

describe("las cuentas en el resumen y en el contador", () => {
  const accounts = [
    { id: "a1", platform: "instagram", label: "@marca_principal" },
    { id: "a2", platform: "instagram", label: "@marca_academia" },
    { id: "a3", platform: "whatsapp", label: "WhatsApp" },
  ];
  const cat = { ...catalog, accounts, multiPlatforms: ["instagram"] };

  it("el menu de Canal tiene su propio boton: las cuentas no suman al contador de Filtros", () => {
    const filters = f({ channelIds: ["a1", "a2"] });
    expect(countActiveFilters(filters)).toBe(1);
    expect(countMenuFilters(filters)).toBe(0);
  });

  it("con una o dos cuentas las nombra; con una red de varias cuentas, junto a la red", () => {
    expect(describeInboxFilters(f({ channelIds: ["a2"] }), cat)).toEqual(["Abiertas", "Instagram @marca_academia"]);
    expect(describeInboxFilters(f({ channelIds: ["a1", "a3"] }), cat)).toEqual(["Abiertas", "Instagram @marca_principal", "WhatsApp"]);
  });

  it("con mas de dos, las cuenta", () => {
    expect(describeInboxFilters(f({ channelIds: ["a1", "a2", "a3"] }), cat)).toEqual(["Abiertas", "3 cuentas"]);
  });

  it("una cuenta que ya no esta en el catalogo no rompe el resumen", () => {
    expect(describeInboxFilters(f({ channelIds: ["borrada"] }), cat)).toEqual(["Abiertas", "Cuenta 1"]);
  });
});
