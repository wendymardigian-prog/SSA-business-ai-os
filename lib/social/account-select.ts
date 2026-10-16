/**
 * El selector de la pagina Social con varias cuentas de la misma red (00236).
 *
 * Una red con UNA cuenta se elige por su nombre ("Instagram"), como siempre. Una red con VARIAS ofrece una opcion por
 * cuenta ("Instagram · @marca_academia"), agrupadas bajo el nombre de la red. El valor de cada opcion es `platform`
 * o `acc:<id de la cuenta>`.
 *
 * Modulo PURO.
 */

export interface SocialAccountOption {
  id: string;
  platform: string;
  /** "@usuario", o el nombre de la cuenta. */
  label: string;
}

export interface SocialSelection {
  platform: string;
  /** La cuenta elegida; null en una red sin cuentas o con una sola. */
  accountId: string | null;
}

const ACCOUNT_PREFIX = "acc:";

export const accountsOf = (accounts: SocialAccountOption[], platform: string) =>
  accounts.filter((a) => a.platform === platform);

/** El valor de una opcion del selector. */
export function selectionValue(selection: SocialSelection): string {
  return selection.accountId ? `${ACCOUNT_PREFIX}${selection.accountId}` : selection.platform;
}

/** Lo que eligio la persona, a partir del valor de la opcion. Un valor desconocido vuelve a la red por defecto. */
export function parseSelection(value: string, accounts: SocialAccountOption[], fallbackPlatform: string): SocialSelection {
  if (value.startsWith(ACCOUNT_PREFIX)) {
    const account = accounts.find((a) => a.id === value.slice(ACCOUNT_PREFIX.length));
    if (account) return { platform: account.platform, accountId: account.id };
    return { platform: fallbackPlatform, accountId: null };
  }
  return { platform: value, accountId: null };
}

/**
 * La cuenta que se esta mirando: la elegida si es de la red, y si no la primera de la red (la mas antigua: las
 * cuentas llegan ordenadas). Null si la red no tiene cuentas conectadas.
 */
export function activeAccountOf(accounts: SocialAccountOption[], selection: SocialSelection): SocialAccountOption | null {
  const list = accountsOf(accounts, selection.platform);
  return list.find((a) => a.id === selection.accountId) ?? list[0] ?? null;
}

/**
 * Si una publicacion es de la cuenta que se mira. En una red con una sola cuenta es de ella (todo, incluso lo que no
 * guardo cuenta); con varias, una publicacion sin cuenta guardada (lo de antes de conectar la segunda) es de la
 * primera, que era la unica entonces.
 */
export function tileBelongsToAccount(
  tile: { socialAccountId?: string | null },
  accounts: SocialAccountOption[],
  platform: string,
  active: SocialAccountOption | null,
): boolean {
  const list = accountsOf(accounts, platform);
  if (list.length <= 1 || !active) return true;
  return (tile.socialAccountId ?? list[0].id) === active.id;
}
