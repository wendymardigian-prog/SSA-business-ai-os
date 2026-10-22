/**
 * La bandeja por CUENTA conectada (00249).
 *
 * Hasta la 00249 un rol daba la bandeja por red (`inbox.<red>.view` / `.reply`) con un solo alcance de
 * conversaciones para todas. Con dos Instagram conectados no se podia dar uno sin el otro, y el chat no
 * tenia "asignadas + sin asignar". Ahora cada rol guarda, en `workspace_roles.permissions.channels`:
 *
 *   { "mode": "all",    "all": { "scope": "own_unassigned", "reply": true } }       // todas, tambien las futuras
 *   { "mode": "custom", "byChannel": { "<channel_id>": { "scope": "all", "reply": false } } }
 *
 * En `custom`, una cuenta que no figura no se ve. `scope` dice QUE conversaciones de esa cuenta: las
 * asignadas (`own`: la conversacion es suya o el contacto lo tiene de setter o vendedor), esas + las que
 * no tienen a nadie (`own_unassigned`), o todas (`all`).
 *
 * Modulo PURO (ni Supabase ni el catalogo): lo usan los permisos, la regla de "no podes dar lo que no
 * tenes", la bandeja y la pantalla de roles. La base tiene su gemela (`private.role_channel_grant`,
 * `public.can_grant_channels`, 00249) y los casos compartidos viven en `channel-permissions.cases.json`.
 */

export const CHANNEL_SCOPES = ["own", "own_unassigned", "all"] as const;
export type ChannelScope = (typeof CHANNEL_SCOPES)[number];

/** Lo que un rol tiene en una cuenta. Sin acceso es `null`, no un objeto. */
export interface ChannelGrant {
  scope: ChannelScope;
  reply: boolean;
}

export type ChannelsConfig =
  | { mode: "all"; all: ChannelGrant }
  | { mode: "custom"; byChannel: Record<string, ChannelGrant> };

/** Una cuenta conectada, con lo minimo que hace falta para mostrarla. */
export interface ChannelRef {
  id: string;
  platform: string;
}

export const CHANNEL_SCOPE_LABELS: Record<ChannelScope | "none", string> = {
  none: "Sin acceso",
  own: "Solo asignadas",
  own_unassigned: "Asignadas + sin asignar",
  all: "Todas",
};

/** Sin acceso a ninguna cuenta. Es lo que vale ante un dato que no se entiende: lo mas angosto. */
export const NO_CHANNELS: ChannelsConfig = { mode: "custom", byChannel: {} };

/** Owner y Admin: todo. */
export const ALL_CHANNELS: ChannelsConfig = { mode: "all", all: { scope: "all", reply: true } };

/** El Member de sistema: lo de siempre (todas las cuentas, solo lo asignado, responde). Copia en SQL: `private.member_channels()`. */
export const MEMBER_CHANNELS: ChannelsConfig = { mode: "all", all: { scope: "own", reply: true } };

const RANK: Record<ChannelScope | "none", number> = { none: 0, own: 1, own_unassigned: 2, all: 3 };

export function channelScopeRank(scope: ChannelScope | "none" | null | undefined): number {
  return RANK[scope ?? "none"] ?? 0;
}

/** Un permiso de cuenta guardado, validado. Lo que no se entiende es "sin acceso" (`null`). */
export function normalizeGrant(value: unknown): ChannelGrant | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { scope?: unknown; reply?: unknown };
  if (!(CHANNEL_SCOPES as readonly string[]).includes(raw.scope as string)) return null;
  return { scope: raw.scope as ChannelScope, reply: raw.reply === true };
}

/**
 * La configuracion guardada, validada. Un valor que falta o que no se entiende es "sin acceso": un rol
 * mal guardado no puede abrir conversaciones. (Los roles anteriores a la 00249 los convierte la
 * migracion; ver `private.channels_from_legacy`.)
 */
export function parseChannels(value: unknown): ChannelsConfig {
  if (!value || typeof value !== "object") return NO_CHANNELS;
  const raw = value as { mode?: unknown; all?: unknown; byChannel?: unknown };
  if (raw.mode === "all") {
    const all = normalizeGrant(raw.all);
    return all ? { mode: "all", all } : NO_CHANNELS;
  }
  if (raw.mode === "custom") {
    const byChannel: Record<string, ChannelGrant> = {};
    if (raw.byChannel && typeof raw.byChannel === "object") {
      for (const [id, grant] of Object.entries(raw.byChannel as Record<string, unknown>)) {
        const normalized = normalizeGrant(grant);
        if (id && normalized) byChannel[id] = normalized;
      }
    }
    return { mode: "custom", byChannel };
  }
  return NO_CHANNELS;
}

/** Lo que el rol tiene en esa cuenta (`null` = no la ve). Gemela de `private.role_channel_grant`. */
export function grantFor(config: ChannelsConfig | null | undefined, channelId: string | null | undefined): ChannelGrant | null {
  if (!config) return null;
  if (config.mode === "all") return config.all;
  if (!channelId) return null;
  return config.byChannel[channelId] ?? null;
}

/** Si ve al menos una cuenta (el menu muestra la Bandeja). */
export function hasAnyChannel(config: ChannelsConfig | null | undefined): boolean {
  if (!config) return false;
  return config.mode === "all" || Object.keys(config.byChannel).length > 0;
}

/** Cambiar el permiso de UNA cuenta. Pasar de "todas" a una cuenta precarga las demas con lo que tenia "todas". */
export function setChannelGrant(
  config: ChannelsConfig,
  channels: ChannelRef[],
  channelId: string,
  grant: ChannelGrant | null,
): ChannelsConfig {
  const byChannel: Record<string, ChannelGrant> =
    config.mode === "all" ? Object.fromEntries(channels.map((c) => [c.id, { ...config.all }])) : { ...config.byChannel };
  if (grant) byChannel[channelId] = normalizeGrant(grant) ?? grant;
  else delete byChannel[channelId];
  return { mode: "custom", byChannel };
}

/** Pasar a "todas las cuentas" con este permiso. */
export function setAllChannels(grant: ChannelGrant): ChannelsConfig {
  return { mode: "all", all: { scope: grant.scope, reply: grant.reply } };
}

/**
 * Pasar a "elegir por cuenta". Desde "todas", cada cuenta conectada arranca con lo que tenia "todas":
 * cambiar el modo no saca nada.
 */
export function toCustomChannels(config: ChannelsConfig, channels: ChannelRef[]): ChannelsConfig {
  if (config.mode === "custom") return config;
  return { mode: "custom", byChannel: Object.fromEntries(channels.map((c) => [c.id, { ...config.all }])) };
}

/** Aplicar el mismo permiso a todas las cuentas conectadas, sin pasar a "todas" (las que se conecten despues no lo reciben). */
export function applyToEveryChannel(channels: ChannelRef[], grant: ChannelGrant | null): ChannelsConfig {
  if (!grant) return { mode: "custom", byChannel: {} };
  return { mode: "custom", byChannel: Object.fromEntries(channels.map((c) => [c.id, { ...grant }])) };
}

/** Si dos configuraciones dan exactamente lo mismo (para no guardar ni auditar un cambio que no es tal). */
export function sameChannels(a: ChannelsConfig, b: ChannelsConfig): boolean {
  return JSON.stringify(canonicalChannels(a)) === JSON.stringify(canonicalChannels(b));
}

/** La forma con las claves ordenadas: la que se guarda y se compara. */
export function canonicalChannels(config: ChannelsConfig): ChannelsConfig {
  if (config.mode === "all") return { mode: "all", all: { scope: config.all.scope, reply: config.all.reply } };
  const byChannel: Record<string, ChannelGrant> = {};
  for (const id of Object.keys(config.byChannel).sort()) {
    const g = config.byChannel[id];
    byChannel[id] = { scope: g.scope, reply: g.reply };
  }
  return { mode: "custom", byChannel };
}

// ── "No podes dar lo que no tenes", para las cuentas ─────────────────────────

/**
 * Si `wanted` da, sobre lo que habia (`before`), algo que `actor` no tiene. Se mira por separado el
 * alcance y el "responder": subir de "solo asignadas" a "todas" exige que quien da vea todas; prender
 * responder exige que quien da responda. Gemela de `private.channel_grant_exceeds`.
 */
export function grantExceeds(wanted: ChannelGrant | null, before: ChannelGrant | null, actor: ChannelGrant | null): boolean {
  if (!wanted) return false;
  const raisesScope = channelScopeRank(wanted.scope) > channelScopeRank(before?.scope);
  if (raisesScope && channelScopeRank(wanted.scope) > channelScopeRank(actor?.scope)) return true;
  const addsReply = wanted.reply && !(before?.reply ?? false);
  return addsReply && !(actor?.reply ?? false);
}

/**
 * Si `actor` puede pasar de `before` a `wanted`. Sacar nunca es una escalada; solo se mira lo que se
 * agrega o se amplia. "Todas las cuentas" (que incluye las futuras) solo lo da quien la tiene.
 * Gemela de `public.can_grant_channels` (sin la rama de Owner/Admin, que decide quien llama).
 */
export function canGrantChannels(actor: ChannelsConfig, wanted: ChannelsConfig | null, before: ChannelsConfig | null): boolean {
  if (!wanted) return true;
  if (wanted.mode === "all") {
    const prev = before?.mode === "all" ? before.all : null;
    const mine = actor.mode === "all" ? actor.all : null;
    return !grantExceeds(wanted.all, prev, mine);
  }
  for (const [id, grant] of Object.entries(wanted.byChannel)) {
    if (grantExceeds(grant, grantFor(before, id), grantFor(actor, id))) return false;
  }
  return true;
}
