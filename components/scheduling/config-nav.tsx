"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LinkPending } from "@/components/ui/link-pending";
import { CONFIG_SECTIONS } from "@/lib/scheduling/config-sections";

/**
 * Navegacion lateral de la Configuracion de agenda (F8): cinco secciones. En
 * escritorio es una columna; en el celular, una fila que se desplaza.
 */
export function ConfigNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Secciones de la configuración de agenda" className="md:w-52 md:shrink-0">
      <ul className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
        {CONFIG_SECTIONS.map((section) => {
          const active = pathname === section.href || pathname.startsWith(`${section.href}/`);
          return (
            <li key={section.key} className="shrink-0">
              <Link
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {section.label}
                <LinkPending className="ml-2 align-middle" />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
