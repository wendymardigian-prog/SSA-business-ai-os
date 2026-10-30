/**
 * Que busca el buscador de contactos y el de conversaciones (30/10/2026).
 *
 * Un solo lugar para los dos: antes Contactos buscaba por nombre, emails, telefonos
 * y los @ de Instagram, TikTok y X, y la bandeja SOLO por nombre. Ahora los dos
 * buscan por todo eso, y ademas:
 *
 * - un @ adelante se ignora ("@marca" encuentra a "marca");
 * - un telefono escrito con espacios, guiones o "+" se busca por sus digitos
 *   ("+54 9 11 2233-4455" encuentra "+5491122334455");
 * - el id de WhatsApp (@lid) de quien escribio sin compartir su numero: vive en
 *   `contact_channels`, asi que quien llama lo busca aparte (`lidSearchPattern`) y
 *   pasa los contactos que encontro.
 *
 * Puro: arma el filtro de PostgREST, no consulta nada. La busqueda llega ya
 * saneada (`sanitizeSearch` saca comas, parentesis, `*` y `%`).
 */

/** Un filtro `.or()` de PostgREST sobre las columnas de `contacts`. null si no hay nada que buscar. */
export function contactSearchFilter(search: string, extraContactIds: string[] = []): string | null {
  const term = search.replace(/"/g, "").trim();
  if (!term) return null;

  const handle = term.replace(/^@+/, "").trim();
  const digits = term.replace(/\D/g, "");

  const clauses = [
    `display_name.ilike.*${term}*`,
    `email.ilike.*${term}*`,
    `secondary_email.ilike.*${term}*`,
    `phone.ilike.*${term}*`,
    `whatsapp_phone.ilike.*${term}*`,
  ];
  if (handle) {
    clauses.push(
      `instagram_username.ilike.*${handle}*`,
      `tiktok_username.ilike.*${handle}*`,
      `twitter_username.ilike.*${handle}*`,
    );
  }
  // Un telefono escrito "+54 9 11 2233-4455" no aparece tal cual: se guarda "+5491122334455".
  if (digits.length >= 4 && digits !== term) {
    clauses.push(`phone.ilike.*${digits}*`, `whatsapp_phone.ilike.*${digits}*`);
  }
  const ids = extraContactIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (ids.length > 0) clauses.push(`id.in.(${ids.join(",")})`);

  return clauses.join(",");
}

/**
 * Para buscar el id de WhatsApp (@lid) en `contact_channels.platform_sender_id`:
 * el patron de `ilike`, o null si la busqueda no parece un id (menos de 6 digitos).
 */
export function lidSearchPattern(search: string): string | null {
  const digits = search.replace(/\D/g, "");
  return digits.length >= 6 ? `%${digits}%@lid` : null;
}
