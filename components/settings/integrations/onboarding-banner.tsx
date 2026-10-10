"use client";

import { useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { shouldShowBanner, type MissingEssential } from "@/lib/integrations/onboarding";

/**
 * La franja de primera conexion (G8).
 *
 * El descarte va a `localStorage`, no a la base: es una comodidad de ESTE
 * navegador, no una decision del workspace. Sin `localStorage` (privado,
 * bloqueado) la franja simplemente se sigue mostrando, que es lo seguro.
 */
const STORAGE_KEY = "app.integ.onboarding.dismissed";

function readDismissedAt(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeDismissedAt(iso: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, iso);
  } catch {
    // No se pudo recordar el descarte: la franja vuelve a aparecer, que es
    // mejor que fallar o esconderla para siempre sin querer.
  }
}

function readCanShow(): boolean {
  return shouldShowBanner(readDismissedAt());
}

// El descarte de esta pestaña lo maneja el estado del componente: no hace
// falta suscribirse a cambios de localStorage.
const noSubscription = () => () => {};

export function OnboardingBanner({ missing }: { missing: MissingEssential[] }) {
  // En el servidor no hay localStorage: la franja arranca oculta y aparece
  // recien al montar, igual que antes, sin error de hidratacion.
  const canShow = useSyncExternalStore(noSubscription, readCanShow, () => false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || missing.length === 0 || !canShow) return null;

  return (
    <div className="mx-4 mt-4 flex items-start justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 md:mx-6">
      <div>
        <p className="text-sm font-medium">Para arrancar, conviene conectar:</p>
        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {missing.map((item) => (
            <li key={item.key}>
              <span className="font-medium text-foreground">{item.label}:</span> {item.suggestion}
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        onClick={() => {
          writeDismissedAt(new Date().toISOString());
          setDismissed(true);
        }}
        aria-label="Descartar"
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg hover:bg-accent"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
