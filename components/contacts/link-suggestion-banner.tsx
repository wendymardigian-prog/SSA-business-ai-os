"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Link2, AlertTriangle } from "lucide-react";
import { linkContacts, dismissLinkSuggestion } from "@/lib/actions/contacts";
import { ActionError } from "./ui";

/**
 * Sugerencia de vinculacion (F12).
 *
 * Aparece cuando el sistema detecto que este contacto podria ser el mismo que
 * otro, pero el dato que coincide no alcanza para vincular solo: un username
 * de otra plataforma, no un telefono ni un email. Decide una persona.
 *
 * Vincular implica dar de baja (logica) al duplicado, asi que es Owner/Admin.
 * Descartar lo puede hacer cualquiera: no destruye nada.
 */

export interface LinkSuggestion {
  contactId: string;
  reason: string;
  handle?: string;
  candidateName: string | null;
}

export function LinkSuggestionBanner({
  contactId,
  suggestions,
  isAdmin,
}: {
  contactId: string;
  suggestions: LinkSuggestion[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (suggestions.length === 0) return null;

  function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    start(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? "No pude completar la accion");
        return;
      }
      setError(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {suggestions.map((s) => (
        <div
          key={s.contactId}
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                Este contacto podría ser el mismo que{" "}
                <Link
                  href={`/dashboard/contacts/${s.contactId}`}
                  className="font-medium underline underline-offset-2"
                >
                  {s.candidateName ?? "otro contacto"}
                </Link>
                {s.handle && (
                  <>
                    {" "}
                    — coincide el usuario <span className="font-mono">@{s.handle}</span>
                  </>
                )}
                .
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                No se vinculó solo porque un usuario de otra red no alcanza para
                confirmarlo. Un teléfono o un email iguales sí se vinculan
                automáticamente.
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {isAdmin ? (
                  <button
                    onClick={() => act(() => linkContacts(contactId, s.contactId))}
                    disabled={pending}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
                  >
                    {pending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Link2 className="h-3 w-3" />
                    )}
                    Vincular con ese contacto
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Solo Owner y Admin pueden vincular contactos.
                  </span>
                )}

                <button
                  onClick={() => act(() => dismissLinkSuggestion(contactId, s.contactId))}
                  disabled={pending}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                >
                  Son distintos, descartar
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}

      <ActionError message={error} />
    </div>
  );
}
