// @plantilla-quitar(servicios)
/**
 * La comunidad del programa (F76, F77, F111), puro. Gemela de `app_servicio.community_can_post_plan(jsonb)` (00351):
 * los casos de `community.cases.json` corren contra las dos. Un comentario en una clase es un post del espacio
 * reservado «clases» con su `program_item_id`.
 */

export const LESSON_SPACE = "clases";

export interface CommunitySpace {
  key: string;
  name: string;
  team_only?: boolean;
  archived?: boolean;
}

/** Los espacios con que nace la comunidad de un programa si nunca se configuraron. «Anuncios» publica solo el equipo. */
export const DEFAULT_SPACES: CommunitySpace[] = [
  { key: "anuncios", name: "Anuncios", team_only: true },
  { key: "general", name: "General" },
  { key: "victorias", name: "Victorias" },
];

export function programSpaces(settings: unknown): CommunitySpace[] {
  const c = (settings && typeof settings === "object" ? (settings as { community?: { spaces?: unknown } }).community : null) ?? null;
  const list = Array.isArray(c?.spaces) ? (c!.spaces as CommunitySpace[]) : DEFAULT_SPACES;
  return list.filter((s) => s && typeof s.key === "string" && s.key !== LESSON_SPACE);
}

export function lessonCommentsOn(settings: unknown): boolean {
  const c = (settings && typeof settings === "object" ? (settings as { community?: { lesson_comments?: unknown } }).community : null) ?? null;
  return c?.lesson_comments !== false;
}

export interface CanPostInput {
  author: "student" | "team";
  /** La sección Comunidad prendida en el programa. */
  sectionOn: boolean;
  /** El estudiante tiene acceso Comunidad vigente (para un post del muro). */
  hasAccess: boolean;
  muted: boolean;
  /** El espacio del muro (null si no existe). Para un comentario de clase, null. */
  space: { team_only?: boolean; archived?: boolean } | null;
  lessonComment: boolean;
  /** «Permitir comentarios en las clases» del programa. */
  lessonCommentsOn: boolean;
  /** La clase (para un comentario de clase): existe, activa, con comentarios y abierta para ese estudiante. */
  item: { active: boolean; commentsEnabled: boolean; unlocked: boolean } | null;
}

export type CanPost = { ok: true } | { ok: false; reason: string };

export function canPost(i: CanPostInput): CanPost {
  if (i.lessonComment) {
    if (!i.item) return { ok: false, reason: "No existe la clase" };
    if (!i.lessonCommentsOn || !i.item.commentsEnabled) return { ok: false, reason: "Los comentarios de esta clase están apagados" };
    if (i.author === "team") return { ok: true };
    if (i.muted) return { ok: false, reason: "Estás silenciado en la comunidad" };
    if (!i.item.active || !i.item.unlocked) return { ok: false, reason: "Esta clase todavía no está abierta" };
    return { ok: true };
  }
  if (!i.space || i.space.archived) return { ok: false, reason: "No existe ese espacio" };
  if (i.author === "team") return { ok: true };
  if (!i.sectionOn) return { ok: false, reason: "La comunidad está apagada" };
  if (!i.hasAccess) return { ok: false, reason: "No tenés acceso a la comunidad" };
  if (i.muted) return { ok: false, reason: "Estás silenciado en la comunidad" };
  if (i.space.team_only) return { ok: false, reason: "En este espacio publica solo el equipo" };
  return { ok: true };
}

/** Problemas al guardar los espacios (además de lo que valida la base). */
export function spacesIssues(spaces: CommunitySpace[]): string[] {
  const out: string[] = [];
  const keys = new Set<string>();
  for (const s of spaces) {
    if (!/^[a-z0-9_]{1,40}$/.test(s.key ?? "") || !(s.name ?? "").trim()) out.push("Hay un espacio sin nombre");
    else if (s.key === LESSON_SPACE) out.push("«clases» es el espacio de los comentarios de las clases");
    else if (keys.has(s.key)) out.push(`El espacio ${s.name} está repetido`);
    keys.add(s.key);
  }
  if (!spaces.some((s) => !s.archived)) out.push("Dejá al menos un espacio activo");
  return out;
}

/** Una clave para un espacio nuevo a partir de su nombre, que no choque con las que ya hay. */
export function spaceKeyFor(name: string, taken: string[]): string {
  const base = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "espacio";
  let key = base === LESSON_SPACE ? `${base}_1` : base;
  for (let n = 2; taken.includes(key); n++) key = `${base}_${n}`;
  return key;
}

/** Las opciones del filtro rapido de la Comunidad (barra superior, Servicios A2): las de siempre, con su conteo. */
export function communityQuickOptions(input: {
  base: string;
  spaces: CommunitySpace[];
  counts: { unanswered: number; reported: number };
}): Array<{ key: string; label: string; count?: number; href: string }> {
  const href = (q: Record<string, string>) => `${input.base}?${new URLSearchParams({ tab: "comunidad", ...q })}`;
  return [
    { key: "all", label: "Todo", href: href({}) },
    { key: "unanswered", label: "Sin contestar · 30 días", count: input.counts.unanswered, href: href({ filtro: "sin-contestar" }) },
    { key: "reported", label: "Reportados", count: input.counts.reported, href: href({ filtro: "reportados" }) },
    ...input.spaces.filter((s) => !s.archived).map((s) => ({ key: `esp:${s.key}`, label: s.name, href: href({ espacio: s.key }) })),
    { key: `esp:${LESSON_SPACE}`, label: "Clases", href: href({ espacio: LESSON_SPACE }) },
  ];
}

/** Que opcion esta elegida, con la misma regla de antes (un filtro gana sobre un espacio). */
export function communityQuickValue(filter: "all" | "unanswered" | "reported", space: string | null): string {
  if (filter !== "all") return filter;
  return space ? `esp:${space}` : "all";
}
