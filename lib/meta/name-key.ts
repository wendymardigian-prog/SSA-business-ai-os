/**
 * La clave de un nombre de campaña, conjunto o anuncio (Extra L, AT2).
 *
 * Es la misma cuenta que hace `public.meta_name_key(text)` en la base (migracion 00191):
 * minusculas, sin tildes y con los espacios colapsados y recortados. La paridad entre las
 * dos la fija `name-key.test.ts` con los mismos casos que la base.
 *
 * Modulo puro: lo usan el sync (para escribir `name_key`) y, en AT3, el vinculo por nombre.
 */

const FROM = "áàäâãåéèëêíìïîóòöôõúùüûñç";
const TO = "aaaaaaeeeeiiiiooooouuuunc";

export function metaNameKey(raw: string | null | undefined): string {
  let out = "";
  for (const ch of (raw ?? "").toLowerCase()) {
    const at = FROM.indexOf(ch);
    out += at >= 0 ? TO[at] : ch;
  }
  return out.replace(/\s+/g, " ").trim();
}
