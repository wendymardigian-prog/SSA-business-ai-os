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

export function wrapUntrusted(kind: "lead" | "conocimiento" | "crm" | "memoria" | "operador", nonce: string, content: string): string {
  // Si alguien escribio el delimitador en el texto, se neutraliza.
  const safe = content.replace(/<<</g, "‹‹‹").replace(/>>>/g, "›››");
  return `<<<${kind} ${nonce}>>>\n${safe}\n<<<fin ${kind} ${nonce}>>>`;
}
