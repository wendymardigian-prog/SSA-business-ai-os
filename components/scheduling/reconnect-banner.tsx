import Link from "next/link";
import { AlertTriangle } from "lucide-react";

/**
 * Aviso fijo en todas las pantallas de Agenda cuando alguna cuenta de Google
 * de la persona esta revocada o con error (F7). Sus eventos dejan de ofrecer
 * horarios hasta que reconecte.
 */
export function ReconnectBanner({ accounts }: { accounts: string[] }) {
  if (accounts.length === 0) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-amber-300/60 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200 md:px-6">
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <strong>Reconectá tu Google Calendar</strong>
        {accounts.length === 1 ? ` (${accounts[0]})` : ` (${accounts.length} cuentas)`}: hasta entonces tus eventos no ofrecen horarios.
      </span>
      <Link href="/dashboard/agenda/configuracion/calendarios" className="rounded-lg border border-amber-400 px-2.5 py-1 text-xs font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40">
        Ir a Calendarios
      </Link>
    </div>
  );
}
