/**
 * El país de un contacto a partir de lo que escribió una persona (R6): el código ISO de 2 letras o el
 * nombre del país, en español o en inglés, sin distinguir mayúsculas ni tildes ("costa rica", "México", "Spain").
 * PURO. La tabla de nombres sale de `Intl.DisplayNames` sobre todos los códigos ISO, no está escrita a mano.
 */

/**
 * Los códigos ISO 3166-1 alfa-2 vigentes (más XK, Kosovo, que `Intl` también conoce). La lista de códigos es
 * fija; los NOMBRES salen de `Intl.DisplayNames`. `Intl` solo no alcanza para decidir qué es un país: acepta
 * códigos en desuso (DD, YU, SU…) que dan el nombre de un país actual.
 */
const ISO_CODES =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT " +
  "MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
  "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG " +
  "UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW";

export const COUNTRY_CODES: readonly string[] = ISO_CODES.split(" ");

/** Nombres habituales que `Intl` no trae. */
const ALIASES: Record<string, string> = {
  usa: "US",
  "u s a": "US",
  "u s": "US",
  eeuu: "US",
  "ee uu": "US",
  "estados unidos de america": "US",
  "united states of america": "US",
  america: "US",
  uk: "GB",
  "u k": "GB",
  inglaterra: "GB",
  england: "GB",
  "gran bretana": "GB",
  "great britain": "GB",
  holanda: "NL",
  holland: "NL",
  "republica checa": "CZ",
  "czech republic": "CZ",
  "corea del sur": "KR",
  "south korea": "KR",
  rusia: "RU",
  "emiratos arabes": "AE",
  uae: "AE",
  "republica dominicana": "DO",
  "rep dominicana": "DO",
  "el salvador": "SV",
  espana: "ES",
};

/** Minúsculas, sin tildes, sin signos y con los espacios colapsados. */
export function normalizeCountryText(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

let codes: Set<string> | null = null;
let byName: Map<string, string> | null = null;

function buildTables(): void {
  codes = new Set(COUNTRY_CODES);
  byName = new Map();
  const displays = ["es", "en"].map((locale) => new Intl.DisplayNames([locale], { type: "region" }));
  for (const code of COUNTRY_CODES) {
    for (const display of displays) {
      let name: string | undefined;
      try {
        name = display.of(code);
      } catch {
        name = undefined;
      }
      // `Intl` devuelve el propio código cuando no conoce la región.
      if (!name || name === code) continue;
      const key = normalizeCountryText(name);
      if (key && !byName.has(key)) byName.set(key, code);
    }
  }
  for (const [alias, code] of Object.entries(ALIASES)) if (!byName.has(alias)) byName.set(alias, code);
}

/** El código ISO-2 (en mayúsculas) de lo que escribió la persona, o null si no se reconoce. */
export function resolveCountry(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text === "" || text.length > 80) return null;
  if (!codes || !byName) buildTables();

  const upper = text.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) {
    if (codes!.has(upper)) return upper;
    // "UK" no es un código ISO: es un alias de uso común.
    return byName!.get(normalizeCountryText(text)) ?? null;
  }
  return byName!.get(normalizeCountryText(text)) ?? null;
}
