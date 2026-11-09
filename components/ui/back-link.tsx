import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/** La flecha de volver de la barra superior (`<PageHeader backHref={<BackLink … />} />`), la misma en todas las pantallas. */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} aria-label={label} className="-ml-1 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
      <ArrowLeft className="h-4 w-4" />
    </Link>
  );
}
