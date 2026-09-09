"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Send, Paperclip, Bot, User, MessageSquare, CheckCircle, Clock, RotateCcw, Loader2, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { TemplatePicker } from "@/components/inbox/template-picker";
import { filterTemplates, type SearchableTemplate } from "@/lib/templates/search";
import { interpolateTemplate } from "@/lib/templates/interpolate";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/platform-icon";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { Database, ConversationStatus } from "@/lib/types/database";
import type { ConversationRow } from "@/lib/inbox/types";

type Message = Database["public"]["Tables"]["messages"]["Row"];
type Conversation = ConversationRow;

function formatMessageTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateSeparator(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function shouldShowDateSeparator(
  current: Message,
  previous: Message | undefined
): boolean {
  if (!previous) return true;
  const currentDate = new Date(current.created_at).toDateString();
  const previousDate = new Date(previous.created_at).toDateString();
  return currentDate !== previousDate;
}

function MessageBubble({ message }: { message: Message }) {
  const isInbound = message.direction === "inbound";
  const isBot = message.sent_by_flow_id !== null;
  const failed = !isInbound && message.status === "failed";

  return (
    <div
      className={cn(
        "flex gap-2",
        isInbound ? "justify-start" : "justify-end"
      )}
    >
      {isInbound && (
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-muted">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      )}

      <div className="max-w-[70%]">
        <div
          className={cn(
            "rounded-2xl px-4 py-2 text-sm",
            isInbound
              ? "rounded-tl-md bg-muted text-foreground"
              : failed
              ? // Un envio rechazado no se pinta como un mensaje entregado: el
                // texto que guarda es el motivo, no lo que se quiso mandar.
                "rounded-tr-md border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200"
              : "rounded-tr-md bg-primary text-primary-foreground"
          )}
        >
          {failed && (
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              No se pudo enviar
            </div>
          )}
          {message.text && <p className="whitespace-pre-wrap">{message.text}</p>}
          {message.attachments && (
            <div className="mt-1">
              <Paperclip className="inline h-3 w-3" />
              <span className="ml-1 text-xs opacity-70">Attachment</span>
            </div>
          )}
        </div>
        <div
          className={cn(
            "mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground",
            isInbound ? "justify-start" : "justify-end"
          )}
        >
          {isBot && (
            <Bot className="h-3 w-3" />
          )}
          <span>{formatMessageTime(message.created_at)}</span>
          {!isInbound && message.status === "delivered" && <span>Entregado</span>}
        </div>
      </div>

      {!isInbound && !isBot && (
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
          <User className="h-3.5 w-3.5 text-primary" />
        </div>
      )}
      {!isInbound && isBot && (
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Bot className="h-3.5 w-3.5 text-primary" />
        </div>
      )}
    </div>
  );
}

/** Dias enteros desde una fecha. null si no hay fecha. */
function daysSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const ms = Date.now() - new Date(dateStr).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/**
 * Aviso de conversacion enfriada (F8).
 *
 * Instagram solo deja escribirle a alguien dentro de las 24 horas posteriores a
 * su ultimo mensaje. A los 7 dias sin respuesta la conversacion ya esta cerrada
 * de hecho, y lo que se escriba va a rebotar. El aviso existe para que el
 * operador lo sepa ANTES de escribir, en vez de enterarse por un mensaje en
 * rojo despues.
 *
 * No hay logica proactiva de ventana: no se bloquea el envio ni se calcula
 * nada. Se avisa, y si igual se manda y la API rechaza, el error se explica.
 */
function StaleConversationNotice({ days }: { days: number }) {
  return (
    <div className="flex items-start gap-2 border-t border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
      <p>
        <span className="font-medium">
          Hace {days} dias que este contacto no responde.
        </span>{" "}
        Instagram solo permite escribir dentro de las 24 horas posteriores al
        ultimo mensaje del lead, asi que es probable que el envio sea rechazado.
      </p>
    </div>
  );
}

export function MessageThread({
  conversation,
  messages: initialMessages,
  templates = [],
  workspaceName = "",
}: {
  conversation: Conversation | null;
  messages: Message[];
  /** Respuestas rapidas del workspace, para el selector "/" (F17). */
  templates?: SearchableTemplate[];
  workspaceName?: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);
  // El selector se cierra con Escape aunque el texto siga arrancando con "/",
  // porque hay quien de verdad quiere escribir una barra.
  const [pickerDismissed, setPickerDismissed] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState(0);
  const [confirmingDoNotContact, setConfirmingDoNotContact] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Dias sin respuesta del lead. Sale de contacts.last_interaction_at y no del
  // ultimo mensaje del hilo porque los entrantes de Instagram no se guardan
  // localmente: contarlos daria siempre cero.
  const staleDays = daysSince(conversation?.contacts?.last_interaction_at);

  const updateConversationStatus = useCallback(async (status: ConversationStatus) => {
    if (!conversation || statusUpdating) return;
    setStatusUpdating(status);
    try {
      const { error } = await createClient()
        .from("conversations")
        .update({ status })
        .eq("id", conversation.id);
      if (error) throw error;
      router.refresh();
    } catch {
      alert("No pude cambiar el estado de la conversación. Probá de nuevo.");
    } finally {
      setStatusUpdating(null);
    }
  }, [conversation, statusUpdating, router]);

  // El selector se abre cuando el texto arranca con "/", que es exactamente lo
  // que queda al escribir la barra en un campo vacio. Pegar una URL no lo
  // abre: "https://..." no empieza con barra.
  const pickerOpen = !pickerDismissed && templates.length > 0 && input.startsWith("/");
  const templateMatches = pickerOpen ? filterTemplates(templates, input.slice(1)) : [];

  function insertTemplate(template: SearchableTemplate) {
    setInput(
      interpolateTemplate(template.content, {
        contact: conversation?.contacts ?? null,
        workspace: { name: workspaceName },
      }),
    );
    setPickerDismissed(true);
    textareaRef.current?.focus();
    // El textarea creció de una linea a varias: hay que remedirlo despues de
    // que React pinte el valor nuevo.
    requestAnimationFrame(autoResize);
  }

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, []);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Listen for conversation updates (last_message_at changes when a new message arrives)
  // and re-fetch messages from Zernio API.
  useEffect(() => {
    if (!conversation) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`conversation-${conversation.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
          filter: `id=eq.${conversation.id}`,
        },
        async () => {
          try {
            const res = await fetch(
              `/api/v1/messages?conversationId=${conversation.id}`
            );
            if (res.ok) {
              const freshMessages = await res.json();
              setMessages((prev) => {
                const optimistic = prev.filter((m) => m.id.startsWith("optimistic-"));
                return [...freshMessages, ...optimistic];
              });
            }
          } catch (err) {
            console.error("Failed to refresh messages:", err);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversation?.id]);

  /**
   * Enviar a un contacto marcado como "no contactar" (F18): se pide confirmar
   * ANTES de mandar nada. No se bloquea — a veces hay que cerrar la
   * conversacion, o el operador sabe algo que el sistema no — pero tampoco
   * pasa de largo. El servidor devuelve 409 si no viene confirmado, asi que
   * este dialogo es la comodidad, no la barrera.
   */
  function handleSendClick() {
    if (!input.trim() || !conversation || sending) return;
    if (conversation.contacts?.do_not_contact) {
      setConfirmingDoNotContact(true);
      return;
    }
    handleSend();
  }

  async function handleSend(confirmedDoNotContact = false) {
    if (!input.trim() || !conversation || sending) return;

    const text = input.trim();
    setInput("");
    setSending(true);

    // Optimistic update: add a temporary message immediately
    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticMessage: Message = {
      id: optimisticId,
      conversation_id: conversation.id,
      direction: "outbound",
      text,
      attachments: null,
      quick_reply_payload: null,
      postback_payload: null,
      callback_data: null,
      platform_message_id: null,
      sent_by_flow_id: null,
      sent_by_node_id: null,
      sent_by_user_id: null,
      status: "pending",
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMessage]);

    try {
      const res = await fetch("/api/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: conversation.id, text, confirmedDoNotContact }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Send failed (${res.status})`);
      }

      const confirmedMessage: Message = await res.json();

      // Replace optimistic message with confirmed one
      setMessages((prev) =>
        prev.map((m) => (m.id === optimisticId ? confirmedMessage : m))
      );
    } catch (err) {
      console.error("Failed to send message:", err);
      // Mark optimistic message as failed
      setMessages((prev) =>
        prev.map((m) =>
          m.id === optimisticId ? { ...m, status: "failed" as const } : m
        )
      );
    } finally {
      setSending(false);
    }
  }

  if (!conversation) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-background text-center">
        <MessageSquare className="h-12 w-12 text-muted-foreground/30" />
        <h3 className="mt-4 text-sm font-medium text-muted-foreground">
          Elegí una conversación
        </h3>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Abrí una de la lista para ver el hilo de mensajes
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            {conversation.contacts?.avatar_url ? (
              <img
                src={conversation.contacts.avatar_url}
                alt=""
                className="h-8 w-8 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium">
                {conversation.contacts?.display_name?.[0]?.toUpperCase() ?? "?"}
              </div>
            )}
            <div className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-background bg-background">
              <PlatformIcon
                platform={conversation.platform}
                className="h-2.5 w-2.5"
                size={10}
              />
            </div>
          </div>
          <div>
            <p className="text-sm font-medium">
              {conversation.contacts?.display_name ?? "Sin nombre"}
            </p>
            {/* F18: quien esta por escribir tiene que verlo antes de escribir,
                no despues de apretar enviar. */}
            {conversation.contacts?.do_not_contact && (
              <p
                className="mt-0.5 text-[11px] font-semibold text-red-600 dark:text-red-400"
                title={conversation.contacts.do_not_contact_reason ?? undefined}
              >
                No contactar
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
              conversation.status === "open"
                ? "bg-green-100 text-green-700"
                : conversation.status === "snoozed"
                ? "bg-yellow-100 text-yellow-700"
                : "bg-muted text-muted-foreground"
            )}
          >
            {conversation.status}
          </span>
          {conversation.is_automation_paused && (
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-700">
              Bot pausado
            </span>
          )}
          <div className="flex items-center gap-1">
            {conversation.status !== "closed" && (
              <button
                onClick={() => updateConversationStatus("closed")}
                disabled={!!statusUpdating}
                title="Cerrar conversación"
                aria-label="Cerrar conversación"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
              >
                {statusUpdating === "closed" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
              </button>
            )}
            {conversation.status !== "snoozed" && (
              <button
                onClick={() => updateConversationStatus("snoozed")}
                disabled={!!statusUpdating}
                title="Posponer conversación"
                aria-label="Posponer conversación"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
              >
                {statusUpdating === "snoozed" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock className="h-3.5 w-3.5" />}
              </button>
            )}
            {conversation.status !== "open" && (
              <button
                onClick={() => updateConversationStatus("open")}
                disabled={!!statusUpdating}
                title="Reabrir conversación"
                aria-label="Reabrir conversación"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
              >
                {statusUpdating === "open" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-2xl space-y-4">
          {messages.map((message, i) => (
            <div key={message.id}>
              {shouldShowDateSeparator(message, messages[i - 1]) && (
                <div className="my-4 flex items-center gap-3">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-[11px] text-muted-foreground">
                    {formatDateSeparator(message.created_at)}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              )}
              <MessageBubble message={message} />
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {staleDays !== null && staleDays >= 7 && (
        <StaleConversationNotice days={staleDays} />
      )}

      {/* Composer */}
      <div className="border-t border-border p-4">
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <div className="relative flex-1">
            {pickerOpen && (
              <TemplatePicker
                matches={templateMatches}
                activeIndex={activeTemplate}
                onPick={insertTemplate}
                onHover={setActiveTemplate}
              />
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                const value = e.target.value;
                setInput(value);
                // Volver a escribir una barra desde cero reabre el selector que
                // se habia cerrado con Escape.
                if (!value.startsWith("/")) setPickerDismissed(false);
                setActiveTemplate(0);
                autoResize();
              }}
              onKeyDown={(e) => {
                // Con el selector abierto, las flechas y el Enter son suyos:
                // si no, Enter manda "/pre" como mensaje al lead.
                if (pickerOpen) {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    if (templateMatches.length === 0) return;
                    const step = e.key === "ArrowDown" ? 1 : -1;
                    setActiveTemplate(
                      (prev) =>
                        (prev + step + templateMatches.length) % templateMatches.length,
                    );
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    const chosen = templateMatches[activeTemplate];
                    if (chosen) insertTemplate(chosen);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setPickerDismissed(true);
                    return;
                  }
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendClick();
                }
              }}
              placeholder="Escribí un mensaje, o / para una respuesta rápida"
              rows={1}
              className="w-full resize-none rounded-lg border border-input bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              style={{ maxHeight: 150 }}
            />
          </div>
          <button
            onClick={handleSendClick}
            disabled={!input.trim() || sending}
            aria-label="Enviar mensaje"
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
              input.trim() && !sending
                ? "bg-primary text-primary-foreground hover:opacity-90"
                : "bg-muted text-muted-foreground"
            )}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmingDoNotContact}
        title="Este contacto pidió no ser contactado"
        message={
          conversation.contacts?.do_not_contact_reason
            ? `Motivo registrado: ${conversation.contacts.do_not_contact_reason}. ¿Mandás el mensaje igual?`
            : "¿Mandás el mensaje igual?"
        }
        confirmLabel="Enviar igual"
        cancelLabel="No enviar"
        destructive
        onConfirm={() => {
          setConfirmingDoNotContact(false);
          handleSend(true);
        }}
        onCancel={() => setConfirmingDoNotContact(false)}
      />
    </div>
  );
}
