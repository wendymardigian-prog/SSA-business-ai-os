/**
 * Busqueda de templates para el selector "/" de la bandeja (F17).
 *
 * Vive aparte del componente porque es la parte que se puede probar sin montar
 * nada: que "/pre" encuentre el template del precio y que el orden ponga
 * primero lo mas parecido a lo que la persona esta tipeando.
 *
 * La banca de recursos (texto + audio) reutiliza esto tal cual, mapeando su
 * campo de texto (content para un texto, transcript para un audio) a
 * `content` y sus etiquetas a `tags` (ver lib/response-assets/search.ts). Por
 * eso `tags` es opcional: un llamador que no la pasa sigue compilando.
 */

export interface SearchableTemplate {
  id: string;
  name: string;
  content: string;
  shortcut: string | null;
  /** Opcional: los llamadores viejos no la pasan y siguen compilando. */
  tags?: string[] | null;
}

/** Sin acentos ni mayusculas: quien escribe rapido no pone tildes. */
function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Filtra por nombre, atajo, etiquetas o contenido, y ordena por que tan al
 * principio esta lo que se escribio. Un atajo que arranca con el texto va
 * primero: si alguien tipea "/precio" es porque sabe exactamente cual quiere.
 *
 * Con la busqueda vacia devuelve todo, que es lo que corresponde apenas se
 * escribe "/" y todavia no se filtro nada.
 *
 * `tieBreak` decide entre dos resultados igual de relevantes. Sin pasarlo,
 * por nombre (como siempre); la banca de recursos pasa "el mas usado
 * primero" (lib/response-assets/search.ts).
 */
export function filterTemplates<T extends SearchableTemplate>(
  templates: T[],
  query: string,
  tieBreak: (a: T, b: T) => number = (a, b) => a.name.localeCompare(b.name, "es"),
): T[] {
  const needle = fold(query.trim());
  if (!needle) return templates;

  const scored: { template: T; score: number }[] = [];

  for (const template of templates) {
    const name = fold(template.name);
    // El atajo se guarda con barra; la busqueda llega sin ella.
    const shortcut = fold((template.shortcut ?? "").replace(/^\//, ""));
    const tags = (template.tags ?? []).map(fold);
    // El texto del recurso (el contenido de un texto, la transcripcion de un
    // audio): es lo que mas se escribe distinto de como suena, asi que va al
    // final, nunca antes que nombre, atajo o etiquetas.
    const content = fold(template.content);

    let score: number | null = null;
    if (shortcut && shortcut.startsWith(needle)) score = 0;
    else if (name.startsWith(needle)) score = 1;
    else if (shortcut && shortcut.includes(needle)) score = 2;
    else if (name.includes(needle)) score = 3;
    // Una etiqueta es una decision deliberada de quien cargo el recurso: pesa
    // mas que el contenido, que es incidental, pero menos que el nombre, que
    // es lo que la persona lee en la lista.
    else if (tags.some((t) => t.startsWith(needle))) score = 4;
    else if (content && content.includes(needle)) score = 5;

    if (score !== null) scored.push({ template, score });
  }

  return scored
    .sort((a, b) => a.score - b.score || tieBreak(a.template, b.template))
    .map((s) => s.template);
}
