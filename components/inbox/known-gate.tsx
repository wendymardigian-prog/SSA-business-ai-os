"use client";

import { MARK_STYLE } from "@/components/contacts/mark-badge";
import type { ContactMark } from "@/lib/inbox/marks";

/**
 * Lo que ve otra persona del equipo al abrir el chat de un conocido (00256) o
 * de un cliente (00268): un aviso en lugar del hilo. Es un aviso, no un
 * bloqueo: "Abrir igual" entra. Hasta elegir, el chat no se carga ni se marca
 * como leído (quien lo atiende lo sigue viendo sin leer).
 */
export function KnownGate({
  mark = "known",
  title,
  contactName,
  onOpen,
  onBack,
}: {
  mark?: ContactMark;
  /** "Conocido de Ana", "Cliente de Beto", "Cliente (compró)". */
  title: string;
  contactName: string | null;
  onOpen: () => void;
  onBack: () => void;
}) {
  const { icon: Icon, soft } = MARK_STYLE[mark];
  const who = contactName ? `${contactName} es` : "Es";
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <span className={`grid h-12 w-12 place-items-center rounded-full ${soft}`}>
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-sm text-muted-foreground">
          {mark === "known" ? `${who} una conversación personal.` : `${who} un cliente y ya tiene quien lo atienda.`} Si no te toca a vos, mejor no
          abrirla: no se va a marcar como leída.
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
