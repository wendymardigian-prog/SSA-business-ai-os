/**
 * Con que cuenta se publica una red (varias cuentas de la misma red, 00236).
 *
 * Cada red de una pieza puede llevar `networks[].account_id`: la cuenta PRINCIPAL desde la que sale. Sin el (todas
 * las piezas de antes), se usa la cuenta por defecto de la red: la mas antigua que este activa y tenga por donde
 * publicar. Asi una pieza vieja sigue saliendo por la misma cuenta que siempre, aunque despues se conecte otra.
 *
 * Modulo PURO: lo usan programar, "marcar como publicado" y el editor.
 */

export interface ChoosableAccount {
  id: string;
  platform: string;
  is_active?: boolean | null;
  default_publisher?: string | null;
  created_at?: string | null;
  username?: string | null;
  display_name?: string | null;
}

const usable = (a: ChoosableAccount) => a.is_active !== false && Boolean(a.default_publisher);

/** Las cuentas de una red, la mas antigua primero (el desempate es el id, para que el orden no cambie). */
export function accountsOfPlatform<T extends ChoosableAccount>(accounts: T[], platform: string): T[] {
  return accounts
    .filter((a) => a.platform === platform && a.is_active !== false)
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id.localeCompare(b.id));
}

/** La cuenta por defecto de una red: la mas antigua con publicador; si ninguna lo tiene, la mas antigua activa. */
export function defaultAccountOf<T extends ChoosableAccount>(accounts: T[], platform: string): T | null {
  const list = accountsOfPlatform(accounts, platform);
  return list.find(usable) ?? list[0] ?? null;
}

export type AccountChoice<T extends ChoosableAccount> = { ok: true; account: T | null } | { ok: false; error: string };

/**
 * La cuenta con la que sale una red. `requestedId` es el `account_id` guardado en la pieza.
 *
 * Una cuenta pedida que ya no existe, se desconecto o es de otra red NO se reemplaza en silencio por otra: se dice,
 * porque publicar en la cuenta equivocada no se deshace.
 */
export function resolveNetworkAccount<T extends ChoosableAccount>(
  accounts: T[],
  platform: string,
  requestedId?: string | null,
): AccountChoice<T> {
  if (!requestedId) return { ok: true, account: defaultAccountOf(accounts, platform) };

  const account = accounts.find((a) => a.id === requestedId && a.platform === platform && a.is_active !== false);
  if (!account) {
    return { ok: false, error: `La cuenta elegida para ${platform} ya no esta conectada. Elegi otra.` };
  }
  if (!account.default_publisher) {
    return { ok: false, error: `La cuenta elegida para ${platform} no tiene por donde publicar. Revisa la conexion en Integraciones.` };
  }
  return { ok: true, account };
}

/** El nombre de una cuenta para mostrar: "@usuario", o su nombre, o la red. */
export function accountName(account: Pick<ChoosableAccount, "username" | "display_name" | "platform">): string {
  const user = account.username?.trim().replace(/^@+/, "");
  if (user) return `@${user}`;
  return account.display_name?.trim() || account.platform;
}
