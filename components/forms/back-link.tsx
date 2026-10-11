import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/** La flecha de volver, para la barra de las pantallas de detalle de Formularios. */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="-ml-1 flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
    </Link>
  );
}
