import { randomBytes } from "node:crypto";

/**
 * Contenido no confiable: lo que escribe el lead, lo que devuelve la base de
 * conocimiento y la memoria del contacto.
 *
 * Todo eso es DATO, nunca instruccion. Se entrega al modelo dentro de bloques
 * delimitados con un codigo distinto en cada turno, y el system prompt dice
 * que lo de adentro no se obedece. El codigo cambia por turno para que un
 * mensaje no pueda "cerrar" el bloque escribiendo el delimitador de antemano.
 *
 * Esto baja el riesgo, no lo elimina: la defensa que sostiene el peso es que
 * las herramientas validan en el servidor contra su configuracion y que el
 * agente no tiene herramientas peligrosas.
 */

export function newNonce(): string {
  return randomBytes(4).toString("hex");
}

export function wrapUntrusted(kind: "lead" | "conocimiento" | "crm" | "memoria" | "operador" | "llamada", nonce: string, content: string): string {
  // Si alguien escribio el delimitador en el texto, se neutraliza.
  const safe = content.replace(/<<</g, "‹‹‹").replace(/>>>/g, "›››");
  return `<<<${kind} ${nonce}>>>\n${safe}\n<<<fin ${kind} ${nonce}>>>`;
}

/**
 * Las variables de una plantilla con cada texto no vacio envuelto como dato del CRM (`crm`). Para una consigna que
 * escribio el negocio y lleva `{{contact.display_name}}` o el @usuario: esos los escribio el contacto. Un texto
 * vacio queda vacio, asi el respaldo `{{x|y}}` sigue andando.
 */
export function wrapVariableValues(variables: Record<string, unknown>, nonce: string): Record<string, unknown> {
  const wrap = (value: unknown): unknown => {
    if (typeof value === "string") return value.trim() ? wrapUntrusted("crm", nonce, value) : value;
    if (Array.isArray(value)) return value.map(wrap);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, wrap(v)]));
    }
    return value;
  };
  return wrap(variables) as Record<string, unknown>;
}
