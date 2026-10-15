/**
 * Que toque sugerirle a quien carga una venta (Extra I, F46).
 *
 * Por defecto la venta se atribuye al ULTIMO toque del contacto. Pero si ese ultimo toque es `direct` (un mensaje
 * "hola, quiero comprar" que no dice de donde vino) y el contacto tiene un toque anterior CON origen (contenido
 * organico, pauta o referido), el que hizo que esa persona llegara hasta ahi suele ser el segundo. Se le sugiere
 * ese, con el motivo, y la persona decide ("Usar el último toque igual").
 *
 *   - sin toques ........................................ null
 *   - un solo toque ..................................... ese, motivo `only_touch`
 *   - el ultimo tiene origen (organico/pauta/referido) .. el ultimo, motivo `last_touch`
 *   - el ultimo es directo y hay uno anterior con origen .. el ultimo con origen, motivo `last_is_direct`
 *   - el ultimo es directo y no hay ninguno con origen ... el ultimo, motivo `last_touch`
 *
 * "Ultimo" se decide por el mismo orden que `record_contact_touch`: `occurred_at desc, created_at desc, id desc`.
 * El canal es el guardado en el toque; si la fila no lo trae, se calcula con `touchChannel`.
 *
 * Modulo PURO.
 */
import { isOriginChannel, touchChannel, TOUCH_CHANNELS, type TouchChannel, type TouchChannelInput } from "@/lib/attribution/channel";

export type SuggestReason = "last_touch" | "last_is_direct" | "only_touch";

export interface SuggestTouchInput extends TouchChannelInput {
  id: string;
  occurred_at: string;
  created_at?: string | null;
  /** `contact_touches.channel`. Si falta o no es un canal, se calcula con los demas campos. */
  channel?: string | null;
}

export interface SuggestedTouch {
  touchId: string;
  reason: SuggestReason;
}

const time = (iso: string | null | undefined): number => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** Del mas nuevo al mas viejo (el orden de `record_contact_touch`). */
function newestFirst(a: SuggestTouchInput, b: SuggestTouchInput): number {
  return (
    time(b.occurred_at) - time(a.occurred_at) ||
    time(b.created_at) - time(a.created_at) ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  );
}

function channelFor(touch: SuggestTouchInput): TouchChannel {
  if (touch.channel && (TOUCH_CHANNELS as readonly string[]).includes(touch.channel)) return touch.channel as TouchChannel;
  return touchChannel(touch);
}

/** El toque a sugerir y por que, o null si el contacto no tiene toques. */
export function suggestSaleTouch(touches: readonly SuggestTouchInput[] | null | undefined): SuggestedTouch | null {
  if (!touches || touches.length === 0) return null;

  const sorted = [...touches].sort(newestFirst);
  const last = sorted[0];

  if (sorted.length === 1) return { touchId: last.id, reason: "only_touch" };
  if (channelFor(last) !== "direct") return { touchId: last.id, reason: "last_touch" };

  const lastWithOrigin = sorted.find((t) => isOriginChannel(channelFor(t)));
  if (lastWithOrigin) return { touchId: lastWithOrigin.id, reason: "last_is_direct" };

  return { touchId: last.id, reason: "last_touch" };
}
