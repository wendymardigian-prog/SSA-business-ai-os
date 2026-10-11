"use client";

import { useState, useTransition } from "react";
import { Loader2, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { setMemberCloser } from "@/lib/actions/team";
import { MAX_CLOSER_EMAILS, normalizeFathomEmail } from "@/lib/fathom/closers";

/**
 * "Closer" de una persona del equipo (F4): quien graba llamadas de venta. Solo
 * entran desde Fathom las llamadas de quien esta marcado. Los correos alternos
 * son con los que graba en Fathom o Zoom si no es el de su cuenta.
 */
export function CloserControl({
  userId,
  name,
  initialIsCloser,
  initialEmails,
  onSaved,
}: {
  userId: string;
  name: string;
  initialIsCloser: boolean;
  initialEmails: string[];
  onSaved?: (value: { isCloser: boolean; emails: string[] }) => void;
}) {
  const [isCloser, setIsCloser] = useState(initialIsCloser);
  const [emails, setEmails] = useState(initialEmails);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  function save(next: { isCloser: boolean; emails: string[] }) {
    setError(null);
    setSaved(false);
    start(async () => {
      const result = await setMemberCloser({ userId, isCloser: next.isCloser, closerEmails: next.emails });
      if (!result.ok) {
        setError(result.error);
        // Vuelve a lo que estaba guardado: la pantalla no puede decir otra cosa que la base.
        setIsCloser(isCloser);
        setEmails(emails);
        return;
      }
      setIsCloser(next.isCloser);
      setEmails(result.emails);
      setSaved(true);
      onSaved?.({ isCloser: next.isCloser, emails: result.emails });
    });
  }

  function addDraft() {
    const email = normalizeFathomEmail(draft);
    if (!email) {
      setError("Ese correo no parece válido");
      return;
    }
    if (emails.includes(email)) {
      setDraft("");
      return;
    }
    if (emails.length >= MAX_CLOSER_EMAILS) {
      setError(`Podés cargar hasta ${MAX_CLOSER_EMAILS} correos alternos`);
      return;
    }
    setDraft("");
    save({ isCloser, emails: [...emails, email] });
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs font-medium">
          <Switch
            checked={isCloser}
            disabled={pending}
            label={`${name} es closer`}
            size="sm"
            onChange={(value) => save({ isCloser: value, emails })}
          />
          Closer
        </label>
        <span className="text-[11px] text-muted-foreground">
          {isCloser ? "Sus llamadas de Fathom entran al sistema." : "Sus llamadas de Fathom no entran."}
        </span>
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />}
        {saved && !pending && <span className="text-[11px] text-emerald-600 dark:text-emerald-400">Guardado</span>}
      </div>

      {isCloser && (
        <div className="mt-2">
          <p className="text-[11px] text-muted-foreground">
            Correos con los que graba en Fathom o Zoom, si no es el de su cuenta (hasta {MAX_CLOSER_EMAILS}).
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {emails.map((email) => (
              <span key={email} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                {email}
                <button
                  type="button"
                  aria-label={`Quitar ${email}`}
                  disabled={pending}
                  onClick={() => save({ isCloser, emails: emails.filter((e) => e !== email) })}
                  className="rounded-full text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </span>
            ))}
            <input
              type="email"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addDraft();
                }
              }}
              onBlur={() => draft.trim() && addDraft()}
              placeholder="Sumar un correo"
              aria-label={`Sumar un correo alterno para ${name}`}
              disabled={pending || emails.length >= MAX_CLOSER_EMAILS}
              className="h-7 min-w-[10rem] flex-1 rounded-lg border border-input bg-background px-2 text-xs"
            />
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
