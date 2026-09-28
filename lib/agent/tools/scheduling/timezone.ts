/**
 * La zona horaria del lead (F53).
 *
 * En orden: la que ya tiene el contacto, la que se deduce del prefijo de su
 * teléfono, y por último la del negocio. Si nada alcanza, el agente pregunta:
 * proponer una hora en la zona equivocada es perder la reunión.
 *
 * La tabla es corta a propósito. No es un mapa de husos horarios: son los
 * países donde la agencia trabaja, y cada uno con la zona de su capital.
 * Un país con varias zonas (México, Brasil) queda en la más poblada y el
 * agente igual pregunta cuando el horario no cierra.
 */

const BY_DIAL: Array<{ dial: string; timezone: string }> = [
  { dial: "506", timezone: "America/Costa_Rica" },
  { dial: "502", timezone: "America/Guatemala" },
  { dial: "503", timezone: "America/El_Salvador" },
  { dial: "504", timezone: "America/Tegucigalpa" },
  { dial: "505", timezone: "America/Managua" },
  { dial: "507", timezone: "America/Panama" },
  { dial: "51", timezone: "America/Lima" },
  { dial: "52", timezone: "America/Mexico_City" },
  { dial: "54", timezone: "America/Argentina/Buenos_Aires" },
  { dial: "55", timezone: "America/Sao_Paulo" },
  { dial: "56", timezone: "America/Santiago" },
  { dial: "57", timezone: "America/Bogota" },
  { dial: "58", timezone: "America/Caracas" },
  { dial: "34", timezone: "Europe/Madrid" },
  { dial: "593", timezone: "America/Guayaquil" },
  { dial: "595", timezone: "America/Asuncion" },
  { dial: "598", timezone: "America/Montevideo" },
  { dial: "591", timezone: "America/La_Paz" },
  { dial: "1", timezone: "America/New_York" },
];

/** La zona que sugiere un teléfono en formato internacional, o null. */
export function timezoneFromPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, "");
  if (!digits) return null;
  // De más largo a más corto: "506" antes que "50".
  const sorted = [...BY_DIAL].sort((a, b) => b.dial.length - a.dial.length);
  return sorted.find((entry) => digits.startsWith(entry.dial))?.timezone ?? null;
}

export interface InferredTimezone {
  timezone: string;
  /** De dónde salió: cambia si el agente tiene que preguntar o no. */
  source: "contact" | "phone" | "workspace";
}

export function inferTimezone(input: {
  contactTimezone?: string | null;
  phone?: string | null;
  workspaceTimezone: string;
}): InferredTimezone {
  if (input.contactTimezone) return { timezone: input.contactTimezone, source: "contact" };
  const fromPhone = timezoneFromPhone(input.phone);
  if (fromPhone) return { timezone: fromPhone, source: "phone" };
  return { timezone: input.workspaceTimezone, source: "workspace" };
}

/** Si el agente tiene que preguntar la zona antes de proponer un horario. */
export function shouldAskTimezone(inferred: InferredTimezone): boolean {
  // Del contacto es un dato; del teléfono es una deducción razonable. La del
  // negocio es una suposición sobre el lead, y esa sí se pregunta.
  return inferred.source === "workspace";
}
