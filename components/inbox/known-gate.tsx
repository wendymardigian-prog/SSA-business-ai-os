"use client";

import { HeartHandshake } from "lucide-react";
import { knownLabel } from "@/lib/inbox/known";

/**
 * Lo que ve otra persona del equipo al abrir el chat de un conocido (00256):
 * un aviso en lugar del hilo. Es un aviso, no un bloqueo: "Abrir igual" entra.
 * Hasta elegir, el chat no se carga ni se marca como leído (la duena lo sigue
 * viendo sin leer).
 */
export function KnownGate({
  contactName,
  ownerName,
  onOpen,
  onBack,
}: {
  contactName: string | null;
  /** Quien lo marco (o su responsable). */
  ownerName: string | null;
  onOpen: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
        <HeartHandshake className="h-6 w-6" aria-hidden />
      </span>
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-semibold">{knownLabel(ownerName)}</p>
        <p className="text-sm text-muted-foreground">
          {contactName ? `${contactName} es` : "Es"} una conversación personal. Si no te toca a vos, mejor no abrirla: no se va a marcar como
          leída.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} className="h-9 rounded-lg border border-border px-3 text-sm font-medium hover:bg-accent">
          Volver
        </button>
        <button type="button" onClick={onOpen} className="h-9 rounded-lg px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
          Abrir igual
        </button>
      </div>
    </div>
  );
}
