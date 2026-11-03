"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Bot, MoreHorizontal } from "lucide-react";
import { MediaAttachment } from "@/components/inbox/media-attachment";
import type { ThreadMessage } from "@/lib/whatsapp-groups/thread";
import { cn } from "@/lib/utils";
import { CreateGroupAutomationDialog } from "./create-group-automation-dialog";

/**
 * Un mensaje del hilo de un grupo: quién lo escribió (con link a su ficha si es contacto), los adjuntos, el texto,
 * los resultados de una encuesta y las reacciones. El «⋯» ofrece «Crear automatización» en los mensajes del
 * negocio y en las encuestas.
 */
export function GroupMessageBubble({ message, canCreateAutomation }: { message: ThreadMessage; canCreateAutomation: boolean }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const time = new Date(message.createdAt).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  const offerAutomation = canCreateAutomation && !message.failed && (message.outbound || message.poll !== null);
  const label = message.poll ? `📊 ${message.poll.name}` : message.text?.trim() || "Mensaje";

  return (
    <div className={cn("group flex flex-col", message.outbound ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3 py-2 text-sm md:max-w-[70%]",
          message.outbound ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-muted text-foreground",
          message.failed && "border border-red-500/50 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100",
        )}
      >
        {message.senderLabel &&
          (message.contactId ? (
            <Link href={`/dashboard/contacts/${message.contactId}`} className="mb-0.5 block text-xs font-semibold text-primary-ink hover:underline">
              {message.senderLabel}
            </Link>
          ) : (
            <p className="mb-0.5 text-xs font-semibold text-muted-foreground">{message.senderLabel}</p>
          ))}

        {message.attachments.length > 0 && (
          <div className="mb-1 space-y-1">
            {message.attachments.map((item, index) => (
              <MediaAttachment key={index} item={item} />
            ))}
          </div>
        )}

        {message.poll ? (
          <div className="min-w-[min(240px,100%)] space-y-1.5">
            <p className="font-semibold">📊 {message.poll.name}</p>
            <p className={cn("text-[11px]", message.outbound ? "text-primary-foreground/80" : "text-muted-foreground")}>
              {message.poll.multiple ? "Se puede elegir más de una" : "Una sola opción"} · {message.poll.totalVoters === 1 ? "1 voto" : `${message.poll.totalVoters} votos`}
            </p>
            {message.poll.options.map((option) => {
              const percent = message.poll!.totalVoters > 0 ? Math.round((option.count / message.poll!.totalVoters) * 100) : 0;
              return (
                <div key={option.name} title={option.voters.join(", ")}>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span>{option.name}</span>
                    <span className="tabular-nums">{option.count}</span>
                  </div>
                  <div className={cn("h-1.5 overflow-hidden rounded-full", message.outbound ? "bg-primary-foreground/25" : "bg-background")}>
                    <div className={cn("h-full rounded-full", message.outbound ? "bg-primary-foreground" : "bg-primary")} style={{ width: `${percent}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          message.text && <p className="whitespace-pre-wrap break-words">{message.text}</p>
        )}
      </div>

      {message.reactions.length > 0 && (
        <div className="-mt-1 flex flex-wrap gap-1 px-1">
          {message.reactions.map((r) => (
            <span key={r.emoji} className="rounded-full border border-border bg-background px-1.5 text-xs shadow-sm">
              {r.emoji} {r.count > 1 ? <span className="tabular-nums text-muted-foreground">{r.count}</span> : null}
            </span>
          ))}
        </div>
      )}

      <div className="mt-0.5 flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
        {message.fromFlow && <Bot className="h-3 w-3" aria-label="Lo mandó una automatización" />}
        <span>{time}</span>
        {message.failed && (
          <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-300">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            {message.sendError ?? "No se mandó"}
          </span>
        )}
        {offerAutomation && (
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            aria-label="Crear automatización con este mensaje"
            title="Crear automatización"
            className="rounded p-0.5 opacity-100 hover:bg-muted md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
          >
            <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>

      {dialogOpen && (
        <CreateGroupAutomationDialog
          messageId={message.id}
          messageLabel={label}
          pollOptions={message.poll ? message.poll.options.map((o) => o.name) : null}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </div>
  );
}
