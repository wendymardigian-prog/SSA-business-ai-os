"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { saveMyFathomEmails } from "@/lib/actions/fathom";
import { MAX_RECORDER_EMAILS, normalizeFathomEmail } from "@/lib/fathom/recorder-emails";

/**
 * Con que correos entran las grabaciones de esta persona (Mi Fathom). Si graba en
 * Fathom con otro correo y no lo carga aca, sus llamadas no entran: Fathom no siempre
 * dice cual es el correo de la cuenta conectada.
 */
export function FathomRecorderEmails({ accountEmail, initialEmails }: { accountEmail: string | null; initialEmails: string[] }) {
  const [emails, setEmails] = useState(initialEmails);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save(next: string[], after?: () => void) {
    setError(null);
    start(async () => {
      const r = await saveMyFathomEmails(next);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setEmails(r.emails);
      after?.();
    });
  }

  function add(event: FormEvent) {
    event.preventDefault();
    const email = normalizeFathomEmail(draft);
    if (!email) {
      setError("Ese correo no es válido");
      return;
    }
    if (email === accountEmail || emails.includes(email)) {
      setDraft("");
      return;
    }
    save([...emails, email], () => setDraft(""));
  }

  return (
    <section aria-labelledby="fathom-emails-title" className="mt-4 rounded-xl border border-border bg-card p-5">
      <h2 id="fathom-emails-title" className="text-base font-semibold">Tus correos en Fathom</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Entran las llamadas que grabaste con estos correos. Si en Fathom usás otro, agregalo: si no, tus llamadas no entran.
      </p>

      <ul className="mt-3 space-y-1.5 text-sm">
        {accountEmail && (
          <li className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-1.5">
            <span className="min-w-0 truncate">{accountEmail}</span>
            <span className="shrink-0 text-xs text-muted-foreground">El de tu cuenta</span>
          </li>
        )}
        {emails.map((email) => (
          <li key={email} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-1.5">
            <span className="min-w-0 truncate">{email}</span>
            <button
              type="button"
              onClick={() => save(emails.filter((e) => e !== email))}
              disabled={pending}
              aria-label={`Quitar ${email}`}
              className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>

      {emails.length < MAX_RECORDER_EMAILS && (
        <form onSubmit={add} className="mt-3 flex items-center gap-2">
          <label htmlFor="fathom-extra-email" className="sr-only">Otro correo con el que grabás en Fathom</label>
          <input
            id="fathom-extra-email"
            type="email"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={pending}
            placeholder="otro@correo.com"
            className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm"
          />
          <button type="submit" disabled={pending || !draft.trim()} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-50">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />} Agregar
          </button>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </section>
  );
}
