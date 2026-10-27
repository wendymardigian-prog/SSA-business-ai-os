"use client";

import { useRouter, usePathname } from "next/navigation";
import { CheckCircle2, X } from "lucide-react";
import { mergeNotes, summarizeMerge, type MergeMoved } from "@/lib/contacts/merge";

/**
 * El aviso de despues de unir dos contactos: llegas a la ficha del contacto principal y esto dice que
 * se unifico («Se unificaron 2 conversaciones, 1 agenda y 3 tareas.»). El resultado viaja en la URL como cuentas, nunca
 * como texto; se descarta con la X (saca el parametro).
 */
export function MergeNotice({ moved }: { moved: MergeMoved }) {
  const router = useRouter();
  const pathname = usePathname();
  const notes = mergeNotes(moved);
  return (
    <div role="status" className="mb-6 flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-900 dark:text-emerald-100">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Contactos unidos. {summarizeMerge(moved)}</p>
        {notes.length > 0 && (
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
            {notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        )}
      </div>
      <button type="button" aria-label="Cerrar este aviso" onClick={() => router.replace(pathname)} className="grid h-6 w-6 shrink-0 place-items-center rounded hover:bg-emerald-500/20">
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}
