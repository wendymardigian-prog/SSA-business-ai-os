"use client";

import {
  Zap,
  MessageSquare,
  Split,
  Clock,
  Tag,
  FileText,
  Globe,
  ArrowRightLeft,
  UserCheck,
  Bell,
  ListPlus,
  ListChecks,
  Shuffle,
  Hourglass,
  Sparkles,
  ListOrdered,
  PauseCircle,
  PlayCircle,
  Mail,
  CalendarX,
  CalendarCheck,
  Library,
  BadgeDollarSign,
  CalendarClock,
  Ban,
  UserRoundPlus,
  Smartphone,
} from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { Search } from "lucide-react";
import { matchesQuery } from "@/lib/flows/search";
import { isContactFreeNodeType } from "@/lib/flow-engine/contact-free";
import { requirementsOfType } from "@/lib/flow-engine/node-requirements";
import { PaletteBlockedNote, useMissingFor } from "./capabilities-context";

export interface PaletteItem {
  type: string;
  nodeType: string;
  label: string;
  icon: typeof Zap;
  actionType?: string;
  /** Una linea de que hace (tambien la mira el buscador). */
  description?: string;
  /** Otras palabras con las que alguien lo buscaria. */
  synonyms?: string[];
}

export interface PaletteCategory {
  name: string;
  items: PaletteItem[];
}

const categories: PaletteCategory[] = [
  // El disparador NO esta en la paleta: toda automatizacion nace con uno en el lienzo y se elige en el selector
  // (auditoria de automatizaciones). Antes habia un "Keyword Trigger" que abria una lista con los 34 tipos.
  {
    name: "Mensajes",
    items: [
      {
        type: "sendMessage",
        nodeType: "sendMessage",
        label: "Enviar mensaje",
        icon: MessageSquare,
        description: "Un mensaje por el canal del contacto (texto, imagen, botones)",
        synonyms: ["texto", "whatsapp", "instagram", "dm", "responder"],
      },
      {
        type: "aiResponse",
        nodeType: "aiResponse",
        label: "Respuesta con IA",
        icon: Sparkles,
        description: "La IA escribe la respuesta con tus instrucciones",
        synonyms: ["ia", "gpt", "claude", "inteligencia artificial", "agente"],
      },
      // Un recurso de la banca (texto, audio, video, imagen, archivo o enlace).
      {
        type: "action",
        nodeType: "sendAsset",
        label: "Enviar recurso",
        icon: Library,
        description: "Un texto, audio, video, imagen, archivo o enlace de Recursos",
        synonyms: ["audio", "video", "pdf", "archivo", "plantilla"],
        actionType: "sendAsset",
      },
    ],
  },
  {
    name: "Lógica",
    items: [
      // "Condiciones" reemplaza a "Condition": varios caminos en orden y "Si no". Los
      // flujos que ya tienen un "Condition" lo siguen mostrando como "Condición (sí / si no)".
      { type: "branch", nodeType: "branch", label: "Condiciones", icon: Split, description: "Varios caminos según un dato, y «Si no»", synonyms: ["si", "condicion", "filtro", "if"] },
      // @plantilla-desde(webhooks)
      // Webhooks entrantes: consigue el contacto de un flujo que arranco sin uno. No aparece en los
      // flujos de una persona del equipo (EOD): ahi nunca hay un envio del que sacar un contacto.
      { type: "upsert_contact", nodeType: "upsert_contact", label: "Crear o actualizar contacto", icon: UserRoundPlus, description: "Consigue el contacto en un flujo que arrancó sin uno (webhooks)", synonyms: ["lead", "alta"] },
      // @plantilla-hasta(webhooks)
      { type: "delay", nodeType: "delay", label: "Esperar", icon: Clock, description: "Un tiempo fijo o hasta una fecha", synonyms: ["delay", "pausa", "demora"] },
      {
        type: "action",
        nodeType: "abSplit",
        label: "A/B split",
        icon: Shuffle,
        description: "Reparte a los contactos entre caminos al azar, por peso",
        synonyms: ["prueba", "test", "azar"],
        actionType: "abSplit",
      },
      {
        type: "action",
        nodeType: "smartDelay",
        label: "Esperar respuesta",
        icon: Hourglass,
        description: "Frena hasta que el contacto conteste, con tiempo máximo opcional",
        synonyms: ["smart delay", "respuesta", "esperar"],
        actionType: "smartDelay",
      },
    ],
  },
  {
    name: "Acciones",
    items: [
      {
        type: "action",
        nodeType: "addTag",
        label: "Agregar etiqueta",
        icon: Tag,
        description: "Le pone una etiqueta al contacto",
        synonyms: ["tag"],
        actionType: "addTag",
      },
      {
        type: "action",
        nodeType: "removeTag",
        label: "Quitar etiqueta",
        icon: Tag,
        description: "Le saca una etiqueta al contacto",
        synonyms: ["tag"],
        actionType: "removeTag",
      },
      {
        type: "action",
        nodeType: "setCustomField",
        label: "Definir campo",
        icon: FileText,
        description: "Guarda un valor en un campo personalizado del contacto",
        synonyms: ["campo personalizado", "dato"],
        actionType: "setCustomField",
      },
      {
        type: "action",
        nodeType: "httpRequest",
        label: "Llamada HTTP",
        icon: Globe,
        description: "Llama a otra API y guarda la respuesta en una variable",
        synonyms: ["api", "webhook", "http", "zapier", "make"],
        actionType: "httpRequest",
      },
      {
        type: "action",
        nodeType: "goToFlow",
        label: "Ir a otra automatización",
        icon: ArrowRightLeft,
        description: "Termina esta y sigue en otra",
        synonyms: ["flujo", "flow", "saltar"],
        actionType: "goToFlow",
      },
      {
        type: "action",
        nodeType: "humanTakeover",
        label: "Derivar a una persona",
        icon: UserCheck,
        description: "Frena el bot y avisa al equipo para que siga a mano",
        synonyms: ["humano", "takeover", "equipo", "pausar"],
        actionType: "humanTakeover",
      },
      {
        type: "action",
        nodeType: "subscribe",
        label: "Suscribir",
        icon: Bell,
        description: "Marca al contacto como suscripto a mensajes",
        synonyms: ["subscribe"],
        actionType: "subscribe",
      },
      {
        type: "action",
        nodeType: "unsubscribe",
        label: "Desuscribir",
        icon: Bell,
        description: "Marca al contacto como no suscripto",
        synonyms: ["baja", "unsubscribe"],
        actionType: "unsubscribe",
      },
      {
        type: "action",
        nodeType: "enrollSequence",
        label: "Inscribir en secuencia",
        icon: ListOrdered,
        description: "Lo suma a una secuencia de mensajes programados",
        synonyms: ["drip", "secuencia", "nurturing"],
        actionType: "enrollSequence",
      },
      {
        type: "action",
        nodeType: "pauseAgent",
        label: "Pausar agente IA",
        icon: PauseCircle,
        description: "El agente de IA deja de contestar en esta conversación",
        synonyms: ["ia", "bot"],
        actionType: "pauseAgent",
      },
      {
        type: "action",
        nodeType: "resumeAgent",
        label: "Reanudar agente IA",
        icon: PlayCircle,
        description: "El agente de IA vuelve a contestar",
        synonyms: ["ia", "bot"],
        actionType: "resumeAgent",
      },
      // Etapa 4 (F46). El email es lo que hace posibles los flujos de agenda:
      // quien agenda desde la pagina publica no tiene conversacion.
      {
        type: "action",
        nodeType: "send_email",
        label: "Enviar email",
        icon: Mail,
        description: "Un correo con formato y adjuntos de Recursos",
        synonyms: ["mail", "correo", "adjunto"],
        actionType: "send_email",
      },
      // Tirón 2, D3: un aviso por WhatsApp a un número que puede no ser de ningún contacto (sirve sin contacto).
      {
        type: "action",
        nodeType: "send_whatsapp_number",
        label: "Enviar WhatsApp a un número",
        icon: Smartphone,
        description: "Un aviso a un número fijo o de una variable (no necesita contacto)",
        synonyms: ["whatsapp", "aviso", "telefono"],
        actionType: "send_whatsapp_number",
      },
      // E15: un aviso al equipo en la campana (sirve también en flujos sin contacto).
      {
        type: "action",
        nodeType: "notify_team",
        label: "Avisar en la campana",
        icon: Bell,
        description: "Un aviso al equipo dentro del sistema",
        synonyms: ["notificacion", "aviso", "equipo"],
        actionType: "notify_team",
      },
      // @plantilla-desde(tareas)
      // Tareas (F22): deja una tarea para el equipo (sirve también en flujos sin contacto).
      {
        type: "action",
        nodeType: "create_task",
        label: "Crear tarea",
        icon: ListPlus,
        description: "Una tarea para alguien del equipo",
        synonyms: ["pendiente", "to do"],
        actionType: "create_task",
      },
      // @plantilla-hasta(tareas)
      // @plantilla-desde(tareas)
      // Tareas × CRM (R4): cierra las tareas abiertas que tienen una clave de origen.
      {
        type: "action",
        nodeType: "complete_task",
        label: "Completar tarea",
        icon: ListChecks,
        description: "Cierra las tareas abiertas con una clave",
        synonyms: ["cerrar tarea"],
        actionType: "complete_task",
      },
      // @plantilla-hasta(tareas)
      {
        type: "action",
        nodeType: "cancel_booking",
        label: "Cancelar la reunión",
        icon: CalendarX,
        description: "Cancela la reunión que disparó la automatización",
        synonyms: ["agenda", "cita"],
        actionType: "cancel_booking",
      },
      {
        type: "action",
        nodeType: "set_booking_status",
        label: "Cambiar estado de la reunión",
        icon: CalendarCheck,
        description: "No se presentó, venta, seguimiento…",
        synonyms: ["agenda", "no show"],
        actionType: "set_booking_status",
      },
      // @plantilla-desde(ventas)
      // Ventas (F37): las tres acciones de cobranza. Trabajan sobre el pago o la venta que disparo el flujo.
      {
        type: "action",
        nodeType: "mark_payment_paid",
        label: "Marcar pago como cobrado",
        icon: BadgeDollarSign,
        description: "El pago que disparó la automatización pasa a cobrado",
        synonyms: ["venta", "cobro"],
        actionType: "mark_payment_paid",
      },
      {
        type: "action",
        nodeType: "reschedule_payment",
        label: "Reprogramar pago",
        icon: CalendarClock,
        description: "Mueve la fecha de vencimiento del pago",
        synonyms: ["venta", "vencimiento"],
        actionType: "reschedule_payment",
      },
      {
        type: "action",
        nodeType: "set_sale_status",
        label: "Cancelar la venta",
        icon: Ban,
        description: "La venta que disparó la automatización pasa a cancelada",
        synonyms: ["venta"],
        actionType: "set_sale_status",
      },
      // @plantilla-hasta(ventas)
    ],
  },
];

function onDragStart(event: DragEvent, item: PaletteItem) {
  const data = JSON.stringify({
    type: item.type,
    nodeType: item.nodeType,
    actionType: item.actionType,
  });
  event.dataTransfer.setData("application/reactflow", data);
  event.dataTransfer.effectAllowed = "move";
}

/** Los grupos con lo que coincide con la busqueda (vacios afuera). */
export function filterPalette(list: PaletteCategory[], query: string): PaletteCategory[] {
  return list
    .map((c) => ({ ...c, items: c.items.filter((item) => matchesQuery([item.label, item.description, c.name, ...(item.synonyms ?? [])], query)) }))
    .filter((c) => c.items.length > 0);
}

/**
 * Una accion de la paleta. Si le falta una conexion (Resend, WhatsApp, una IA...) SIGUE APARECIENDO y se puede
 * arrastrar (el borrador se guarda), pero se ve atenuada, con el candado y "Necesita: ..." a la vista y el link
 * para conectarlo. No se oculta: descubrir lo que el sistema sabe hacer antes de conectar todo es parte del producto (G1).
 *
 * Se arrastra al lienzo o se toca (o Enter) para sumarlo debajo del ultimo paso.
 */
function PaletteEntry({ item, locked, onAdd }: { item: PaletteItem; locked: boolean; onAdd?: (item: PaletteItem) => void }) {
  const Icon = item.icon;
  const missing = useMissingFor(requirementsOfType(item.actionType ?? item.nodeType));
  const blocked = missing.length > 0;
  return (
    <div
      role="button"
      tabIndex={locked ? -1 : 0}
      aria-disabled={locked}
      draggable={!locked}
      onDragStart={(e) => (locked ? e.preventDefault() : onDragStart(e, item))}
      onClick={() => !locked && onAdd?.(item)}
      onKeyDown={(e) => {
        if (!locked && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onAdd?.(item);
        }
      }}
      title={item.description}
      className={
        locked
          ? "cursor-not-allowed rounded-lg border border-border bg-background px-3 py-2 text-sm opacity-50"
          : "cursor-grab rounded-lg border border-border bg-background px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-primary active:cursor-grabbing"
      }
    >
      <div className={blocked ? "flex items-center gap-2.5 opacity-70" : "flex items-center gap-2.5"}>
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium">{item.label}</span>
      </div>
      <PaletteBlockedNote missing={missing} />
    </div>
  );
}

/**
 * `memberFlow`: el flujo es sobre una persona del equipo. Se
 * ocultan los pasos que necesitan un contacto; guardar uno igual lo rechaza el servidor.
 *
 * `locked`: el disparador todavia no se eligio. Primero se decide como arranca; despues, los pasos.
 */
export function NodePalette({ memberFlow = false, locked = false, onAdd }: { memberFlow?: boolean; locked?: boolean; onAdd?: (item: PaletteItem) => void }) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const base = memberFlow
    ? categories
        .map((c) => ({ ...c, items: c.items.filter((item) => isContactFreeNodeType(item.actionType ?? item.nodeType) && item.nodeType !== "upsert_contact") }))
        .filter((c) => c.items.length > 0)
    : categories;
  const shown = filterPalette(base, query);

  // "/" enfoca el buscador (si no se esta escribiendo en otro lado).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "/" && !typing && !locked) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked]);

  return (
    <div className="flex w-60 flex-col border-r border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Pasos</h2>
        <p className="text-xs text-muted-foreground">Arrastralos al lienzo o tocalos para sumarlos</p>
        <label className="relative mt-2 block">
          <span className="sr-only">Buscar un paso</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            disabled={locked}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar (atajo: /)"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-xs text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
          />
        </label>
        {locked && (
          <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            Primero elegí el disparador: cómo arranca la automatización.
          </p>
        )}
        {memberFlow && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Este flujo es sobre una persona del equipo, no sobre un contacto: no puede mandar mensajes por chat ni tocar contactos.
          </p>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {shown.length === 0 && <p className="px-1 py-4 text-center text-xs text-muted-foreground">Ningún paso coincide con “{query}”.</p>}
        {shown.map((category) => (
          <div key={category.name} className="mb-4">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {category.name}
            </h3>
            <div className="space-y-1">
              {category.items.map((item) => (
                <PaletteEntry key={item.nodeType} item={item} locked={locked} onAdd={onAdd} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
