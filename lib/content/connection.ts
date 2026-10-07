/**
 * Que red esta "conectada" (Contenido v4, C1 y C2).
 *
 * Es la pregunta que decide si una red se puede programar sola o solo se
 * planifica y se sube a mano. Vive en UN lugar porque la hacen el drawer, el
 * servidor que programa, el calendario y Social, y dos respuestas distintas
 * terminan en una red que la pantalla ofrece programar y el servidor rechaza.
 *
 * Conectada = hay una cuenta activa de esa red **con un publicador usable**
 * (`default_publisher` no nulo). No alcanza con `is_active`: desconectar
 * Zernio no baja `is_active` de las cuentas, solo marca su publicador como no
 * disponible, y la cuenta queda (con su historia) sin poder publicar nada.
 */

export interface AccountForConnection {
  platform: string;
  is_active?: boolean | null;
  default_publisher?: string | null;
}

export function isNetworkConnected(platform: string, accounts: AccountForConnection[]): boolean {
  return accounts.some(
    (a) => a.platform === platform && a.is_active !== false && Boolean(a.default_publisher),
  );
}

/** Las redes conectadas, sin repetir, en el orden en que aparecen. */
export function connectedPlatforms(accounts: AccountForConnection[]): string[] {
  const out: string[] = [];
  for (const account of accounts) {
    if (!out.includes(account.platform) && isNetworkConnected(account.platform, accounts)) {
      out.push(account.platform);
    }
  }
  return out;
}
