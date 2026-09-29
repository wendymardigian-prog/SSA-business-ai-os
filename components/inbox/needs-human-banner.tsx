"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserRoundSearch } from "lucide-react";
import { needsHumanBadge, type NeedsHumanRow } from "@/lib/inbox/needs-human";
import { resolveNeedsHuman } from "@/lib/actions/conversation-status";

/**
 * El aviso de que el asistente no pudo entender lo que llegó (F11).
 *
 * Va en el encabezado del hilo, en rojo, con el motivo escrito y no en un
 * `title`: acá ya no hace falta pasar el mouse, la persona entró justamente a
 * ver qué pasó.
 *
 * El botón "Ya lo vi" existe porque no todo escalado necesita una respuesta: si
 * el lead mandó una ubicación, con verla alcanza. Sin el botón, la bandeja se
 * llenaría de avisos que nadie puede sacar.
 */
export function NeedsHumanBanner({
  conversationId,
  conversation,
}: {
  conversationId: string;
  conversation: NeedsHumanRow;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const badge = needsHumanBadge(conversation);
  if (!badge.show) return null;

  function resolve() {
    start(async () => {
      const result = await resolveNeedsHuman(conversationId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      router.refresh();
    });
  }

  return (
    <div className="border-b border-red-500/30 bg-red-50 px-4 py-2.5 dark:bg-red-950/30">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <UserRoundSearch
          className="h-4 w-4 flex-shrink-0 text-red-600 dark:text-red-400"
          aria-hidden
        />
        <p className="min-w-0 flex-1 text-xs text-red-800 dark:text-red-200">
          <span className="font-semibold">El asistente no respondió.</span>{" "}
          {conversation.needs_human_reason
            ? `${conversation.needs_human_reason}. Contestale vos.`
            : "No pudo entender lo que llegó. Contestale vos."}
        </p>
        <button
          type="button"
          onClick={resolve}
          disabled={pending}
          className="inline-flex h-9 min-h-[36px] flex-shrink-0 items-center gap-1.5 rounded-lg border border-red-500/40 px-3 text-xs font-medium text-red-800 transition-colors hover:bg-red-500/10 disabled:opacity-60 dark:text-red-200"
        >
          {pending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
          Ya lo vi
        </button>
      </div>

      {error && <p className="mt-2 text-xs font-medium text-red-700 dark:text-red-300">{error}</p>}
    </div>
  );
}
