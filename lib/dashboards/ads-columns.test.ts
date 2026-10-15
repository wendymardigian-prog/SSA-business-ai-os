import { describe, expect, it } from "vitest";
import { ALL_COLUMN_IDS, COLUMNS, GROUP_ORDER, columnsOfGroup, csvCell, formatCell, statusText } from "./ads-crm-columns";
import {
  REPLACED_COLUMNS,
  columnMatches,
  defaultPrefs,
  loadPrefs,
  menuGroups,
  moveColumn,
  moveColumnTo,
  normalizeSearch,
  orderedGroup,
  parsePrefs,
  resetPrefs,
  savePrefs,
  serializePrefs,
  storageKey,
  toggleColumn,
  visibleColumns,
  type KeyValueStorage,
} from "./ads-columns";
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

const labelOf = (id: string) => COLUMNS.find((c) => c.id === id)!.label;

describe("las columnas por defecto (E3)", () => {
  it("son las 14 de la tabla, ademas de la primera columna (Anuncio, Conjunto o Campaña) que son las 15", () => {
    const labels = defaultPrefs().visible.map(labelOf).sort();
    expect(labels).toEqual(
      ["Estado", "Gasto", "Impr.", "CTR del enlace", "Leads Meta", "Leads nuevos", "Leads totales", "CPL nuevo", "CPL total", "Agendas", "Costo por agenda", "Ventas", "Revenue", "ROAS"].sort(),
    );
    expect(labels).toHaveLength(14);
  });

  it("se ven en el orden de los grupos: Información, Meta, Meta vs CRM, CRM", () => {
    expect(visibleColumns(defaultPrefs(), "ad").map((c) => c.id)).toEqual([
      "status", "spend", "impressions", "linkCtr", "leadsMeta", "leadsTotal", "leadsNew", "cplNew", "cplTotal", "bookings", "costPerBooking", "sales", "revenue", "roas",
    ]);
  });

  it("son las mismas en campañas, conjuntos y anuncios (la miniatura no es una columna: va en la primera celda)", () => {
    const ids = (level: "campaign" | "adset" | "ad") => visibleColumns(defaultPrefs(), level).map((c) => c.id);
    expect(ids("campaign")).toEqual(ids("ad"));
    expect(ids("adset")).toEqual(ids("ad"));
  });
});

describe("el catalogo de columnas", () => {
  it("no tiene duplicados: ni ids ni nombres repetidos", () => {
    expect(new Set(ALL_COLUMN_IDS).size).toBe(ALL_COLUMN_IDS.length);
    const labels = COLUMNS.map((c) => c.label);
    expect(new Set(labels).size, `repetidos: ${labels.filter((l, i) => labels.indexOf(l) !== i).join(", ")}`).toBe(labels.length);
  });

  it("«Leads CRM», «Agendas CRM», «CAC», «Costo por cierre», «CPL real» y «Leads 1er toque» ya no existen", () => {
    const labels = COLUMNS.map((c) => c.label);
    for (const gone of ["Leads CRM", "Agendas CRM", "CAC", "Costo por cierre", "CPL real", "Leads 1er toque", "Conv."]) expect(labels, gone).not.toContain(gone);
  });

  it("los cuatro nombres que se piden estan, cada uno con su explicacion de la diferencia", () => {
    const byId = (id: string) => COLUMNS.find((c) => c.id === id)!;
    expect(byId("leadsNew").label).toBe("Leads nuevos");
    expect(byId("leadsTotal").label).toBe("Leads totales");
    expect(byId("cplNew").label).toBe("CPL nuevo");
    expect(byId("cplTotal").label).toBe("CPL total");
    expect(byId("leadsNew").tip.body).toMatch(/PRIMER/);
    expect(byId("leadsTotal").tip.body).toMatch(/una sola vez/);
    expect(byId("cplNew").tip.body).toMatch(/Gasto ÷ Leads nuevos/);
    expect(byId("cplTotal").tip.body).toMatch(/Gasto ÷ Leads totales/);
  });

  it("los grupos tienen sus columnas: Meta con las de entrega, clics, video, conversiones y calidad", () => {
    expect(columnsOfGroup("metaVsCrm").map((c) => c.label)).toEqual(["Leads Meta", "Leads totales"]);
    expect(columnsOfGroup("info").map((c) => c.id).sort()).toEqual(["adsCount", "campaignName", "adsetName", "objective", "publication", "status"].sort());
    const meta = columnsOfGroup("meta");
    for (const sub of ["delivery", "clicks", "video", "conversions", "quality"]) expect(meta.some((c) => c.subgroup === sub), sub).toBe(true);
    expect(columnsOfGroup("crm").map((c) => c.id)).toEqual([
      "leadsNew", "cplNew", "cplTotal", "bookings", "costPerBooking", "attended", "costPerAttended", "leadToBooking", "sales", "revenue", "cash", "ufCash", "roas", "roasCash", "ufRoas", "costPerNewDeal",
    ]);
  });

  it("las columnas de E2 estan, todas, y ocultas por defecto", () => {
    const e2 = ["linkClicks", "linkCtr", "linkCpc", "video3s", "costPerVideo3s", "hookRate", "thruplays", "holdRate", "retention25", "retention50", "retention75", "retention100", "avgWatchSeconds",
      "viewContent", "costPerViewContent", "applications", "costPerApplication", "bookingsMeta", "costPerBookingMeta", "purchasesMeta", "costPerPurchase", "purchaseValue", "roasMeta",
      "qualityRanking", "engagementRanking", "conversionRanking", "attended", "costPerAttended", "ufCash", "ufRoas", "costPerNewDeal"];
    for (const id of e2) {
      const def = COLUMNS.find((c) => c.id === id);
      expect(def, id).toBeDefined();
      if (id !== "linkCtr") expect(def!.defaultVisible, id).toBe(false);
    }
  });

  it("los niveles: la calidad y la publicacion solo en anuncios; el objetivo solo en campañas; «# anuncios» no en anuncios", () => {
    const levels = (id: string) => COLUMNS.find((c) => c.id === id)!.levels;
    expect(levels("qualityRanking")).toEqual(["ad"]);
    expect(levels("publication")).toEqual(["ad"]);
    expect(levels("objective")).toEqual(["campaign"]);
    expect(levels("adsCount")).toEqual(["campaign", "adset"]);
    expect(visibleColumns({ ...defaultPrefs(), visible: ["qualityRanking", "spend"] }, "campaign").map((c) => c.id)).toEqual(["spend"]);
  });

  it("cada columna tiene un tooltip con titulo y explicacion", () => {
    for (const c of COLUMNS) {
      expect(c.tip.title.length, c.id).toBeGreaterThan(2);
      expect(c.tip.body.length, c.id).toBeGreaterThan(15);
    }
  });

  it("las que se pueden abrir son leads nuevos, leads totales, agendas y ventas", () => {
    expect(COLUMNS.filter((c) => c.cell).map((c) => [c.id, c.cell])).toEqual([
      ["leadsTotal", "leads_total"], ["leadsNew", "leads_new"], ["bookings", "bookings"], ["sales", "sales"],
    ]);
  });

  it("los grupos siempre salen en el mismo orden", () => {
    expect(GROUP_ORDER).toEqual(["info", "meta", "metaVsCrm", "crm"]);
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

  it("descarta columnas desconocidas y repetidas, y suma las nuevas, ocultas", () => {
    const raw = JSON.stringify({ order: ["roas", "inventada", "roas", "spend"], visible: ["roas", "inventada", "spend", "roas"] });
    const prefs = parsePrefs(raw);
    expect(prefs.visible).toEqual(["roas", "spend"]);
    // Las dos que quedaron mantienen su orden relativo (las nuevas se acomodan pegadas a su bloque).
    expect(prefs.order.indexOf("roas")).toBeLessThan(prefs.order.indexOf("spend"));
    expect([...prefs.order].sort()).toEqual([...ALL_COLUMN_IDS].sort());
  });
});

describe("las preferencias ya guardadas se respetan (E4: las tres situaciones)", () => {
  // Lo que guardaba la version anterior de la tabla: las columnas viejas y su orden.
  const OLD_ORDER = ["spend", "impressions", "reach", "frequency", "clicks", "ctr", "cpm", "cpc", "cplMeta", "conversions", "leadsMeta", "leadsCrm", "bookingsMeta", "bookingsCrm",
    "leadsFirst", "leadsTotal", "bookings", "attended", "leadToBooking", "cplReal", "costPerBooking", "sales", "revenue", "cash", "roas", "roasCash", "cac", "costPerClose"];
  const OLD_DEFAULT_VISIBLE = ["spend", "impressions", "ctr", "leadsMeta", "leadsCrm", "bookings", "cplReal", "costPerBooking", "sales", "revenue", "roas"];

  it("1. quien NUNCA toco las columnas no tiene nada guardado y ve el default nuevo", () => {
    expect(parsePrefs(null)).toEqual(defaultPrefs());
    expect(loadPrefs("ad", memory())).toEqual(defaultPrefs());
  });

  it("2. quien YA eligio las suyas conserva su eleccion; las columnas nuevas le aparecen ocultas", () => {
    // Eligio solo cuatro columnas que siguen existiendo.
    const mine = { order: OLD_ORDER, visible: ["spend", "reach", "sales", "cash"] };
    const prefs = parsePrefs(JSON.stringify(mine));
    expect(prefs.visible).toEqual(["spend", "reach", "sales", "cash"]);
    // Ninguna de las columnas nuevas se prendio sola.
    for (const added of ["linkCtr", "video3s", "status", "leadsNew", "ufCash", "qualityRanking"]) expect(prefs.visible, added).not.toContain(added);
    // Y estan, ocultas, en el orden (se pueden prender desde el selector).
    expect([...prefs.order].sort()).toEqual([...ALL_COLUMN_IDS].sort());
    expect(visibleColumns(prefs, "ad").map((c) => c.id)).toEqual(["spend", "reach", "sales", "cash"]);
  });

  it("2b. una columna nueva queda al final de SU bloque, no al final de todo", () => {
    const prefs = parsePrefs(JSON.stringify({ order: OLD_ORDER, visible: ["spend"] }));
    const meta = orderedGroup(prefs, "meta", "ad").map((c) => c.id);
    // `linkClicks` es de «Clics»: queda pegada a las otras de ese bloque, no despues de las de video.
    expect(meta.indexOf("linkClicks")).toBeLessThan(meta.indexOf("video3s"));
    expect(meta.indexOf("linkClicks")).toBeGreaterThan(meta.indexOf("ctr"));
  });

  it("3. una columna guardada que ya no existe se REEMPLAZA por su equivalente y nunca rompe la tabla", () => {
    const prefs = parsePrefs(JSON.stringify({ order: OLD_ORDER, visible: OLD_DEFAULT_VISIBLE }));
    const visible = new Set(prefs.visible);
    // «CPL real» se reparte en los dos CPL nuevos; «Leads CRM» pasa a «Leads totales»; «Agendas CRM» a «Agendas».
    expect(visible.has("cplNew") && visible.has("cplTotal")).toBe(true);
    expect(visible.has("leadsTotal")).toBe(true);
    for (const gone of ["cplReal", "leadsCrm", "leadsFirst", "bookingsCrm", "cac", "costPerClose", "conversions"]) expect(visible.has(gone as never), gone).toBe(false);
    // Lo que seguia existiendo no cambia.
    for (const kept of ["spend", "impressions", "ctr", "leadsMeta", "bookings", "costPerBooking", "sales", "revenue", "roas"]) expect(visible.has(kept as never), kept).toBe(true);
    // Todas las columnas visibles existen en el catalogo.
    expect(visibleColumns(prefs, "ad").length).toBe(prefs.visible.length);
  });

  it("3b. CAC y Costo por cierre pasan juntas a «Costo por nuevo deal» (una sola vez), y «Conv.» a «Compras Meta»", () => {
    const prefs = parsePrefs(JSON.stringify({ order: OLD_ORDER, visible: ["cac", "costPerClose", "conversions", "leadsFirst"] }));
    expect(prefs.visible).toEqual(["costPerNewDeal", "purchasesMeta", "leadsNew"]);
    expect(new Set(prefs.order).size).toBe(prefs.order.length);
  });

  it("3c. lo reemplazado conserva el lugar que tenia la columna vieja en el orden", () => {
    const prefs = parsePrefs(JSON.stringify({ order: ["leadsMeta", "leadsCrm", "bookingsMeta"], visible: ["leadsCrm"] }));
    expect(prefs.order.slice(0, 3)).toEqual(["leadsMeta", "leadsTotal", "bookingsMeta"]);
  });

  it("todo lo que reemplaza una columna vieja existe en el catalogo nuevo", () => {
    for (const [old, replacements] of Object.entries(REPLACED_COLUMNS)) {
      expect(ALL_COLUMN_IDS, old).not.toContain(old);
      for (const id of replacements) expect(ALL_COLUMN_IDS, `${old} → ${id}`).toContain(id);
    }
  });

  it("lo que se guarda despues de migrar se lee igual (ida y vuelta)", () => {
    const migrated = parsePrefs(JSON.stringify({ order: OLD_ORDER, visible: OLD_DEFAULT_VISIBLE }));
    expect(parsePrefs(serializePrefs(migrated))).toEqual(migrated);
  });
});

describe("prender, apagar y mover", () => {
  it("prende y apaga, pero no deja la tabla sin columnas (en esta pestaña)", () => {
    let prefs = defaultPrefs();
    prefs = toggleColumn(prefs, "cash");
    expect(prefs.visible).toContain("cash");
    prefs = toggleColumn(prefs, "cash");
    expect(prefs.visible).not.toContain("cash");

    let only: ReturnType<typeof defaultPrefs> = { ...defaultPrefs(), visible: ["spend"] };
    only = toggleColumn(only, "spend");
    expect(only.visible).toEqual(["spend"]);
    // Si lo unico visible NO aplica a la pestaña, apagar la ultima que si aplica tampoco deja la tabla vacia.
    const mixed = { ...defaultPrefs(), visible: ["qualityRanking", "spend"] as never };
    expect(toggleColumn(mixed, "spend", "campaign").visible).toEqual(["qualityRanking", "spend"]);
  });

  it("mover es dentro del bloque y no toca a los otros", () => {
    const prefs = defaultPrefs();
    const moved = moveColumn(prefs, "sales", -1);
    const crm = orderedGroup(moved, "crm").map((c) => c.id);
    expect(crm.indexOf("sales")).toBe(crm.indexOf("leadToBooking") - 1);
    expect(orderedGroup(moved, "meta").map((c) => c.id)).toEqual(orderedGroup(prefs, "meta").map((c) => c.id));
  });

  it("en Meta se mueve dentro de su subtitulo: la primera de «Clics» no sube a «Entrega»", () => {
    const prefs = defaultPrefs();
    expect(moveColumn(prefs, "clicks", -1)).toEqual(prefs);
    const moved = moveColumn(prefs, "ctr", -1);
    const meta = orderedGroup(moved, "meta").map((c) => c.id);
    expect(meta.indexOf("ctr")).toBe(meta.indexOf("clicks") - 1);
  });

  it("la primera no sube y la ultima no baja (con las flechas)", () => {
    const prefs = defaultPrefs();
    expect(moveColumn(prefs, "spend", -1)).toEqual(prefs);
    expect(moveColumn(prefs, "costPerNewDeal", 1)).toEqual(prefs);
  });

  it("arrastrar: una columna toma el lugar de otra DEL MISMO BLOQUE, y nunca cruza a otro", () => {
    const prefs = defaultPrefs();
    const dragged = moveColumnTo(prefs, "roas", "leadsNew");
    const crm = orderedGroup(dragged, "crm").map((c) => c.id);
    expect(crm[0]).toBe("roas");
    expect(crm).toHaveLength(orderedGroup(prefs, "crm").length);
    expect(new Set(dragged.order).size).toBe(dragged.order.length);
    // De un grupo a otro, o de un subtitulo a otro: no pasa nada.
    expect(moveColumnTo(prefs, "roas", "spend")).toEqual(prefs);
    expect(moveColumnTo(prefs, "linkClicks", "spend")).toEqual(prefs);
    expect(moveColumnTo(prefs, "roas", "roas")).toEqual(prefs);
  });

  it("las flechas siguen funcionando despues de arrastrar", () => {
    let prefs = moveColumnTo(defaultPrefs(), "roas", "leadsNew");
    prefs = moveColumn(prefs, "roas", 1);
    expect(orderedGroup(prefs, "crm").map((c) => c.id).slice(0, 2)).toEqual(["leadsNew", "roas"]);
  });

  it("lo visible respeta los grupos y el orden elegido dentro de cada uno", () => {
    let prefs = defaultPrefs();
    for (let i = 0; i < 2; i++) prefs = moveColumn(prefs, "linkCtr", -1);
    prefs = toggleColumn(prefs, "ctr");
    const ids = visibleColumns(prefs, "ad").map((c) => c.id);
    expect(ids.indexOf("linkCtr")).toBeLessThan(ids.indexOf("impressions") + 5);
    expect(ids.indexOf("leadsMeta")).toBeGreaterThan(ids.indexOf("linkCtr"));
    expect(ids.indexOf("bookings")).toBeGreaterThan(ids.indexOf("leadsTotal"));
  });

  it("restablecer vuelve al default de E3; y serializar/parsear es de ida y vuelta", () => {
    expect(resetPrefs()).toEqual(defaultPrefs());
    const prefs = moveColumn(toggleColumn(defaultPrefs(), "ufCash"), "roas", -1);
    expect(parsePrefs(serializePrefs(prefs))).toEqual(prefs);
  });
});

describe("el buscador y los subtitulos del selector", () => {
  it("normaliza acentos y mayusculas", () => {
    expect(normalizeSearch("  Retención ")).toBe("retencion");
  });

  it("busca en el nombre, en el titulo de la explicacion, en el grupo y en el subtitulo", () => {
    const col = (id: string) => COLUMNS.find((c) => c.id === id)!;
    expect(columnMatches(col("retention50"), "retencion")).toBe(true);
    expect(columnMatches(col("hookRate"), "VIDEO")).toBe(true); // subtitulo
    expect(columnMatches(col("roas"), "crm")).toBe(true); // grupo
    expect(columnMatches(col("roas"), "roas cash")).toBe(false);
    expect(columnMatches(col("roasCash"), "roas cash")).toBe(true);
    expect(columnMatches(col("spend"), "")).toBe(true);
  });

  it("sin buscar: los grupos con sus subtitulos en Meta, y los de otros grupos sin subtitulo", () => {
    const groups = menuGroups(defaultPrefs(), "ad");
    expect(groups.map((g) => g.group)).toEqual(["info", "meta", "metaVsCrm", "crm"]);
    expect(groups.find((g) => g.group === "meta")!.sections.map((s) => s.label)).toEqual(["Entrega", "Clics", "Video", "Conversiones", "Calidad"]);
    expect(groups.find((g) => g.group === "crm")!.sections).toHaveLength(1);
    expect(groups.find((g) => g.group === "crm")!.sections[0].label).toBeNull();
  });

  it("buscando: salen solo las que coinciden y los grupos vacios desaparecen", () => {
    const groups = menuGroups(defaultPrefs(), "ad", "retencion");
    expect(groups.map((g) => g.group)).toEqual(["meta"]);
    expect(groups[0].sections.map((s) => s.label)).toEqual(["Video"]);
    expect(groups[0].sections[0].columns.map((c) => c.id)).toEqual(["retention25", "retention50", "retention75", "retention100"]);
    expect(menuGroups(defaultPrefs(), "ad", "zzzz")).toEqual([]);
  });

  it("en campañas el selector no ofrece la calidad ni la publicacion", () => {
    const ids = menuGroups(defaultPrefs(), "campaign").flatMap((g) => g.sections.flatMap((s) => s.columns.map((c) => c.id)));
    expect(ids).not.toContain("qualityRanking");
    expect(ids).not.toContain("publication");
    expect(ids).toContain("objective");
  });
});

describe("formatCell y csvCell", () => {
  const row = { spend: null, ctr: 2.5, roas: 6.25, bookings: 6, revenue: 2000, avgWatchSeconds: 4.25, statusKind: "other", effectiveStatus: null, qualityRanking: "ABOVE_AVERAGE", publicationUrl: "https://fb.com/p/1", objective: null } as unknown as CrmRow;
  const def = (id: string) => COLUMNS.find((c) => c.id === id)!;

  it("lo que no se puede calcular es «—», nunca 0", () => {
    expect(formatCell(def("spend"), row, "USD")).toBe("—");
    expect(formatCell(def("objective"), row, "USD")).toBe("—");
  });

  it("formatea plata, porcentaje, decimal, conteo y segundos", () => {
    expect(formatCell(def("revenue"), row, "USD")).toContain("2.000");
    expect(formatCell(def("ctr"), row, "USD")).toBe("2.50%");
    expect(formatCell(def("roas"), row, "USD")).toBe("6,25");
    expect(formatCell(def("bookings"), row, "USD")).toBe("6");
    expect(formatCell(def("avgWatchSeconds"), row, "USD")).toBe("4,3 s");
  });

  it("el estado se lee en palabras y sin catalogo dice «Sin estado»", () => {
    expect(statusText(row)).toBe("Sin estado");
    expect(statusText({ ...row, statusKind: "active", effectiveStatus: "ACTIVE" } as CrmRow)).toBe("Activo");
    expect(statusText({ ...row, statusKind: "paused", effectiveStatus: "CAMPAIGN_PAUSED" } as CrmRow)).toBe("Pausado");
    expect(statusText({ ...row, statusKind: "other", effectiveStatus: "ARCHIVED" } as CrmRow)).toBe("ARCHIVED");
  });

  it("el ranking sale en castellano y en el CSV el enlace va como direccion, no como «Ver»", () => {
    expect(formatCell(def("qualityRanking"), row, "USD")).toBe("Por encima del promedio");
    expect(formatCell(def("publication"), row, "USD")).toBe("Ver");
    expect(csvCell(def("publication"), row)).toBe("https://fb.com/p/1");
    expect(csvCell(def("spend"), row)).toBe("");
    expect(csvCell(def("roas"), row)).toBe("6.25");
  });
});
