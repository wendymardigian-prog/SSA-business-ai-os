"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronUp, LogOut, Moon, Sun } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useHtmlClass } from "@/components/use-html-class";
import { cn } from "@/lib/utils";

/**
 * El boton de perfil del pie del menu (menu lateral y panel del telefono).
 *
 * Antes el pie tenia dos botones sueltos, tema y salir, ocupando lugar
 * permanente para dos cosas que se tocan una vez cada tanto. Ahora es un solo
 * boton que ademas dice quien esta adentro —algo que antes no se veia en
 * ninguna parte— y esconde las dos acciones en un desplegable.
 *
 * Sigue el patron de WorkspaceSwitcher: estado abierto, ref, y cerrar con un
 * mousedown afuera. Se abre hacia arriba porque vive en el pie.
 */

export interface ProfileUser {
  id: string;
  email?: string;
  /** Lo que guarda el registro: full_name. El resto del repo lee lo mismo. */
  user_metadata?: Record<string, unknown> | null;
}

function nombreDe(user: ProfileUser) {
  const meta = user.user_metadata ?? {};
  const full = (meta.full_name as string | undefined)?.trim();
  const name = (meta.name as string | undefined)?.trim();
  return full || name || null;
}

/**
 * Las iniciales del nombre, o la primera letra del email si no hay nombre.
 * Nunca queda vacio: un circulo en blanco se lee como que algo fallo.
 */
function inicialesDe(nombre: string | null, email: string | undefined) {
  if (nombre) {
    const partes = nombre.split(/\s+/).filter(Boolean).slice(0, 2);
    const iniciales = partes.map((p) => p[0]).join("");
    if (iniciales) return iniciales.toUpperCase();
  }
  return (email?.[0] ?? "?").toUpperCase();
}

export function ProfileMenu({
  user,
  collapsed = false,
}: {
  user: ProfileUser;
  /**
   * Menu lateral colapsado. El texto lo esconde la variante CSS `collapsed:`
   * (asi no parpadea al cargar); esto es para el title, que es lo unico que le
   * queda a quien solo ve el avatar.
   */
  collapsed?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dark = useHtmlClass("dark");

  const nombre = nombreDe(user);
  // Sin nombre, el email pasa a ser el renglon principal: mostrar un renglon
  // vacio arriba del email seria peor que no mostrarlo.
  const principal = nombre ?? user.email ?? "Mi cuenta";
  const secundario = nombre ? user.email : undefined;

  // Cerrar al hacer clic afuera.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Escape tambien cierra: el desplegable tapa contenido.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function toggleTheme() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  async function handleSignOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="true"
        title={collapsed ? principal : undefined}
        className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-sidebar-accent md:min-h-0 collapsed:justify-center collapsed:gap-0 collapsed:px-0"
      >
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary"
        >
          {inicialesDe(nombre, user.email)}
        </span>
        <span className="min-w-0 flex-1 collapsed:hidden">
          <span className="block truncate text-sm font-medium text-sidebar-foreground">{principal}</span>
          {secundario && (
            <span className="block truncate text-xs text-sidebar-foreground/60">{secundario}</span>
          )}
        </span>
        <ChevronUp
          aria-hidden="true"
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-sidebar-foreground/50 transition-transform collapsed:hidden",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        // bottom-full: el boton esta pegado al pie, asi que el desplegable sube.
        // min-w-52 es para el menu colapsado, donde el boton mide 48 px: el
        // desplegable se sale hacia el contenido, que es lo unico que se puede.
        <div className="absolute bottom-full left-0 z-50 mb-1 w-full min-w-52 rounded-lg border border-border bg-popover p-1 shadow-lg">
          <button
            type="button"
            onClick={toggleTheme}
            className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:min-h-0"
          >
            {dark ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
            {dark ? "Light mode" : "Dark mode"}
          </button>

          <div className="my-1 border-t border-border" />

          <button
            type="button"
            onClick={handleSignOut}
            className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:min-h-0"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
