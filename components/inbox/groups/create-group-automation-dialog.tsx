"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ContentDialog } from "@/components/content/dialog";
import { EmojiButton } from "@/components/ui/emoji-picker";
import { WHATSAPP_QUICK_REACTIONS } from "@/lib/channels/reactions";
import { createAutomationFromGroupMessage } from "@/lib/actions/whatsapp-group-inbox";

const QUICK = Array.from(new Set([...WHATSAPP_QUICK_REACTIONS, "🔥"]));

/**
 * «Crear automatización» desde un mensaje de un grupo: cuando alguien reaccione a ESTE mensaje (con cualquier
 * emoji o con los elegidos), o vote en ESTA encuesta (cualquier opción o las elegidas). Crea la automatización en
 * borrador con el disparador armado y la abre para agregar los pasos.
 */
export function CreateGroupAutomationDialog({
  messageId,
  messageLabel,
  pollOptions,
  onClose,
}: {
  messageId: string;
  messageLabel: string;
  /** Si el mensaje es una encuesta, sus opciones. */
  pollOptions: string[] | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<"reaction" | "poll_vote">(pollOptions ? "poll_vote" : "reaction");
  const [emojis, setEmojis] = useState<string[]>([]);
  const [options, setOptions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  function create() {
    setError(null);
    start(async () => {
      const result = await createAutomationFromGroupMessage({ messageId, kind, emojis: kind === "reaction" ? emojis : [], options: kind === "poll_vote" ? options : [] });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/dashboard/flows/${result.flowId}`);
    });
  }

  return (
    <ContentDialog
      title="Crear automatización"
      label="Crear automatización"
      onClose={onClose}
      footer={
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
            Cancelar
          </button>
          <button
            type="button"
            onClick={create}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Crear y abrir
          </button>
        </div>
      }
    >
      <p className="line-clamp-2 text-xs text-muted-foreground">{messageLabel}</p>

      <fieldset className="space-y-1.5 text-sm">
        <legend className="mb-1 text-xs font-semibold">Cuándo arranca</legend>
        {pollOptions && (
          <label className="flex items-center gap-2">
            <input type="radio" name="group-auto-kind" checked={kind === "poll_vote"} onChange={() => setKind("poll_vote")} />
            Cuando alguien vote en esta encuesta
          </label>
        )}
        <label className="flex items-center gap-2">
          <input type="radio" name="group-auto-kind" checked={kind === "reaction"} onChange={() => setKind("reaction")} />
          Cuando alguien reaccione a este mensaje
        </label>
      </fieldset>

      {kind === "reaction" ? (
        <fieldset>
          <legend className="mb-1.5 text-xs font-semibold">Con qué emoji</legend>
          <div className="flex flex-wrap items-center gap-1">
            {Array.from(new Set([...QUICK, ...emojis])).map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-pressed={emojis.includes(emoji)}
                onClick={() => setEmojis(toggle(emojis, emoji))}
                className={`rounded-md border px-1.5 py-0.5 text-base ${emojis.includes(emoji) ? "border-primary-edge bg-primary/10" : "border-border hover:bg-muted"}`}
              >
                {emoji}
              </button>
            ))}
            <EmojiButton label="Otro emoji" placement="bottom" onPick={(emoji) => setEmojis((list) => (list.includes(emoji) ? list : [...list, emoji]))} />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">Sin elegir ninguno, con cualquier emoji.</p>
        </fieldset>
      ) : (
        <fieldset>
          <legend className="mb-1.5 text-xs font-semibold">Qué opción</legend>
          <div className="space-y-1">
            {(pollOptions ?? []).map((option) => (
              <label key={option} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={options.includes(option)} onChange={() => setOptions(toggle(options, option))} />
                {option}
              </label>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">Sin elegir ninguna, cualquier opción.</p>
        </fieldset>
      )}

      <p className="text-[11px] text-muted-foreground">
        Se crea en borrador. Después agregás los pasos (por ejemplo, mandarle el link por privado) y la publicás.
      </p>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}
    
    </ContentDialog>
  );
}
