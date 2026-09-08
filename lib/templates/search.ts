/**
 * Busqueda de templates para el selector "/" de la bandeja (F17).
 *
 * Vive aparte del componente porque es la parte que se puede probar sin montar
 * nada: que "/pre" encuentre el template del precio y que el orden ponga
 * primero lo mas parecido a lo que la persona esta tipeando.
 */

export interface SearchableTemplate {
  id: string;
  name: string;
  content: string;
  shortcut: string | null;
}

/** Sin acentos ni mayusculas: quien escribe rapido no pone tildes. */
function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Filtra por nombre o por atajo y ordena por que tan al principio esta lo que
 * se escribio. Un atajo que arranca con el texto va primero: si alguien tipea
 * "/precio" es porque sabe exactamente cual quiere.
 *
 * Con la busqueda vacia devuelve todo, que es lo que corresponde apenas se
 * escribe "/" y todavia no se filtro nada.
 */
export function filterTemplates<T extends SearchableTemplate>(
  templates: T[],
  query: string,
): T[] {
  const needle = fold(query.trim());
  if (!needle) return templates;

  const scored: { template: T; score: number }[] = [];

  for (const template of templates) {
    const name = fold(template.name);
    // El atajo se guarda con barra; la busqueda llega sin ella.
    const shortcut = fold((template.shortcut ?? "").replace(/^\//, ""));

    let score: number | null = null;
    if (shortcut && shortcut.startsWith(needle)) score = 0;
    else if (name.startsWith(needle)) score = 1;
    else if (shortcut && shortcut.includes(needle)) score = 2;
    else if (name.includes(needle)) score = 3;

    if (score !== null) scored.push({ template, score });
  }

  return scored
    .sort((a, b) => a.score - b.score || a.template.name.localeCompare(b.template.name, "es"))
    .map((s) => s.template);
}
