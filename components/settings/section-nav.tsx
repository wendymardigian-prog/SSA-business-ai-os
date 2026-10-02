"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { GENERAL_SECTIONS } from "@/lib/settings/general-sections";

/**
 * Navegación interna de General (S2): columna de anclas en escritorio y fila
 * con scroll en el teléfono. Mismo patrón visual que
 * components/scheduling/config-nav.tsx, pero navega por anclas (`#id`) en
 * vez de rutas: las cuatro secciones viven en una sola página, no en
 * sub-rutas propias.
 *
 * El ancla activa se calcula con un IntersectionObserver sobre las
 * secciones: con el hash de la URL alcanza para el click inicial, pero no
 * para cuando alguien scrollea con la rueda de sección en sección.
 */
export function SectionNav() {
  const [active, setActive] = useState<string>(GENERAL_SECTIONS[0].id);

  useEffect(() => {
    const sections = GENERAL_SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        // La que está más arriba, no la que ocupa más área: con secciones de
        // alto distinto, "más área" se saltearía la primera en un scroll
        // rápido hacia abajo.
        const top = visible.reduce((a, b) =>
          a.boundingClientRect.top < b.boundingClientRect.top ? a : b,
        );
        setActive(top.target.id);
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 },
    );

    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return (
    <nav aria-label="Secciones de General" className="md:w-44 md:shrink-0">
      <ul className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
        {GENERAL_SECTIONS.map((section) => (
          <li key={section.id} className="shrink-0">
            <a
              href={`#${section.id}`}
              aria-current={active === section.id ? "page" : undefined}
              className={cn(
                "block whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active === section.id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
