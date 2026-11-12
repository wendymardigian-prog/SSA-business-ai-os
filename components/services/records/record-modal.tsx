// @plantilla-quitar(servicios)
"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { withoutRecord } from "@/lib/services/screens/record-url";
import { cn } from "@/lib/utils";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** El ultimo elemento que abrio una ficha, para devolverle el foco al cerrarla aunque la URL haya cambiado en el medio. */
let opener: HTMLElement | null = null;
/** Lo llama una fila o un link antes de abrir una ficha. */
export function rememberRecordOpener(el: HTMLElement | null) {
  opener = el;
}

/** ¿Hay otra cosa modal abierta encima (un drawer, un dialogo, un menu)? Entonces Esc y Tab son de ella. */
function somethingOnTop(panel: HTMLElement | null): boolean {
  const others = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"], [role="menu"]')].filter((el) => el !== panel && !panel?.contains(el) && el.offsetParent !== null);
  if (others.length > 0) return true;
  // Un dialogo o menu adentro de la ficha (dibujado en su arbol) tambien manda.
  return !!panel?.querySelector('[role="dialog"][aria-modal="true"], [role="menu"]');
}

/**
 * El modal de las fichas del cliente y del servicio (Servicios A2, F130.2 y F130.3). Se abre por la URL y se cierra
 * sacando la ficha de la URL (conserva los filtros de la lista).
 *
 * - En la computadora, centrado y con la cabecera fija; en el telefono, a pantalla completa y la cabecera se va con el
 *   scroll (no tapa media pantalla).
 * - Esc y el boton cerrar lo cierran; si hay un drawer, un dialogo o un menu abierto encima, Esc es de ellos (cierran
 *   primero). El foco entra al abrir, no se escapa con Tab y vuelve a quien lo abrio.
 */
export function RecordModal({
  label,
  size = "md",
  header,
  children,
}: {
  label: string;
  /** md: la ficha del cliente (una columna); lg: la del servicio (dos columnas). */
  size?: "md" | "lg";
  header: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const panel = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    router.push(withoutRecord(pathname, params?.toString() ?? ""), { scroll: false });
  }, [router, pathname, params]);

  useEffect(() => {
    returnTo.current = opener ?? (document.activeElement as HTMLElement | null);
    panel.current?.querySelector<HTMLElement>("[data-record-close]")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || somethingOnTop(panel.current)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "Tab" && panel.current) {
        const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) return;
        if (!panel.current.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    // En la fase de burbuja: los dialogos de adentro (ContentDialog) cortan Esc en la captura y cierran ellos primero.
    document.addEventListener("keydown", onKeyDown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      const back = returnTo.current;
      opener = null;
      if (back && back.isConnected) back.focus();
    };
  }, [close]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-stretch justify-center bg-black/50 md:items-start md:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-record-modal=""
        className={cn(
          "flex h-full w-full flex-col overflow-y-auto bg-background md:h-auto md:max-h-[calc(100vh-3rem)] md:rounded-2xl md:border md:border-border md:shadow-xl",
          size === "lg" ? "md:max-w-[1180px]" : "md:max-w-3xl",
        )}
      >
        {/* La cabecera: fija arriba en la computadora; en el telefono se va con el scroll. */}
        <div className="relative border-b border-border bg-background px-4 pb-3 pt-4 md:sticky md:top-0 md:z-10 md:px-6">
          <button
            type="button"
            data-record-close=""
            onClick={close}
            aria-label="Cerrar"
            className="absolute right-2 top-2 inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent md:right-3 md:top-3 md:h-9 md:w-9"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
          {header}
        </div>
        {children}
      </div>
    </div>
  );
}
