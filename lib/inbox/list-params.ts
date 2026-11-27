import type { Platform } from "@/lib/platforms";
import { firstParam, listParam, pickEnum, pickIds, sanitizeSearch } from "@/lib/url-params";
import { DATE_PRESETS, type DatePreset } from "@/lib/dates";
import {
  INBOX_STATUS_VALUES,
  DEFAULT_INBOX_STATUS,
  ASSIGNMENT_ANY,
  ASSIGNMENT_UNASSIGNED,
  ASSIGNMENT_AI,
  ASSIGNMENT_MINE,
  HIDE_KNOWN_PARAM,
  HIDE_KNOWN_VALUE,
  HIDE_CUSTOMERS_PARAM,
  LEGACY_VIEW_PARAM,
  LIST_TYPE_PARAM,
  COMMUNITY_PARAM,
  parseCommunityParam,
  UNIDENTIFIED_PARAM,
  parseListType,
  type InboxFilters,
  type InboxStatus,
} from "@/lib/inbox/filters";
import { NEEDS_HUMAN_PARAM } from "@/lib/inbox/needs-human";
import { AWAITING_PARAM, parseAwaitingFilter } from "@/lib/inbox/awaiting";
import { canViewChannel, channelFilterFor } from "@/lib/inbox/channel-access";
import type { RolePermissions } from "@/lib/auth/permissions";

/**
 * Los filtros de la bandeja, leidos de la URL.
 *
 * Lo usan la pagina y las acciones que traen mas chats o los que cambiaron en
 * vivo (`lib/actions/inbox-list.ts`): las tres tienen que entender la URL igual,
 * o un chat apareceria en la lista con un filtro que no cumple.
 *
 * Todo lo que viene de la URL se valida contra lo que existe: una etiqueta, una
 * cuenta o una persona inventada se ignora y nunca llega a la consulta.
 */

export type RawParams = Record<string, string | string[] | undefined>;

export interface InboxListContext {
  /** Las etiquetas del negocio. */
  tagIds: string[];
  /** Las personas del equipo. */
  memberIds: string[];
  /** Las redes que esta persona puede ver. */
  platformOptions: Platform[];
  /** Las cuentas que esta persona puede ver. */
  accountIds: string[];
}

/**
 * El contexto con el que se valida la URL, a partir de lo que ya se leyo de la
 * base: las cuentas activas, las etiquetas y el equipo, y los permisos de quien mira.
 */
export function inboxListContext(input: {
  channels: { id: string; platform: string }[];
  tagIds: string[];
  memberIds: string[];
  permissions: Pick<RolePermissions, "channels"> | null | undefined;
}): InboxListContext & { channelRestriction: string[] | null } {
  // La bandeja por cuenta (00249): cada rol dice que cuentas ve. Cuales conversaciones de cada una
  // (asignadas, + sin asignar, todas) lo aplica la RLS (`can_see_conversation`).
  const channelRestriction = channelFilterFor(input.permissions);
  const visible = input.channels.filter((c) => canViewChannel(input.permissions, c.id));
  const platformsOf = (rows: { platform: string }[]) => [...new Set(rows.map((c) => c.platform))].sort() as Platform[];
  return {
    tagIds: input.tagIds,
    memberIds: input.memberIds,
    platformOptions: channelRestriction ? platformsOf(visible) : platformsOf(input.channels),
    accountIds: visible.map((c) => c.id),
    channelRestriction,
  };
}

export interface ParsedInboxList {
  filters: InboxFilters;
  /** Solo grupos (o una comunidad): no se le pregunta nada a la tabla de conversaciones. */
  onlyGroups: boolean;
}

/** URLSearchParams → el mismo objeto que recibe una pagina de Next. */
export function paramsFromQuery(query: string): RawParams {
  const out: RawParams = {};
  const search = new URLSearchParams(query);
  for (const key of new Set(search.keys())) {
    const values = search.getAll(key);
    out[key] = values.length > 1 ? values : values[0];
  }
  return out;
}

/** Un id de la URL solo vale si es de alguien del equipo. */
export function resolveAssignment(raw: string, memberIds: string[]): string {
  if (!raw) return ASSIGNMENT_ANY;
  if (raw === ASSIGNMENT_UNASSIGNED || raw === ASSIGNMENT_AI || raw === ASSIGNMENT_MINE) return raw;
  return memberIds.includes(raw) ? raw : ASSIGNMENT_ANY;
}

export function parseInboxListParams(params: RawParams, ctx: InboxListContext): ParsedInboxList {
  const search = sanitizeSearch(firstParam(params.q));
  const status = pickEnum<InboxStatus, InboxStatus>(params.estado, INBOX_STATUS_VALUES, DEFAULT_INBOX_STATUS);
  const platforms = listParam(params.canal).filter((p) => (ctx.platformOptions as string[]).includes(p));
  // `?cuenta=` solo vale con ids de cuentas que esta persona ve: uno inventado o ajeno se ignora.
  const channelIds = pickIds(params.cuenta, ctx.accountIds);
  const tagIds = pickIds(params.tag, ctx.tagIds);
  const assignment = resolveAssignment(firstParam(params.asignado), ctx.memberIds);
  const datePreset = pickEnum<DatePreset>(params.fecha, DATE_PRESETS);
  const dateFrom = firstParam(params.desde);
  const dateTo = firstParam(params.hasta);
  const agentError = firstParam(params["error-agente"]) === "1";
  // F11: las que el agente derivó porque no pudo entender lo que llegó.
  const needsHuman = firstParam(params[NEEDS_HUMAN_PARAM]) === "1";
  // 00259: esperando respuesta (se puede responder / ventana vencida), el mismo
  // criterio que la tarjeta del dashboard de Chat.
  const awaiting = parseAwaitingFilter(firstParam(params[AWAITING_PARAM]));
  // Conocidos (00256) y clientes (00268): esconderlos de la lista.
  const hideKnown = firstParam(params[HIDE_KNOWN_PARAM]) === HIDE_KNOWN_VALUE;
  const hideCustomers = firstParam(params[HIDE_CUSTOMERS_PARAM]) === HIDE_KNOWN_VALUE;
  // 00296: las que le escribio el negocio y la persona nunca respondio. Se ocultan por defecto.
  const onlyUnidentified = firstParam(params[UNIDENTIFIED_PARAM]) === "1";
  // Chats, grupos o los dos. `?vista=grupos` es el link viejo de cuando los grupos eran otra pantalla.
  const listType = parseListType(firstParam(params[LIST_TYPE_PARAM]), firstParam(params[LEGACY_VIEW_PARAM]));
  // Solo los grupos de una comunidad (00344): una comunidad no tiene chats, asi que es como "solo grupos".
  const communityJid = parseCommunityParam(firstParam(params[COMMUNITY_PARAM]));

  return {
    onlyGroups: listType === "grupos" || !!communityJid,
    filters: {
      search,
      status,
      // Con una comunidad la lista es de grupos: el Realtime de chats no tiene que meter ninguno.
      listType: communityJid ? "grupos" : listType,
      communityJid,
      platforms,
      channelIds,
      tagIds,
      assignment,
      datePreset,
      dateFrom,
      dateTo,
      agentError,
      needsHuman,
      awaiting,
      hideKnown,
      hideCustomers,
      onlyUnidentified,
    },
  };
}

/** Lo que no cambia la lista: el chat o el grupo abierto y la pagina vieja. */
const NOT_LIST_PARAMS = new Set(["c", "g", "page"]);

/**
 * La parte de la URL que decide QUE chats se ven, ordenada. Viaja a las acciones
 * (que la vuelven a validar) y sirve para saber si cambiaron los filtros.
 */
export function listQueryOf(params: RawParams): string {
  const out = new URLSearchParams();
  for (const key of Object.keys(params).sort()) {
    if (NOT_LIST_PARAMS.has(key)) continue;
    const value = params[key];
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) out.append(key, v);
  }
  return out.toString();
}
