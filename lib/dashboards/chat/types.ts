/**
 * Lo que devuelve cada bloque del dashboard de Chat.
 *
 * La regla del modulo: **un bloque que falla lo dice**. Antes
 * `lib/dashboards/load.ts` no miraba el `error` de ninguna consulta, asi que una
 * funcion caida se veia igual que un periodo sin actividad: todo en cero. Un
 * cero es una afirmacion ("no paso nada") y era falsa.
 *
 * Por eso ningun loader lanza: devuelve `ok: false` con el motivo, y la pantalla
 * muestra ese bloque con "Reintentar" mientras los demas siguen andando.
 *
 * Todo lo que viaja del servidor al navegador tiene que ser JSON: objetos,
 * arrays, numeros, strings, null. Nada de Map, Set ni clases.
 */

export type BlockResult<T> =
  | { ok: true; data: T; loadedAt: string }
  | { ok: false; error: string };

/** Los grupos de autor del dashboard. Un color y una fila por grupo. */
export type AuthorGroup = "agent" | "team" | "automations" | "external";

export const AUTHOR_GROUPS: AuthorGroup[] = ["agent", "team", "automations", "external"];

/** Como se llama cada grupo en pantalla. */
export const AUTHOR_GROUP_LABELS: Record<AuthorGroup, string> = {
  agent: "Agente IA",
  team: "Equipo",
  automations: "Automatizaciones",
  external: "Fuera del sistema",
};

/** El color de cada grupo, siempre el mismo (tokens de globals.css). */
export const AUTHOR_GROUP_COLORS: Record<AuthorGroup, string> = {
  agent: "var(--c-agent)",
  team: "var(--c-team)",
  automations: "var(--c-auto)",
  external: "var(--c-ext)",
};

/**
 * Los valores que el filtro "respondido por" entiende: los grupos que la
 * funcion SQL reconoce, o el id de una persona.
 *
 * `team` NO es uno de ellos a proposito: el filtro por equipo es por persona.
 * `chat_author_match` acepta 'agent', 'automations', 'external', 'user' y un
 * uuid; mandarle 'flow' devolvia false y dejaba el dashboard en blanco.
 */
export const AUTHOR_FILTER_VALUES = ["agent", "automations", "external", "user"] as const;
export type AuthorFilterGroup = (typeof AUTHOR_FILTER_VALUES)[number];

export function isAuthorFilterGroup(value: string): value is AuthorFilterGroup {
  return (AUTHOR_FILTER_VALUES as readonly string[]).includes(value);
}
