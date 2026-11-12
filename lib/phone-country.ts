/**
 * De qué país es un teléfono, por su prefijo internacional.
 *
 * Puro y sin dependencias: lo usan las tablas con teléfono (columna, filtro y
 * agrupar por país) y su CSV. El teléfono se guarda siempre como `+<dígitos>` (E.164), así que el
 * país sale del prefijo: gana el más largo que coincide (+598 es Uruguay, no +59…).
 *
 * Dos prefijos los comparten varios países y se deciden por lo que sigue:
 * - **+1** (Norteamérica y el Caribe): por el código de área. Canadá y cada isla tienen los suyos;
 *   el resto es Estados Unidos.
 * - **+7**: Kazajistán empieza con 76 o 77; el resto es Rusia.
 *
 * No confundir con `lib/scheduling/phone-countries.ts`: esa es la lista del selector de país (que sale de esta tabla)
 * de los inputs de teléfono.
 */
import { normalizePhone } from "@/lib/phone";
import { countryLabel } from "@/lib/contacts/filters/options";

export interface PhoneCountryInfo {
  /** ISO 3166-1 alfa-2. */
  code: string;
  /** Nombre en español ("Perú"). */
  name: string;
  /** La bandera como emoji ("🇵🇪"). */
  flag: string;
  /** Prefijo internacional, sin "+". */
  dial: string;
}

/** Prefijo internacional → país. Un prefijo compartido va al país principal. */
const CALLING_CODES: Record<string, string> = {
  // Norteamérica y el Caribe: "1" se resuelve por código de área (NANP_AREAS).
  "1": "US",
  "7": "RU",
  // África
  "20": "EG", "211": "SS", "212": "MA", "213": "DZ", "216": "TN", "218": "LY", "220": "GM", "221": "SN",
  "222": "MR", "223": "ML", "224": "GN", "225": "CI", "226": "BF", "227": "NE", "228": "TG", "229": "BJ",
  "230": "MU", "231": "LR", "232": "SL", "233": "GH", "234": "NG", "235": "TD", "236": "CF", "237": "CM",
  "238": "CV", "239": "ST", "240": "GQ", "241": "GA", "242": "CG", "243": "CD", "244": "AO", "245": "GW",
  "246": "IO", "248": "SC", "249": "SD", "250": "RW", "251": "ET", "252": "SO", "253": "DJ", "254": "KE",
  "255": "TZ", "256": "UG", "257": "BI", "258": "MZ", "260": "ZM", "261": "MG", "262": "RE", "263": "ZW",
  "264": "NA", "265": "MW", "266": "LS", "267": "BW", "268": "SZ", "269": "KM", "27": "ZA", "290": "SH",
  "291": "ER", "297": "AW", "298": "FO", "299": "GL",
  // Europa
  "30": "GR", "31": "NL", "32": "BE", "33": "FR", "34": "ES", "350": "GI", "351": "PT", "352": "LU",
  "353": "IE", "354": "IS", "355": "AL", "356": "MT", "357": "CY", "358": "FI", "359": "BG", "36": "HU",
  "370": "LT", "371": "LV", "372": "EE", "373": "MD", "374": "AM", "375": "BY", "376": "AD", "377": "MC",
  "378": "SM", "380": "UA", "381": "RS", "382": "ME", "383": "XK", "385": "HR", "386": "SI", "387": "BA",
  "389": "MK", "39": "IT", "40": "RO", "41": "CH", "420": "CZ", "421": "SK", "423": "LI", "43": "AT",
  "44": "GB", "45": "DK", "46": "SE", "47": "NO", "48": "PL", "49": "DE",
  // América Central y del Sur
  "500": "FK", "501": "BZ", "502": "GT", "503": "SV", "504": "HN", "505": "NI", "506": "CR", "507": "PA",
  "508": "PM", "509": "HT", "51": "PE", "52": "MX", "53": "CU", "54": "AR", "55": "BR", "56": "CL",
  "57": "CO", "58": "VE", "590": "GP", "591": "BO", "592": "GY", "593": "EC", "594": "GF", "595": "PY",
  "596": "MQ", "597": "SR", "598": "UY", "599": "CW",
  // Oceanía y Sudeste asiático
  "60": "MY", "61": "AU", "62": "ID", "63": "PH", "64": "NZ", "65": "SG", "66": "TH", "670": "TL",
  "672": "NF", "673": "BN", "674": "NR", "675": "PG", "676": "TO", "677": "SB", "678": "VU", "679": "FJ",
  "680": "PW", "681": "WF", "682": "CK", "683": "NU", "685": "WS", "686": "KI", "687": "NC", "688": "TV",
  "689": "PF", "690": "TK", "691": "FM", "692": "MH",
  // Asia
  "81": "JP", "82": "KR", "84": "VN", "850": "KP", "852": "HK", "853": "MO", "855": "KH", "856": "LA",
  "86": "CN", "880": "BD", "886": "TW", "90": "TR", "91": "IN", "92": "PK", "93": "AF", "94": "LK",
  "95": "MM", "960": "MV", "961": "LB", "962": "JO", "963": "SY", "964": "IQ", "965": "KW", "966": "SA",
  "967": "YE", "968": "OM", "970": "PS", "971": "AE", "972": "IL", "973": "BH", "974": "QA", "975": "BT",
  "976": "MN", "977": "NP", "98": "IR", "992": "TJ", "993": "TM", "994": "AZ", "995": "GE", "996": "KG",
  "998": "UZ",
};

/** Códigos de área de +1 que NO son de Estados Unidos. */
const NANP_AREAS: Record<string, string> = {
  // Canadá
  ...Object.fromEntries(
    [
      "204", "226", "236", "249", "250", "257", "263", "289", "306", "343", "354", "365", "367", "368", "382",
      "387", "403", "416", "418", "428", "431", "437", "438", "450", "460", "468", "474", "506", "514", "519",
      "548", "579", "581", "584", "587", "600", "604", "613", "639", "647", "672", "683", "705", "709", "742",
      "753", "778", "780", "782", "807", "819", "825", "867", "873", "879", "902", "905", "942",
    ].map((area) => [area, "CA"]),
  ),
  // El Caribe y territorios
  "809": "DO", "829": "DO", "849": "DO",
  "787": "PR", "939": "PR",
  "242": "BS", "246": "BB", "264": "AI", "268": "AG", "284": "VG", "340": "VI", "345": "KY", "441": "BM",
  "473": "GD", "649": "TC", "658": "JM", "876": "JM", "664": "MS", "670": "MP", "671": "GU", "684": "AS",
  "721": "SX", "758": "LC", "767": "DM", "784": "VC", "868": "TT", "869": "KN",
};

const MAX_DIAL_LENGTH = 3;

/**
 * Todos los países que esta tabla conoce, con su prefijo y su nombre en español (sin repetir). Es lo que usa el selector
 * de país de los teléfonos para ofrecer la lista completa: un solo lugar para los prefijos. Los países de +1 y Kazajistán
 * (+7) comparten prefijo con otro y se separan por lo que sigue (código de área / 76-77), como en `countryFromPhone`.
 */
export function callingCountries(): Array<{ code: string; dial: string; label: string }> {
  const dials = new Map<string, string>();
  for (const [dial, code] of Object.entries(CALLING_CODES)) dials.set(code, dial);
  for (const code of Object.values(NANP_AREAS)) dials.set(code, "1");
  dials.set("KZ", "7");
  return [...dials.entries()].map(([code, dial]) => ({ code, dial, label: countryLabel(code) }));
}

/** La bandera de un código ISO: dos letras regionales ("PE" → 🇵🇪). */
export function flagOf(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** El país de un código ISO, con su nombre y su bandera. */
export function phoneCountryInfo(code: string, dial = ""): PhoneCountryInfo {
  return { code, name: countryLabel(code), flag: flagOf(code), dial };
}

/**
 * El país de un teléfono, o null si no tiene prefijo internacional reconocible.
 * Acepta el número con espacios, guiones o "00" adelante (lo normaliza `normalizePhone`).
 */
export function countryFromPhone(phone: string | null | undefined): PhoneCountryInfo | null {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const digits = normalized.slice(1);

  for (let length = MAX_DIAL_LENGTH; length >= 1; length -= 1) {
    const dial = digits.slice(0, length);
    const code = CALLING_CODES[dial];
    if (!code) continue;
    if (dial === "1") return phoneCountryInfo(NANP_AREAS[digits.slice(1, 4)] ?? "US", dial);
    if (dial === "7") return phoneCountryInfo(/^7[67]/.test(digits) ? "KZ" : "RU", dial);
    return phoneCountryInfo(code, dial);
  }
  return null;
}
