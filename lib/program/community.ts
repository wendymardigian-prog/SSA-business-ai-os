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

/** Una comunidad del programa (00402). Sin `community.communities`, el programa tiene una sola: la principal. */
export interface ProgramCommunity {
  key: string;
  name: string;
  main: boolean;
  archived: boolean;
  spaces: CommunitySpace[];
}

/** La clave de la comunidad con que nace todo programa (y donde quedan los posts de antes de la 00402). */
export const MAIN_COMMUNITY_KEY = "principal";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Las comunidades del programa, gemela de `app_servicio.community_list_plan` (00402, community-list.cases.json): sin
 * lista, una sola («Principal», con `community.spaces` o los espacios de fábrica). Una comunidad sin `spaces` usa los de
 * fábrica (la principal, los de `community.spaces`). Si ninguna es la principal, lo es la primera sin archivar.
 */
export function programCommunities(settings: unknown): ProgramCommunity[] {
  const c = isObj(settings) && isObj(settings.community) ? settings.community : {};
  const legacy = Array.isArray(c.spaces) ? (c.spaces as unknown[]) : DEFAULT_SPACES;
  const valid = (Array.isArray(c.communities) ? c.communities : []).filter((x): x is Record<string, unknown> => isObj(x) && typeof x.key === "string");
  const list: Record<string, unknown>[] = valid.length ? valid : [{ key: MAIN_COMMUNITY_KEY, name: "Principal", main: true }];
  let mainAt: number | null = null;
  const out = list.map((x, i) => {
    const archived = x.archived === true;
    const isMain = x.main === true && !archived && mainAt === null;
    if (isMain) mainAt = i;
    const spaces = Array.isArray(x.spaces) ? (x.spaces as unknown[]) : x.main === true ? legacy : DEFAULT_SPACES;
    const name = typeof x.name === "string" && x.name.trim() ? x.name.trim() : (x.key as string);
    return {
      key: x.key as string,
      name,
      main: isMain,
      archived,
      spaces: spaces.filter((s): s is CommunitySpace => isObj(s) && s.key !== LESSON_SPACE),
    };
  });
  if (mainAt === null) {
    const first = out.findIndex((x) => !x.archived);
    out[first < 0 ? 0 : first].main = true;
  }
  return out;
}

/** La comunidad principal del programa. */
export function mainCommunity(settings: unknown): ProgramCommunity {
  const list = programCommunities(settings);
  return list.find((c) => c.main) ?? list[0];
}

/** La comunidad de una variante: la que eligió (si existe y no está archivada) o la principal. */
export function variantCommunityKey(programSettings: unknown, variantPortalSettings: unknown): string {
  const key = isObj(variantPortalSettings) && typeof variantPortalSettings.community_key === "string" ? variantPortalSettings.community_key : null;
  return programCommunities(programSettings).find((c) => c.key === key && !c.archived)?.key ?? mainCommunity(programSettings).key;
}

/** La comunidad que se mira en el panel (`?comunidad=`): la pedida si existe; si no, la principal (R4.1). */
export function pickCommunity(list: ProgramCommunity[], key: string | null | undefined): ProgramCommunity {
  return list.find((c) => c.key === key) ?? list.find((c) => c.main) ?? list[0];
}

/** Problemas al guardar las comunidades desde la pantalla (además de lo que valida la base). `usedBy`: clave → variantes. */
export function communitiesIssues(list: ProgramCommunity[], usedBy: Record<string, string[]> = {}): string[] {
  const out: string[] = [];
  const names = new Set<string>();
  for (const c of list) {
    const n = c.name.trim().toLowerCase();
    if (!n) out.push("Hay una comunidad sin nombre");
    else if (names.has(n)) out.push(`Ya hay una comunidad que se llama ${c.name.trim()}`);
    names.add(n);
    if (c.archived && c.main) out.push("La comunidad principal no se puede archivar");
    if (c.archived && usedBy[c.key]?.length) out.push(`«${c.name.trim()}» la usan estas variantes: ${usedBy[c.key].join(", ")}. Cambiales la comunidad antes de archivarla`);
    for (const issue of spacesIssues(c.spaces)) out.push(list.length > 1 ? `${c.name.trim() || "Comunidad"}: ${issue}` : issue);
  }
  if (list.filter((c) => c.main).length !== 1) out.push("Elegí una sola comunidad principal");
  return out;
}

/**
 * Lo que se guarda en `products.portal_settings.community`: con una sola comunidad, como siempre (`spaces`); con más,
 * la lista entera, y los espacios de la principal también en `spaces` (lo leen los que no conocen las comunidades).
 */
export function communitySettingsPatch(list: ProgramCommunity[], lessonComments: boolean): Record<string, unknown> {
  const main = list.find((c) => c.main) ?? list[0];
  if (list.length === 1 && list[0].key === MAIN_COMMUNITY_KEY && list[0].name === "Principal") {
    return { spaces: main.spaces, lesson_comments: lessonComments };
  }
  return {
    spaces: main.spaces,
    lesson_comments: lessonComments,
    communities: list.map((c) => ({ key: c.key, name: c.name.trim(), main: c.main, archived: c.archived, spaces: c.spaces })),
  };
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
  /** La comunidad elegida en la barra (00402): se conserva en cada opción. Sin elegir, no se agrega a la URL. */
  community?: string | null;
}): Array<{ key: string; label: string; count?: number; href: string }> {
  const keep: Record<string, string> = input.community ? { comunidad: input.community } : {};
  const href = (q: Record<string, string>) => `${input.base}?${new URLSearchParams({ tab: "comunidad", ...keep, ...q })}`;
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
