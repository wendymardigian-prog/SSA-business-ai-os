"use client";

import { useRef, useState } from "react";
import { Loader2, Plus, SmilePlus } from "lucide-react";
import { FloatingPanel } from "@/components/tasks/floating";
import { EmojiPickerPanel } from "@/components/ui/emoji-picker";
import type { ReactionCapability } from "@/lib/channels/reactions";
import type { MessageReactionView } from "@/lib/messages/reactions";
import { cn } from "@/lib/utils";

/**
 * Reacciones de un mensaje en la bandeja (A3).
 *
 *  - `ReactionChips`: las reacciones que tiene el mensaje, debajo de la
 *    burbuja. La que puso el negocio se marca y un toque la quita.
 *  - `ReactButton`: el boton "Reaccionar". Se ve al pasar el mouse o al
 *    enfocarlo con el teclado; en pantallas tactiles se ve siempre (no hay
 *    hover). Abre un menu con las reacciones que el CANAL admite: nunca ofrece
 *    una que el proveedor rechaza (`reactionCapability`).
 */

export function ReactionChips({
  reactions,
  inbound,
  busy,
  onRemoveMine,
}: {
  reactions: MessageReactionView[];
  /** El mensaje es del contacto (el chip va a la izquierda). */
  inbound: boolean;
  busy: boolean;
  /** Quitar la reaccion del negocio. */
  onRemoveMine: () => void;
}) {
  if (reactions.length === 0) return null;
  return (
    <ul aria-label="Reacciones" className={cn("mt-1 flex flex-wrap gap-1", inbound ? "justify-start" : "justify-end")}>
      {reactions.map((reaction) => {
        const label = `${reaction.emoji} ${reaction.count > 1 ? `${reaction.count} reacciones` : "1 reacción"}${reaction.mine ? " (tuya)" : reaction.fromContact ? " (del contacto)" : ""}`;
        const content = (
          <>
            <span aria-hidden>{reaction.emoji}</span>
            {reaction.count > 1 && <span className="text-[10px] tabular-nums">{reaction.count}</span>}
          </>
        );
        return (
          <li key={reaction.emoji}>
            {reaction.mine ? (
              <button
                type="button"
                disabled={busy}
                onClick={onRemoveMine}
                aria-label={`${label}. Tocá para quitar tu reacción`}
                title="Tocá para quitar tu reacción"
                className="inline-flex h-6 items-center gap-1 rounded-full border border-primary/50 bg-primary/10 px-1.5 text-xs hover:bg-primary/20 disabled:opacity-60"
              >
                {content}
              </button>
            ) : (
              <span role="img" aria-label={label} className="inline-flex h-6 items-center gap-1 rounded-full border border-border bg-background px-1.5 text-xs">
                {content}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ReactButton({
  capability,
  mine,
  busy,
  onReact,
}: {
  capability: ReactionCapability;
  /** La reaccion que el negocio ya puso, si hay. */
  mine: string | null;
  busy: boolean;
  /** Emoji vacio = quitarla. */
  onReact: (emoji: string) => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  function close() {
    setOpen(false);
    setShowAll(false);
  }

  function choose(emoji: string) {
    close();
    // Tocar la que ya esta puesta la quita.
    onReact(emoji === mine ? "" : emoji);
  }

  return (
    <>
      <button
        ref={anchor}
        type="button"
        disabled={busy}
        aria-label="Reaccionar a este mensaje"
        title="Reaccionar"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-open={open}
        onClick={() => (open ? close() : setOpen(true))}
        className={cn(
          "inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60",
          // Con mouse se ve al pasar por el mensaje o al enfocar; sin hover (tactil) se ve siempre.
          "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100 data-[open=true]:opacity-100",
        )}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <SmilePlus className="h-4 w-4" aria-hidden />}
      </button>
      {open && (
        <FloatingPanel anchor={anchor} onClose={close} label="Reaccionar" width={showAll ? 320 : 300} className={showAll ? "p-0" : "p-1.5"}>
          {showAll ? (
            <EmojiPickerPanel onPick={choose} className="h-72" />
          ) : (
            <div className="flex flex-wrap items-center gap-0.5">
              {capability.quick.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`Reaccionar con ${emoji}`}
                  aria-pressed={mine === emoji}
                  onClick={() => choose(emoji)}
                  className={cn("flex h-11 w-11 items-center justify-center rounded-lg text-2xl hover:bg-accent", mine === emoji && "bg-accent ring-1 ring-primary/50")}
                >
                  {emoji}
                </button>
              ))}
              {capability.anyEmoji && (
                <button type="button" aria-label="Elegir otro emoji" title="Más emojis" onClick={() => setShowAll(true)} className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent">
                  <Plus className="h-5 w-5" aria-hidden />
                </button>
              )}
              {mine && (
                <button type="button" onClick={() => choose(mine)} className="mt-1 h-9 w-full rounded-lg text-xs text-muted-foreground hover:bg-accent">
                  Quitar mi reacción
                </button>
              )}
            </div>
          )}
        </FloatingPanel>
      )}
    </>
  );
}
