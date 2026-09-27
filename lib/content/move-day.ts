/**
 * Mover una pieza de día en el calendario (C14).
 *
 * Arrastrar cambia el DÍA y conserva la HORA: mover del martes al jueves es
 * "sale el jueves a la misma hora", no "sale el jueves a las 00:00". Perder
 * la hora obligaría a volver al editor a ponerla de nuevo, y arrastrar
 * dejaría de servir.
 *
 * Puro: decide, no escribe.
 */

import { dayIn } from "./calendar";

export interface MovableNetwork {
  platform: string;
  planned_at?: string | null;
}

export type MoveDecision =
  | { ok: true; networks: MovableNetwork[]; moved: string[] }
  | { ok: false; error: string };

/**
 * Las fechas nuevas al soltar una pieza en otro día.
 *
 * Mueve solo las redes que salían ESE día: una pieza que sale el martes en
 * Instagram y el viernes en TikTok, arrastrada desde el martes, mueve
 * Instagram y deja TikTok donde estaba.
 */
export function moveToDay(params: {
  networks: MovableNetwork[];
  fromDay: string;
  toDay: string;
  timeZone: string;
  now?: Date;
}): MoveDecision {
  const { networks, fromDay, toDay, timeZone } = params;
  const now = params.now ?? new Date();

  const [y, m, d] = toDay.split("-").map(Number);
  const [fy, fm, fd] = fromDay.split("-").map(Number);
  if (!y || !m || !d || !fy || !fm || !fd) {
    return { ok: false, error: "Ese dia no se entiende." };
  }

  // Cuántos días hay que correr. Se aplica al instante guardado, así la hora
  // en la zona del negocio no cambia ni cruzando un horario de verano.
  const dias = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);

  const moved: string[] = [];

  const out = networks.map((network) => {
    if (!network.planned_at) return network;
    if (dayIn(network.planned_at, timeZone) !== fromDay) return network;

    const movido = new Date(new Date(network.planned_at).getTime() + dias * 86_400_000);
    moved.push(network.platform);
    return { ...network, planned_at: movido.toISOString() };
  });

  if (moved.length === 0) {
    return { ok: false, error: "Esa pieza no tiene ninguna red ese dia." };
  }

  const primera = out
    .filter((n) => n.planned_at && moved.includes(n.platform))
    .map((n) => new Date(n.planned_at!).getTime())
    .sort()[0];

  if (primera !== undefined && primera < now.getTime()) {
    return { ok: false, error: "Esa fecha ya paso: elegi un dia de aca en adelante." };
  }

  return { ok: true, networks: out, moved };
}
