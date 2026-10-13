import { describe, expect, it } from "vitest";
import { ALL_COLUMN_IDS, COLUMNS, columnsOfGroup, formatCell } from "./ads-crm-columns";
import { defaultPrefs, loadPrefs, moveColumn, orderedGroup, parsePrefs, resetPrefs, savePrefs, serializePrefs, storageKey, toggleColumn, visibleColumns, type KeyValueStorage } from "./ads-columns";
import type { CrmRow } from "./ads-crm";

const memory = (initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } => {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
};

const throwing: KeyValueStorage = {
  getItem() {
    throw new Error("SecurityError: el almacenamiento esta bloqueado");
  },
  setItem() {
    throw new Error("QuotaExceededError");
  },
};

describe("las columnas por defecto", () => {
  it("son las que pide el plano", () => {
    const labels = defaultPrefs().visible.map((id) => COLUMNS.find((c) => c.id === id)!.label);
    expect(labels.sort()).toEqual(["Agendas", "CPL real", "CTR", "Costo por agenda", "Gasto", "Impr.", "Leads CRM", "Leads Meta", "ROAS", "Revenue", "Ventas"].sort());
  });

  it("estan los tres grupos con todas las columnas del plano", () => {
    expect(columnsOfGroup("metaVsCrm").map((c) => c.label)).toEqual(["Leads Meta", "Leads CRM", "Agendas Meta", "Agendas CRM"]);
    expect(columnsOfGroup("crm").map((c) => c.label)).toEqual([
      "Leads 1er toque", "Leads totales", "Agendas", "Asistidas", "Lead → Agenda", "CPL real", "Costo por agenda",
      "Ventas", "Revenue", "Cash", "ROAS", "ROAS cash", "CAC", "Costo por cierre",
    ]);
  });

  it("cada columna tiene un tooltip con titulo y explicacion", () => {
    for (const c of COLUMNS) {
      expect(c.tip.title.length, c.id).toBeGreaterThan(2);
      expect(c.tip.body.length, c.id).toBeGreaterThan(15);
    }
  });
});

describe("guardar y leer", () => {
  it("lo que se guarda se lee igual, por nivel", () => {
    const storage = memory();
    const prefs = toggleColumn(defaultPrefs(), "cash");
    expect(savePrefs("campaign", prefs, storage)).toBe(true);
    expect(loadPrefs("campaign", storage)).toEqual(prefs);
    expect(loadPrefs("ad", storage)).toEqual(defaultPrefs());
    expect(Object.keys(storage.data)).toEqual([storageKey("campaign")]);
    expect(storageKey("adset")).toBe("ssa:ads-columns:adset");
  });

  it("un localStorage que LANZA da las columnas por defecto (al leer) y no rompe (al guardar)", () => {
    expect(loadPrefs("ad", throwing)).toEqual(defaultPrefs());
    expect(savePrefs("ad", defaultPrefs(), throwing)).toBe(false);
    expect(loadPrefs("ad", null)).toEqual(defaultPrefs());
    expect(savePrefs("ad", defaultPrefs(), undefined)).toBe(false);
  });

  it("lo guardado roto o con basura da las columnas por defecto", () => {
    for (const raw of ["no es json", "null", "42", '{"order": 3}', '{"order": [], "visible": []}', "", null]) {
      expect(parsePrefs(raw as string | null), String(raw)).toEqual(defaultPrefs());
    }
  });

  it("descarta columnas desconocidas y repetidas, y suma las nuevas al final, ocultas", () => {
    const raw = JSON.stringify({ order: ["roas", "inventada", "roas", "spend"], visible: ["roas", "inventada", "spend", "roas"] });
    const prefs = parsePrefs(raw);
    expect(prefs.visible).toEqual(["roas", "spend"]);
    expect(prefs.order.slice(0, 2)).toEqual(["roas", "spend"]);
    expect([...prefs.order].sort()).toEqual([...ALL_COLUMN_IDS].sort());
  });
});

describe("prender, apagar y mover", () => {
  it("prende y apaga, pero no deja la tabla sin columnas", () => {
    let prefs = defaultPrefs();
    prefs = toggleColumn(prefs, "cash");
    expect(prefs.visible).toContain("cash");
    prefs = toggleColumn(prefs, "cash");
    expect(prefs.visible).not.toContain("cash");

    let only: ReturnType<typeof defaultPrefs> = { ...defaultPrefs(), visible: ["spend"] };
    only = toggleColumn(only, "spend");
    expect(only.visible).toEqual(["spend"]);
  });

  it("mover es dentro del grupo y no toca a los otros grupos", () => {
    const prefs = defaultPrefs();
    const moved = moveColumn(prefs, "sales", -1);
    const crm = orderedGroup(moved, "crm").map((c) => c.id);
    expect(crm.indexOf("sales")).toBe(crm.indexOf("costPerBooking") - 1);
    expect(orderedGroup(moved, "meta").map((c) => c.id)).toEqual(orderedGroup(prefs, "meta").map((c) => c.id));
  });

  it("la primera no sube y la ultima no baja", () => {
    const prefs = defaultPrefs();
    expect(moveColumn(prefs, "spend", -1)).toEqual(prefs);
    expect(moveColumn(prefs, "costPerClose", 1)).toEqual(prefs);
  });

  it("lo visible respeta los grupos y el orden elegido dentro de cada uno", () => {
    let prefs = defaultPrefs();
    // Las flechas mueven entre TODAS las columnas del grupo (se vean o no): para que CTR quede antes que Impr. hacen falta cuatro pasos.
    for (let i = 0; i < 4; i++) prefs = moveColumn(prefs, "ctr", -1);
    const labels = visibleColumns(prefs).map((c) => c.id);
    expect(labels.indexOf("ctr")).toBeLessThan(labels.indexOf("impressions"));
    expect(labels.indexOf("leadsMeta")).toBeGreaterThan(labels.indexOf("ctr"));
    expect(labels.indexOf("bookings")).toBeGreaterThan(labels.indexOf("leadsCrm"));
  });

  it("restablecer vuelve a lo de siempre; y serializar/parsear es de ida y vuelta", () => {
    expect(resetPrefs()).toEqual(defaultPrefs());
    const prefs = moveColumn(toggleColumn(defaultPrefs(), "cac"), "roas", -1);
    expect(parsePrefs(serializePrefs(prefs))).toEqual(prefs);
  });
});

describe("formatCell", () => {
  const row = { spend: null, ctr: 2.5, roas: 6.25, bookings: 6, revenue: 2000 } as unknown as CrmRow;
  const def = (id: string) => COLUMNS.find((c) => c.id === id)!;

  it("lo que no se puede calcular es «—», nunca 0", () => {
    expect(formatCell(def("spend"), row, "USD")).toBe("—");
  });
  it("formatea plata, porcentaje, decimal y conteo", () => {
    expect(formatCell(def("revenue"), row, "USD")).toContain("2.000");
    expect(formatCell(def("ctr"), row, "USD")).toBe("2.50%");
    expect(formatCell(def("roas"), row, "USD")).toBe("6,25");
    expect(formatCell(def("bookings"), row, "USD")).toBe("6");
  });
});
