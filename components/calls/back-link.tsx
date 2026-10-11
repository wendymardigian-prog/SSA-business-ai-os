import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/** La flecha de volver a la lista de llamadas, para la barra de las pantallas de detalle. */
export function BackToCalls({ label = "Volver a Llamadas" }: { label?: string }) {
  return (
    <Link
      href="/dashboard/llamadas"
      aria-label={label}
      className="-ml-1 flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
    </Link>
  );
}
