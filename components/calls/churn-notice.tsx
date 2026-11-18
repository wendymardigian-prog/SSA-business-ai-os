import Link from "next/link";
import type { LatestChurn } from "@/lib/calls/contact-section";

/** «Causa de baja detectada» en una ficha: la más reciente, con su fecha y el link a la reunión. */
export function ChurnNotice({ churn, timeZone }: { churn: LatestChurn; timeZone: string }) {
  const day = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric", timeZone }).format(new Date(churn.at));
  return (
    <p className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm">
      <span className="font-medium text-red-800 dark:text-red-300">Causa de baja: {churn.label}</span>
      <Link href={`/dashboard/llamadas/${churn.callId}`} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
        en la reunión del {day}
      </Link>
    </p>
  );
}
