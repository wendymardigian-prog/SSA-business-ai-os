/**
 * Países y prefijos para los inputs de teléfono (F20).
 *
 * Decisión de Ana: todo input de teléfono lleva un selector de país, así
 * los números se guardan siempre con prefijo internacional. Esta es la lista
 * del selector (los comunes primero y después todos los países); vive en código (no es una tabla de la base). El valor
 * validado es siempre `+<dígitos>` (E.164), como lo guarda `contacts.phone`.
 */
import { normalizePhone } from "@/lib/phone";

export interface PhoneCountry {
  /** ISO 3166-1 alfa-2. */
  code: string;
  /** Prefijo internacional, sin "+". */
  dial: string;
  label: string;
}

export const DEFAULT_PHONE_COUNTRY = "CR";

const COMMON_PHONE_COUNTRIES: PhoneCountry[] = [
  { code: "CR", dial: "506", label: "Costa Rica" },
  { code: "AR", dial: "54", label: "Argentina" },
  { code: "MX", dial: "52", label: "México" },
  { code: "CO", dial: "57", label: "Colombia" },
  { code: "CL", dial: "56", label: "Chile" },
  { code: "PE", dial: "51", label: "Perú" },
  { code: "EC", dial: "593", label: "Ecuador" },
  { code: "UY", dial: "598", label: "Uruguay" },
  { code: "PY", dial: "595", label: "Paraguay" },
  { code: "BO", dial: "591", label: "Bolivia" },
  { code: "VE", dial: "58", label: "Venezuela" },
  { code: "PA", dial: "507", label: "Panamá" },
  { code: "GT", dial: "502", label: "Guatemala" },
  { code: "SV", dial: "503", label: "El Salvador" },
  { code: "HN", dial: "504", label: "Honduras" },
  { code: "NI", dial: "505", label: "Nicaragua" },
  { code: "DO", dial: "1", label: "República Dominicana" },
  { code: "PR", dial: "1", label: "Puerto Rico" },
  { code: "US", dial: "1", label: "Estados Unidos" },
  { code: "CA", dial: "1", label: "Canadá" },
  { code: "BR", dial: "55", label: "Brasil" },
  { code: "ES", dial: "34", label: "España" },
  { code: "PT", dial: "351", label: "Portugal" },
  { code: "IT", dial: "39", label: "Italia" },
  { code: "FR", dial: "33", label: "Francia" },
  { code: "DE", dial: "49", label: "Alemania" },
  { code: "GB", dial: "44", label: "Reino Unido" },
];

/**
 * Todos los demás países, por nombre. La lista es FIJA (los nombres en español están escritos acá) y no sale de
 * `Intl.DisplayNames`: el servidor y el navegador traen versiones distintas de los nombres y del orden, y el formulario
 * público se rompía al hidratar. Los prefijos son los mismos de `lib/phone-country.ts` (un test los compara) y el orden
 * es por nombre sin tildes (otro test lo comprueba).
 */
const OTHER_PHONE_COUNTRIES: PhoneCountry[] = [
  { code: "AF", dial: "93", label: "Afganistán" },
  { code: "AL", dial: "355", label: "Albania" },
  { code: "AD", dial: "376", label: "Andorra" },
  { code: "AO", dial: "244", label: "Angola" },
  { code: "AI", dial: "1", label: "Anguila" },
  { code: "AG", dial: "1", label: "Antigua y Barbuda" },
  { code: "SA", dial: "966", label: "Arabia Saudí" },
  { code: "DZ", dial: "213", label: "Argelia" },
  { code: "AM", dial: "374", label: "Armenia" },
  { code: "AW", dial: "297", label: "Aruba" },
  { code: "AU", dial: "61", label: "Australia" },
  { code: "AT", dial: "43", label: "Austria" },
  { code: "AZ", dial: "994", label: "Azerbaiyán" },
  { code: "BS", dial: "1", label: "Bahamas" },
  { code: "BD", dial: "880", label: "Bangladés" },
  { code: "BB", dial: "1", label: "Barbados" },
  { code: "BH", dial: "973", label: "Baréin" },
  { code: "BE", dial: "32", label: "Bélgica" },
  { code: "BZ", dial: "501", label: "Belice" },
  { code: "BJ", dial: "229", label: "Benín" },
  { code: "BM", dial: "1", label: "Bermudas" },
  { code: "BY", dial: "375", label: "Bielorrusia" },
  { code: "BA", dial: "387", label: "Bosnia y Herzegovina" },
  { code: "BW", dial: "267", label: "Botsuana" },
  { code: "BN", dial: "673", label: "Brunéi" },
  { code: "BG", dial: "359", label: "Bulgaria" },
  { code: "BF", dial: "226", label: "Burkina Faso" },
  { code: "BI", dial: "257", label: "Burundi" },
  { code: "BT", dial: "975", label: "Bután" },
  { code: "CV", dial: "238", label: "Cabo Verde" },
  { code: "KH", dial: "855", label: "Camboya" },
  { code: "CM", dial: "237", label: "Camerún" },
  { code: "QA", dial: "974", label: "Catar" },
  { code: "TD", dial: "235", label: "Chad" },
  { code: "CZ", dial: "420", label: "Chequia" },
  { code: "CN", dial: "86", label: "China" },
  { code: "CY", dial: "357", label: "Chipre" },
  { code: "KM", dial: "269", label: "Comoras" },
  { code: "CG", dial: "242", label: "Congo" },
  { code: "KP", dial: "850", label: "Corea del Norte" },
  { code: "KR", dial: "82", label: "Corea del Sur" },
  { code: "CI", dial: "225", label: "Costa de Marfil" },
  { code: "HR", dial: "385", label: "Croacia" },
  { code: "CU", dial: "53", label: "Cuba" },
  { code: "CW", dial: "599", label: "Curazao" },
  { code: "DK", dial: "45", label: "Dinamarca" },
  { code: "DM", dial: "1", label: "Dominica" },
  { code: "EG", dial: "20", label: "Egipto" },
  { code: "AE", dial: "971", label: "Emiratos Árabes Unidos" },
  { code: "ER", dial: "291", label: "Eritrea" },
  { code: "SK", dial: "421", label: "Eslovaquia" },
  { code: "SI", dial: "386", label: "Eslovenia" },
  { code: "EE", dial: "372", label: "Estonia" },
  { code: "SZ", dial: "268", label: "Esuatini" },
  { code: "ET", dial: "251", label: "Etiopía" },
  { code: "PH", dial: "63", label: "Filipinas" },
  { code: "FI", dial: "358", label: "Finlandia" },
  { code: "FJ", dial: "679", label: "Fiyi" },
  { code: "GA", dial: "241", label: "Gabón" },
  { code: "GM", dial: "220", label: "Gambia" },
  { code: "GE", dial: "995", label: "Georgia" },
  { code: "GH", dial: "233", label: "Ghana" },
  { code: "GI", dial: "350", label: "Gibraltar" },
  { code: "GD", dial: "1", label: "Granada" },
  { code: "GR", dial: "30", label: "Grecia" },
  { code: "GL", dial: "299", label: "Groenlandia" },
  { code: "GP", dial: "590", label: "Guadalupe" },
  { code: "GU", dial: "1", label: "Guam" },
  { code: "GF", dial: "594", label: "Guayana Francesa" },
  { code: "GN", dial: "224", label: "Guinea" },
  { code: "GQ", dial: "240", label: "Guinea Ecuatorial" },
  { code: "GW", dial: "245", label: "Guinea-Bisáu" },
  { code: "GY", dial: "592", label: "Guyana" },
  { code: "HT", dial: "509", label: "Haití" },
  { code: "HK", dial: "852", label: "Hong Kong" },
  { code: "HU", dial: "36", label: "Hungría" },
  { code: "IN", dial: "91", label: "India" },
  { code: "ID", dial: "62", label: "Indonesia" },
  { code: "IQ", dial: "964", label: "Irak" },
  { code: "IR", dial: "98", label: "Irán" },
  { code: "IE", dial: "353", label: "Irlanda" },
  { code: "NF", dial: "672", label: "Isla Norfolk" },
  { code: "IS", dial: "354", label: "Islandia" },
  { code: "KY", dial: "1", label: "Islas Caimán" },
  { code: "CK", dial: "682", label: "Islas Cook" },
  { code: "FO", dial: "298", label: "Islas Feroe" },
  { code: "FK", dial: "500", label: "Islas Malvinas" },
  { code: "MP", dial: "1", label: "Islas Marianas del Norte" },
  { code: "MH", dial: "692", label: "Islas Marshall" },
  { code: "SB", dial: "677", label: "Islas Salomón" },
  { code: "TC", dial: "1", label: "Islas Turcas y Caicos" },
  { code: "VG", dial: "1", label: "Islas Vírgenes Británicas" },
  { code: "VI", dial: "1", label: "Islas Vírgenes de EE. UU." },
  { code: "IL", dial: "972", label: "Israel" },
  { code: "JM", dial: "1", label: "Jamaica" },
  { code: "JP", dial: "81", label: "Japón" },
  { code: "JO", dial: "962", label: "Jordania" },
  { code: "KZ", dial: "7", label: "Kazajistán" },
  { code: "KE", dial: "254", label: "Kenia" },
  { code: "KG", dial: "996", label: "Kirguistán" },
  { code: "KI", dial: "686", label: "Kiribati" },
  { code: "XK", dial: "383", label: "Kosovo" },
  { code: "KW", dial: "965", label: "Kuwait" },
  { code: "LA", dial: "856", label: "Laos" },
  { code: "LS", dial: "266", label: "Lesoto" },
  { code: "LV", dial: "371", label: "Letonia" },
  { code: "LB", dial: "961", label: "Líbano" },
  { code: "LR", dial: "231", label: "Liberia" },
  { code: "LY", dial: "218", label: "Libia" },
  { code: "LI", dial: "423", label: "Liechtenstein" },
  { code: "LT", dial: "370", label: "Lituania" },
  { code: "LU", dial: "352", label: "Luxemburgo" },
  { code: "MO", dial: "853", label: "Macao" },
  { code: "MK", dial: "389", label: "Macedonia del Norte" },
  { code: "MG", dial: "261", label: "Madagascar" },
  { code: "MY", dial: "60", label: "Malasia" },
  { code: "MW", dial: "265", label: "Malaui" },
  { code: "MV", dial: "960", label: "Maldivas" },
  { code: "ML", dial: "223", label: "Mali" },
  { code: "MT", dial: "356", label: "Malta" },
  { code: "MA", dial: "212", label: "Marruecos" },
  { code: "MQ", dial: "596", label: "Martinica" },
  { code: "MU", dial: "230", label: "Mauricio" },
  { code: "MR", dial: "222", label: "Mauritania" },
  { code: "FM", dial: "691", label: "Micronesia" },
  { code: "MD", dial: "373", label: "Moldavia" },
  { code: "MC", dial: "377", label: "Mónaco" },
  { code: "MN", dial: "976", label: "Mongolia" },
  { code: "ME", dial: "382", label: "Montenegro" },
  { code: "MS", dial: "1", label: "Montserrat" },
  { code: "MZ", dial: "258", label: "Mozambique" },
  { code: "MM", dial: "95", label: "Myanmar (Birmania)" },
  { code: "NA", dial: "264", label: "Namibia" },
  { code: "NR", dial: "674", label: "Nauru" },
  { code: "NP", dial: "977", label: "Nepal" },
  { code: "NE", dial: "227", label: "Níger" },
  { code: "NG", dial: "234", label: "Nigeria" },
  { code: "NU", dial: "683", label: "Niue" },
  { code: "NO", dial: "47", label: "Noruega" },
  { code: "NC", dial: "687", label: "Nueva Caledonia" },
  { code: "NZ", dial: "64", label: "Nueva Zelanda" },
  { code: "OM", dial: "968", label: "Omán" },
  { code: "NL", dial: "31", label: "Países Bajos" },
  { code: "PK", dial: "92", label: "Pakistán" },
  { code: "PW", dial: "680", label: "Palaos" },
  { code: "PS", dial: "970", label: "Palestina" },
  { code: "PG", dial: "675", label: "Papúa Nueva Guinea" },
  { code: "PF", dial: "689", label: "Polinesia Francesa" },
  { code: "PL", dial: "48", label: "Polonia" },
  { code: "CF", dial: "236", label: "República Centroafricana" },
  { code: "CD", dial: "243", label: "República Democrática del Congo" },
  { code: "RE", dial: "262", label: "Reunión" },
  { code: "RW", dial: "250", label: "Ruanda" },
  { code: "RO", dial: "40", label: "Rumanía" },
  { code: "RU", dial: "7", label: "Rusia" },
  { code: "WS", dial: "685", label: "Samoa" },
  { code: "AS", dial: "1", label: "Samoa Americana" },
  { code: "KN", dial: "1", label: "San Cristóbal y Nieves" },
  { code: "SM", dial: "378", label: "San Marino" },
  { code: "PM", dial: "508", label: "San Pedro y Miquelón" },
  { code: "VC", dial: "1", label: "San Vicente y las Granadinas" },
  { code: "SH", dial: "290", label: "Santa Elena" },
  { code: "LC", dial: "1", label: "Santa Lucía" },
  { code: "ST", dial: "239", label: "Santo Tomé y Príncipe" },
  { code: "SN", dial: "221", label: "Senegal" },
  { code: "RS", dial: "381", label: "Serbia" },
  { code: "SC", dial: "248", label: "Seychelles" },
  { code: "SL", dial: "232", label: "Sierra Leona" },
  { code: "SG", dial: "65", label: "Singapur" },
  { code: "SX", dial: "1", label: "Sint Maarten" },
  { code: "SY", dial: "963", label: "Siria" },
  { code: "SO", dial: "252", label: "Somalia" },
  { code: "LK", dial: "94", label: "Sri Lanka" },
  { code: "ZA", dial: "27", label: "Sudáfrica" },
  { code: "SD", dial: "249", label: "Sudán" },
  { code: "SS", dial: "211", label: "Sudán del Sur" },
  { code: "SE", dial: "46", label: "Suecia" },
  { code: "CH", dial: "41", label: "Suiza" },
  { code: "SR", dial: "597", label: "Surinam" },
  { code: "TH", dial: "66", label: "Tailandia" },
  { code: "TW", dial: "886", label: "Taiwán" },
  { code: "TZ", dial: "255", label: "Tanzania" },
  { code: "TJ", dial: "992", label: "Tayikistán" },
  { code: "IO", dial: "246", label: "Territorio Británico del Océano Índico" },
  { code: "TL", dial: "670", label: "Timor-Leste" },
  { code: "TG", dial: "228", label: "Togo" },
  { code: "TK", dial: "690", label: "Tokelau" },
  { code: "TO", dial: "676", label: "Tonga" },
  { code: "TT", dial: "1", label: "Trinidad y Tobago" },
  { code: "TN", dial: "216", label: "Túnez" },
  { code: "TM", dial: "993", label: "Turkmenistán" },
  { code: "TR", dial: "90", label: "Turquía" },
  { code: "TV", dial: "688", label: "Tuvalu" },
  { code: "UA", dial: "380", label: "Ucrania" },
  { code: "UG", dial: "256", label: "Uganda" },
  { code: "UZ", dial: "998", label: "Uzbekistán" },
  { code: "VU", dial: "678", label: "Vanuatu" },
  { code: "VN", dial: "84", label: "Vietnam" },
  { code: "WF", dial: "681", label: "Wallis y Futuna" },
  { code: "YE", dial: "967", label: "Yemen" },
  { code: "DJ", dial: "253", label: "Yibuti" },
  { code: "ZM", dial: "260", label: "Zambia" },
  { code: "ZW", dial: "263", label: "Zimbabue" },
];

/** La lista del selector: primero los de uso más común (en su orden de siempre) y después todos los demás por nombre. */
export const PHONE_COUNTRIES: PhoneCountry[] = [...COMMON_PHONE_COUNTRIES, ...OTHER_PHONE_COUNTRIES];

export function findPhoneCountry(code: string | null | undefined): PhoneCountry | null {
  if (!code) return null;
  const upper = code.toUpperCase();
  return PHONE_COUNTRIES.find((c) => c.code === upper) ?? null;
}

/** Lo que manda el input: el número solo (ya internacional) o país + número local. */
export type PhoneInput = string | { country?: string | null; number: string };

/**
 * Arma `+<prefijo><número>` y valida que quede E.164 (8 a 15 dígitos).
 *
 * - Un string que ya empieza con `+` o `00` se toma como internacional.
 * - Un string sin prefijo usa `defaultCountry`.
 * - Un objeto usa su país; si no lo trae, `defaultCountry`.
 * - Un país desconocido, o un número sin país ni prefijo, es null.
 * - Un cero inicial del número local (habitual en Argentina) se quita.
 */
export function normalizePhoneWithCountry(
  input: PhoneInput | null | undefined,
  defaultCountry: string | null = DEFAULT_PHONE_COUNTRY,
): string | null {
  if (input === null || input === undefined) return null;

  const raw = typeof input === "string" ? input : input.number;
  const countryCode = typeof input === "string" ? defaultCountry : (input.country ?? defaultCountry);
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  const compact = trimmed.replace(/[\s().-]/g, "");
  if (compact.startsWith("+") || compact.startsWith("00")) return normalizePhone(compact);

  const country = findPhoneCountry(countryCode);
  if (!country) return null;

  const digits = compact.replace(/\D/g, "").replace(/^0+/, "");
  if (!digits) return null;
  return normalizePhone(`+${country.dial}${digits}`);
}

/** Verdadero si es un `+<dígitos>` E.164 tal como se guarda. */
export function isE164(value: unknown): value is string {
  return typeof value === "string" && /^\+\d{8,15}$/.test(value);
}

/**
 * El pais por defecto del selector de telefono, desde una zona horaria.
 *
 * Vive aca y no junto a la creacion de agendas porque lo usa el formulario
 * publico, que corre en el navegador: importarlo desde un modulo de servidor
 * arrastraba Vault al bundle (lo atajo lib/vault-boundary.test.ts).
 */
const TIMEZONE_COUNTRY: Record<string, string> = {
  "America/Costa_Rica": "CR",
  "America/Mexico_City": "MX",
  "America/Argentina/Buenos_Aires": "AR",
  "America/Bogota": "CO",
  "America/Lima": "PE",
  "America/Santiago": "CL",
  "Europe/Madrid": "ES",
};

export function countryFromTimezone(timezone: string | null | undefined): string | undefined {
  return timezone ? TIMEZONE_COUNTRY[timezone] : undefined;
}
