/**
 * Las reacciones de un mensaje, listas para dibujar (A3). Puro.
 *
 * Una reaccion se guarda por el id con el que el PROVEEDOR conoce el mensaje
 * (`platform_message_id`), porque el hilo de Instagram se lee en vivo de Zernio
 * y muchos mensajes no tienen fila propia. Cuando la tienen, tambien se une por
 * `message_id`. Un mensaje se reconoce por cualquiera de sus dos ids: el de
 * Zernio y el nativo de Meta (ver docs/flujo-de-mensajes.md).
 */

export interface ReactionRow {
  message_id: string | null;
  platform_message_id: string;
  emoji: string;
  actor_key: "business" | "contact";
  removed_at: string | null;
  created_at?: string;
}

export interface ReactionTargetIds {
  id: string;
  platform_message_id?: string | null;
  platform_native_message_id?: string | null;
}

export interface MessageReactionView {
  emoji: string;
  count: number;
  /** ¿La puso el negocio? Marca el chip como "tuyo" y permite quitarla con un toque. */
  mine: boolean;
  /** ¿La puso el contacto? */
  fromContact: boolean;
}

export function reactionBelongsTo(row: ReactionRow, message: ReactionTargetIds): boolean {
  if (row.message_id && row.message_id === message.id) return true;
  const ids = [message.platform_message_id, message.platform_native_message_id].filter((id): id is string => !!id);
  return ids.includes(row.platform_message_id);
}

/** Los chips de un mensaje: una reaccion por emoji, con quien la puso. Las quitadas no cuentan. */
export function reactionsForMessage(rows: ReactionRow[], message: ReactionTargetIds): MessageReactionView[] {
  const byEmoji = new Map<string, MessageReactionView & { firstAt: string }>();
  for (const row of rows) {
    if (row.removed_at || !reactionBelongsTo(row, message)) continue;
    const view = byEmoji.get(row.emoji) ?? { emoji: row.emoji, count: 0, mine: false, fromContact: false, firstAt: row.created_at ?? "" };
    view.count += 1;
    if (row.actor_key === "business") view.mine = true;
    else view.fromContact = true;
    byEmoji.set(row.emoji, view);
  }
  return [...byEmoji.values()]
    .sort((a, b) => a.firstAt.localeCompare(b.firstAt))
    .map(({ firstAt, ...view }) => {
      void firstAt;
      return view;
    });
}

/** La reaccion que el negocio le puso a este mensaje (para marcarla en el menu y poder quitarla), o null. */
export function myReaction(rows: ReactionRow[], message: ReactionTargetIds): string | null {
  const mine = rows.find((row) => !row.removed_at && row.actor_key === "business" && reactionBelongsTo(row, message));
  return mine?.emoji ?? null;
}
