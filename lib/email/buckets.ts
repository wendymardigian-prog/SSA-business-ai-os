/**
 * El nombre del bucket de adjuntos, sin una sola dependencia.
 *
 * Existe por la misma razon que `lib/secret-names.ts`: la bandeja es un
 * Client Component y necesita este nombre para armar el link de descarga.
 * Si lo importara de `lib/email/inbound.ts`, se traeria con el todo el
 * procesamiento del correo —y con eso `next/headers`— al bundle del
 * navegador, y el build falla.
 *
 * Un archivo de una linea que evita eso vale la pena.
 */

export const ATTACHMENTS_BUCKET = "email-attachments";
