"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { MessageText } from "@/components/inbox/message-text";
import { emailBubbleParts, readableQuote } from "@/lib/email/quoted-reply";

/** El cuerpo de un email entrante: lo que escribió la persona, y lo que su correo citó, cerrado. */
export function EmailMessageBody({ message }: { message: { text?: string | null; email_quoted_text?: string | null } }) {
  const [open, setOpen] = useState(false);
  const { reply, quoted } = emailBubbleParts(message);
  return (
    <>
      <p className="whitespace-pre-wrap break-words">
        <MessageText text={reply} />
      </p>
      {quoted && (
        <div className="mt-2">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded text-xs font-medium opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
            {open ? "Ocultar mensaje citado" : "Ver mensaje citado"}
          </button>
          {open && (
            <p className="mt-2 whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-xs opacity-70">
              <MessageText text={readableQuote(quoted)} />
            </p>
          )}
        </div>
      )}
    </>
  );
}
