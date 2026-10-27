"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CalendarDays,
  ClipboardList,
  DollarSign,
  MessageCircle,
  MessagesSquare,
  Phone,
  Search,
  Users,
  Webhook,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  filterTriggerChoices,
  TRIGGER_GROUPS,
  triggerChoices,
  type TriggerChoice,
  type TriggerGroupKey,
} from "@/lib/flow-engine/trigger-catalog";

/** El icono de cada grupo de disparadores (lo comparten el selector y el nodo del lienzo). */
export const TRIGGER_GROUP_ICONS: Record<TriggerGroupKey, LucideIcon> = {
  mensajes: MessageCircle,
  comentarios: MessagesSquare,
  contactos: Users,
  agenda: CalendarDays,
  formularios: ClipboardList, // @plantilla-quitar(formularios)
  ventas: DollarSign, // @plantilla-quitar(ventas)
  tareas: Zap, // @plantilla-quitar(tareas)
  llamadas: Phone, // @plantilla-quitar(llamadas)
  webhooks: Webhook, // @plantilla-quitar(webhooks)
  equipo: Bot, // @plantilla-quitar(formularios)
};

interface TriggerPickerProps {
  open: boolean;
  /** La opcion elegida hoy (para marcarla). */
  currentKey?: string | null;
  /** Al elegir. */
  onPick: (choice: TriggerChoice) => void;
  /** Cerrar sin elegir. Sin esto la ventana no se puede cerrar (una automatizacion nueva TIENE que elegir). */
  onClose?: () => void;
  /** Si el flujo es sobre una persona del equipo, los disparadores de contacto no aplican (y al reves): no se filtra, se avisa. */
  title?: string;
}

/**
 * El selector de disparador: una ventana con buscador y los disparadores agrupados (Mensajes, Agenda…).
 *
 * Se abre sola en una automatizacion nueva (que nace con el disparador sin elegir) y desde "Cambiar disparador" en el
 * panel. Mientras no se elige, la paleta de pasos queda apagada: primero se decide como arranca.
 */
export function TriggerPicker({ open, currentKey, onPick, onClose, title = "¿Cómo arranca esta automatización?" }: TriggerPickerProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const all = useMemo(() => triggerChoices(), []);
  const filtered = useMemo(() => filterTriggerChoices(all, query), [all, query]);

  // Al abrir: el buscador vacio y con el foco. Se vacia al cerrar (no en un efecto: setState dentro de un efecto
  // dispara renders en cascada).
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);
  const pick = (choice: TriggerChoice) => {
    setQuery("");
    onPick(choice);
  };
  const close = onClose
    ? () => {
        setQuery("");
        onClose();
      }
    : undefined;

  useEffect(() => {
    if (!open || !close) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[8vh]" role="dialog" aria-modal="true" aria-labelledby="trigger-picker-title">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 id="trigger-picker-title" className="text-base font-semibold text-foreground">
              {title}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Elegí el disparador: lo que tiene que pasar para que la automatización empiece.</p>
          </div>
          {close && (
            <button type="button" onClick={close} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent" aria-label="Cerrar">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="border-b border-border px-5 py-3">
          <label className="relative block">
            <span className="sr-only">Buscar un disparador</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && filtered.length === 1) pick(filtered[0]);
              }}
              placeholder="Buscar: reunión, etiqueta, pago, formulario…" // @plantilla-quitar(ventas,formularios)
              // @plantilla-sin(ventas,formularios): placeholder="Buscar: reunión, etiqueta, mensaje, comentario…"
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No encontré ningún disparador con “{query}”. Probá con otra palabra.</p>
          ) : (
            TRIGGER_GROUPS.map((group) => {
              const items = filtered.filter((c) => c.group === group.key);
              if (items.length === 0) return null;
              const Icon = TRIGGER_GROUP_ICONS[group.key];
              return (
                <section key={group.key} className="mb-4 last:mb-0">
                  <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" />
                    {group.label}
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {items.map((choice) => (
                      <button
                        key={choice.key}
                        type="button"
                        onClick={() => pick(choice)}
                        className={cn(
                          "rounded-lg border p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-primary",
                          currentKey === choice.key ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30" : "border-border bg-background hover:border-primary/50 hover:bg-accent",
                        )}
                      >
                        <p className="text-sm font-medium text-foreground">{choice.label}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{choice.description}</p>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
