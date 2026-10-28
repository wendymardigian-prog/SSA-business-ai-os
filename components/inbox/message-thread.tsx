"use client";

import { useState, useEffect, useMemo, useRef, useCallback, useReducer } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Send, Bot, User, MessageSquare, CheckCircle, RotateCcw, Loader2, AlertTriangle, ChevronLeft, UserRound, UserRoundSearch, Mic, X, FileText, Copy } from "lucide-react";
import { needsHumanBadge } from "@/lib/inbox/needs-human";
import { NeedsHumanBanner } from "./needs-human-banner";
import { createClient } from "@/lib/supabase/client";
import { AssetPicker } from "@/components/inbox/asset-picker";
import type { BankAsset } from "@/lib/response-assets/list";
import {
  CLOSED_WIDGET,
  isWidgetShortcut,
  opensBySlash,
  textToRestoreOnClose,
  widgetReducer,
  widgetShortcutLabel,
} from "@/lib/inbox/asset-widget";
import { markAssetUsed, prepareAssetSend } from "@/lib/actions/response-assets";
import type { AssetChatCopy } from "@/lib/response-assets/send-copy";
import { cn } from "@/lib/utils";
import { EmojiButton, useEmojiInsert } from "@/components/ui/emoji-picker";
import { PlatformIcon } from "@/components/platform-icon";
import { ContactAvatar } from "@/components/contacts/contact-avatar";
import { CreateTaskButton } from "@/components/tasks/create-task-button"; // @plantilla-quitar(tareas)
import { ConversationAssignee } from "@/components/inbox/conversation-assignee";
import { canUnmarkKnown, knownLabel } from "@/lib/inbox/known";
import { assigneeName } from "@/lib/inbox/assignee";
import { setCustomer, setKnown } from "@/lib/actions/contacts";
import { customerLabel } from "@/lib/inbox/marks";
import { MarkBadge } from "@/components/contacts/mark-badge";
import { prepareStickerSend, saveStickerFromMessage } from "@/lib/actions/stickers";
import { stickerCapability } from "@/lib/channels/stickers";
import { StickerPicker } from "@/components/inbox/sticker-picker";
import { CallLine } from "@/components/inbox/call-line";
import { interleaveCalls, type CallRow } from "@/lib/whatsapp-calls/event";
import { isStickerOnlyMessage } from "@/lib/inbox/media-render";
import { ConversationMenu } from "@/components/inbox/conversation-menu";
import { planHeaderActions } from "@/lib/inbox/header-actions";
import { canMarkNoReply } from "@/lib/inbox/awaiting";
import { formatReplyTime, replyTimesByMessage, type MessageReplyTime } from "@/lib/messages/reply-time";
import { NoReplyBanner } from "@/components/inbox/no-reply-banner";
import { canRetrySend } from "@/lib/inbox/send-failure";
import { threadDayLabel } from "@/lib/inbox/day-label";
import { setConversationNoReply } from "@/lib/actions/conversation-status";
import { planComposerActions, type ComposerMenuAction } from "@/lib/inbox/composer-actions";
import { ComposerMoreMenu } from "@/components/inbox/composer-more-menu";
import { requestSuggestionAction } from "@/lib/actions/agent-drafts";
import { loadConversationActivity, type ConversationActivityData } from "@/lib/actions/message-activity";
import { buildActivity, type MessageActivity } from "@/lib/inbox/message-activity";
import { ActivityTrigger } from "@/components/inbox/message-activity-panel";
import { ReactButton, ReactionChips } from "@/components/inbox/message-reactions";
import { loadConversationReactions, reactToMessage } from "@/lib/actions/reactions";
import { canReactToMessage, reactionCapability as capabilityFor, type ReactionCapability } from "@/lib/channels/reactions";
import { myReaction, reactionsForMessage, type MessageReactionView, type ReactionRow } from "@/lib/messages/reactions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ActionError } from "@/components/contacts/ui";
import type { Database, ConversationStatus } from "@/lib/types/database";
import type { ConversationRow } from "@/lib/inbox/types";
import { parseAttachments } from "@/lib/messages/attachments";
import { MediaAttachment } from "./media-attachment";
import { OriginChip } from "./origin-chip";
import type { OriginChipView } from "@/lib/inbox/origin-chip";
import { TranscriptBlock } from "./transcript-block";
import { VoiceRecorder, recordingFilename } from "./voice-recorder";
import type { ChannelAgentInfo } from "@/lib/agent/public";
import { ConversationAgentToggle } from "@/components/inbox/conversation-agent-toggle";
import { PendingDraft } from "@/components/inbox/pending-draft";
import { closeConversation } from "@/lib/actions/conversation-status";
import { requestChatUpload } from "@/lib/actions/chat-upload";
import { CHAT_MEDIA_BUCKET } from "@/lib/chat-media/bucket";
import { instagramAcceptsAudio, INSTAGRAM_AUDIO_REJECTED_MESSAGE } from "@/lib/audio/recording";
import { formatBytes } from "@/lib/inbox/media-render";
import { headBase64Of } from "@/lib/content/media";
import { accountToShow, type InboxAccountsInfo } from "@/lib/inbox/accounts";

type Message = Database["public"]["Tables"]["messages"]["Row"] & {
  /** El chip "Vino de…" que arma el servidor para este mensaje (Extra I, F44). Casi todos no lo traen. */
  origin_chip?: OriginChipView;
};
type Conversation = ConversationRow;

/** El estado de la conversacion como se lee en la bandeja (las pestanas dicen Abiertas / Cerradas / Pospuestas). */
const STATUS_LABELS: Record<ConversationStatus, string> = {
  open: "Abierta",
  snoozed: "Pospuesta",
  closed: "Cerrada",
};

function formatMessageTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateSeparator(dateStr: string): string {
  return threadDayLabel(new Date(dateStr));
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

function MessageBubble({
  message,
  activity,
  showMarker = false,
  runsHref = null,
  reactions = [],
  reactionCapability: reactionCap = null,
  myReactionEmoji = null,
  canReact = false,
  reacting = false,
  onReact,
  replyTime = null,
  retrying = false,
  onRetry,
}: {
  message: Message;
  /** Se esta reintentando este envio fallido (00262). */
  retrying?: boolean;
  /** Reintentar un envio fallido; sin esto no se ofrece el boton. */
  onRetry?: () => void;
  /**
   * Si este mensaje cerro una espera del lead: cuanto tardo desde su primer
   * mensaje sin responder. El mismo calculo que el dashboard (00261).
   */
  replyTime?: MessageReplyTime | null;
  /** Las reacciones de este mensaje (A3), ya agrupadas por emoji. */
  reactions?: MessageReactionView[];
  /** Lo que admite el canal; null = no se ofrece reaccionar. */
  reactionCapability?: ReactionCapability | null;
  myReactionEmoji?: string | null;
  /** Se puede reaccionar a ESTE mensaje (canal, direccion, id del proveedor, permiso de responder). */
  canReact?: boolean;
  reacting?: boolean;
  /** Emoji vacio = quitar la reaccion. */
  onReact?: (emoji: string) => void;
  /** Lo que hizo el agente con este mensaje (A1), si hay corrida. */
  activity?: MessageActivity;
  /** Dibuja la linea "Agente: ..." bajo el mensaje (solo el ultimo del contacto de cada rafaga). */
  showMarker?: boolean;
  runsHref?: string | null;
}) {
  const isInbound = message.direction === "inbound";
  const isBot = message.sent_by_flow_id !== null || Boolean(message.sent_by_agent_id);
  const failed = !isInbound && message.status === "failed";
  const stickerOnly = isStickerOnlyMessage(message, failed);

  return (
    <div
      className={cn(
        "group flex gap-2",
        isInbound ? "justify-start" : "justify-end"
      )}
    >
      {isInbound && (
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-muted">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      )}

      <div className="max-w-[85%] md:max-w-[70%]">
        <div
          className={cn(
            "rounded-2xl px-4 py-2 text-sm",
            // Solo un sticker: sin globo, como en WhatsApp (00257).
            stickerOnly
              ? "bg-transparent px-0 py-0 text-foreground"
              : isInbound
              ? "rounded-tl-md bg-muted text-foreground"
              : failed
              ? // Un envio rechazado no se pinta como un mensaje entregado. El
                // texto es lo que se quiso mandar y el motivo va en send_error
                // (sin send_error, el texto es el motivo).
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
          {/* El asunto va arriba del cuerpo, como en cualquier cliente de
              correo: sin el, una respuesta larga empieza sin contexto. */}
          {message.email_subject && (
            <p className="mb-1 text-xs font-semibold opacity-80">{message.email_subject}</p>
          )}
          {/* El adjunto va ARRIBA del texto, como en WhatsApp: el texto suele
              ser el pie de la foto, no lo principal. */}
          <MessageAttachments message={message} />
          {message.text && <p className="whitespace-pre-wrap">{message.text}</p>}
          {/* 00262: el motivo va aparte del texto, con que hacer y como
              reintentar. Una fila vieja no lo tiene: su texto ya es el motivo. */}
          {failed && message.send_error && (
            <FailedSendFooter
              reason={message.send_error}
              text={message.text}
              retrying={retrying}
              onRetry={onRetry && !message.id.startsWith("optimistic-") && canRetrySend(message) ? onRetry : undefined}
            />
          )}
        </div>
        <ReactionChips reactions={reactions} inbound={isInbound} busy={reacting} onRemoveMine={() => onReact?.("")} />
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
          {replyTime && (
            <span
              title={
                replyTime.human
                  ? "Tiempo de respuesta: desde el primer mensaje del contacto sin responder hasta esta respuesta."
                  : "Tiempo de respuesta de una respuesta automática (agente, automatización u otra herramienta). No cuenta en el tiempo de respuesta del equipo."
              }
            >
              · respondido en {formatReplyTime(replyTime.seconds)}
              {!replyTime.human && " (automática)"}
            </span>
          )}
          {!isInbound && message.status === "delivered" && <span>Entregado</span>}
          {canReact && reactionCap && onReact && (
            <ReactButton capability={reactionCap} mine={myReactionEmoji} busy={reacting} onReact={onReact} />
          )}
        </div>
        {isInbound && message.origin_chip && <OriginChip chip={message.origin_chip} />}
        {isInbound && showMarker && activity && (
          <div className="mt-0.5">
            <ActivityTrigger activity={activity} variant="marker" runsHref={runsHref} />
          </div>
        )}
      </div>

      {!isInbound && !isBot && (
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
          <User className="h-3.5 w-3.5 text-primary" />
        </div>
      )}
      {!isInbound && isBot && (
        <div className="relative flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
          {activity && message.sent_by_agent_id ? (
            <ActivityTrigger activity={activity} variant="bot" runsHref={runsHref}>
              <Bot className="h-3.5 w-3.5 text-primary" />
            </ActivityTrigger>
          ) : (
            <Bot className="h-3.5 w-3.5 text-primary" />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Debajo de un envio que no salio (00262): por que, y dos salidas. "Copiar
 * texto" sirve cuando hay que mandarlo desde otro lado (la app de Instagram o
 * ManyChat, si otra app maneja la conversacion).
 */
function FailedSendFooter({
  reason,
  text,
  retrying,
  onRetry,
}: {
  reason: string;
  text: string | null;
  retrying: boolean;
  onRetry?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      alert("No pude copiar el texto. Seleccionalo y copialo a mano.");
    }
  }

  return (
    <div className="mt-2 border-t border-amber-300/60 pt-2 dark:border-amber-800/60">
      <p className="text-xs leading-relaxed">{reason}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="inline-flex items-center gap-1 rounded-md border border-amber-400 px-2 py-1 text-xs font-medium hover:bg-amber-100 disabled:opacity-60 dark:border-amber-700 dark:hover:bg-amber-900/40"
          >
            {retrying ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <RotateCcw className="h-3 w-3" aria-hidden />}
            {retrying ? "Reintentando…" : "Reintentar"}
          </button>
        )}
        {text && (
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex items-center gap-1 rounded-md border border-amber-400 px-2 py-1 text-xs font-medium hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900/40"
          >
            <Copy className="h-3 w-3" aria-hidden />
            {copied ? "Copiado" : "Copiar texto"}
          </button>
        )}
      </div>
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

/**
 * Un recurso de la banca, como lo usa el widget de la bandeja: el mismo tipo
 * que la pantalla de gestion (lib/response-assets/list.ts), los seis tipos.
 */
export type InboxAsset = BankAsset;

/** Un recurso con archivo ya copiado a la conversacion, esperando salir. */
interface PreparedAssetSend {
  assetId: string;
  copy: AssetChatCopy;
  caption: string;
}

export function MessageThread({
  conversation,
  messages: initialMessages,
  assets = [],
  canManageAssets = false,
  canCreateTask = false, // @plantilla-quitar(tareas)
  canViewAgentRuns = false,
  canReply = true,
  workspaceName = "",
  agentInfo = null,
  channelProvider = null,
  accounts,
  members = [],
  currentUserId = "",
  canAssignConversations = false,
  canEditContacts = false,
  canDeleteContacts = false,
  onBack,
  onOpenContact,
}: {
  conversation: Conversation | null;
  messages: Message[];
  /** La banca de recursos del workspace (los seis tipos), para el widget de recursos. */
  assets?: InboxAsset[];
  /** Puede crear recursos (`templates.manage`): el widget vacio le ofrece crear el primero. */
  canManageAssets?: boolean;
  /** Puede crear tareas (`tasks.edit`): muestra «Crear tarea» en el encabezado.  @plantilla-quitar(tareas) */
  canCreateTask?: boolean; // @plantilla-quitar(tareas)
  /** Puede ver las corridas del agente (`agents.view`): el panel de actividad ofrece abrir la corrida. */
  canViewAgentRuns?: boolean;
  /** `inbox.<canal>.reply`: sin esto la conversacion se ve pero no se escribe (Equipo y roles, F20). */
  canReply?: boolean;
  workspaceName?: string;
  /** Si el agente de IA atiende el canal de esta conversacion (Fase 3). */
  agentInfo?: ChannelAgentInfo | null;
  /**
   * El `provider` del canal de esta conversacion (evolution/zernio/resend).
   * Decide que tipos de recurso se pueden mandar aca (lib/channels/media.ts):
   * los que no, el widget los muestra deshabilitados con el motivo.
   */
  channelProvider?: string | null;
  /** Las cuentas por canal: el encabezado dice por cual cuenta es la conversacion cuando una red tiene varias. */
  accounts?: InboxAccountsInfo;
  /** El equipo, para el responsable del chat (00255). */
  members?: { userId: string; label: string }[];
  currentUserId?: string;
  /** `contacts.assign`: cambia el responsable; sin la clave, solo "Tomar". */
  canAssignConversations?: boolean;
  /** `contacts.edit`: puede marcar "Conocido". */
  canEditContacts?: boolean;
  /** `contacts.delete`: puede quitar la marca de conocido aunque no la haya puesto. */
  canDeleteContacts?: boolean;
  /** Telefono (Bloque 2d): el hilo ocupa la pantalla y se vuelve a la lista. */
  onBack?: () => void;
  /** Telefono (Bloque 2d): abre los datos del contacto como hoja. */
  onOpenContact?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  // Llamadas de WhatsApp (00258): solo existen en chats de Evolution. Se leen
  // con la RLS (quien ve la conversacion ve sus llamadas) y se pintan entre los
  // mensajes por hora; no son mensajes.
  const [calls, setCalls] = useState<CallRow[]>([]);
  // `?texto=` deja el mensaje escrito en el composer, sin mandarlo (por ejemplo, un link para mandar
  // por WhatsApp o Instagram). Se lee una sola vez al abrir y se saca de la URL.
  const [input, setInput] = useState(() => (searchParams.get("texto") ?? "").slice(0, 2000));
  const [sending, setSending] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);
  // El widget de recursos guardados (banca v2): se abre con "/", con el boton
  // de la biblioteca o con ⌘/Ctrl + /. Su estado vive en un reducer puro.
  const [widget, dispatchWidget] = useReducer(widgetReducer, CLOSED_WIDGET);
  const [shortcutLabel, setShortcutLabel] = useState("Ctrl + /");
  const [confirmingDoNotContact, setConfirmingDoNotContact] = useState(false);
  // F18/F19: grabar y adjuntar. recording y attachedFile son excluyentes
  // entre si y con escribir texto (el mic solo se ve con el textarea vacio).
  const [recording, setRecording] = useState(false);
  // Los paneles de emoji y stickers del composer: los abre el "⋯".
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // "Sugerir respuesta" (A1): hay un borrador vivo (lo informa PendingDraft) y se esta esperando uno.
  const [hasLiveDraft, setHasLiveDraft] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onLiveDraftChange = useCallback((live: boolean) => {
    setHasLiveDraft(live);
    if (live) {
      setSuggesting(false);
      if (suggestTimer.current) clearTimeout(suggestTimer.current);
    }
  }, []);
  useEffect(() => () => {
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
  }, []);
  // Lo que hizo el agente con cada mensaje (A1.2). Se pide al abrir la conversacion y cuando entra o sale un
  // mensaje; un fallo deja la bandeja igual, solo sin indicadores.
  const activityConversationId = conversation?.id ?? null;
  const [activityData, setActivityData] = useState<{ conversationId: string; data: ConversationActivityData } | null>(null);
  useEffect(() => {
    if (!activityConversationId) return;
    let alive = true;
    const timer = setTimeout(() => {
      loadConversationActivity(activityConversationId)
        .then((data) => {
          if (alive) setActivityData({ conversationId: activityConversationId, data });
        })
        .catch((err) => console.error("[inbox] no pude leer la actividad del agente:", err instanceof Error ? err.message : "error"));
    }, 600);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [activityConversationId, messages.length]);
  const activityMap = useMemo(() => {
    if (!activityData || activityData.conversationId !== activityConversationId) return new Map<string, MessageActivity>();
    return buildActivity({
      messages: messages.map((m) => ({ id: m.id, direction: m.direction, created_at: m.created_at, agent_run_id: m.agent_run_id })),
      ...activityData.data,
    });
  }, [activityData, activityConversationId, messages]);
  // Tiempo de respuesta de cada saliente que cerro una espera del lead (00261).
  // Los mensajes optimistas (todavia sin guardar) tambien cuentan: es lo que se ve.
  const replyTimes = useMemo(() => replyTimesByMessage(messages), [messages]);
  // El indicador va bajo el mensaje del contacto al que se ancla cada corrida (el ultimo de su rafaga).
  const markerMessageIds = useMemo(
    () => new Set(messages.filter((m) => m.direction === "inbound" && activityMap.has(m.id)).map((m) => m.id)),
    [messages, activityMap],
  );
  // Reacciones (A3): las de la conversacion, al dia con Realtime, y el mensaje que se esta reaccionando.
  const [reactions, setReactions] = useState<ReactionRow[]>([]);
  const [reactingId, setReactingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const reactionConversationId = conversation?.id ?? null;
  const reloadReactions = useCallback(async () => {
    if (!reactionConversationId) return;
    try {
      setReactions(await loadConversationReactions(reactionConversationId));
    } catch (err) {
      console.error("[inbox] no pude leer las reacciones:", err instanceof Error ? err.message : "error");
    }
  }, [reactionConversationId]);
  useEffect(() => {
    if (!reactionConversationId) return;
    let cancelled = false;
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      await reloadReactions();
      if (cancelled) return;
      channel = supabase
        .channel(`conversation-reactions-${reactionConversationId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "message_reactions", filter: `conversation_id=eq.${reactionConversationId}` },
          () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => void reloadReactions(), 400);
          },
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [reactionConversationId, reloadReactions]);
  const reactionCap: ReactionCapability | null = channelProvider && capabilityFor(channelProvider).supported ? capabilityFor(channelProvider) : null;
  // "Crear tarea" se abre desde el menu "⋯" de la cabecera y su panel se ancla a ese boton.  @plantilla-quitar(tareas)
  const [taskOpen, setTaskOpen] = useState(false); // @plantilla-quitar(tareas)
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const insertEmoji = useEmojiInsert(textareaRef, input, setInput);
  useEffect(() => {
    if (!searchParams.get("texto")) return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete("texto");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [searchParams, pathname, router]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** El envio de media que quedo esperando la confirmacion de "no contactar". */
  const pendingMediaRef = useRef<{ file: File; filename: string; durationSeconds: number | null; isRecording: boolean } | null>(null);
  /** Un recurso de la banca ya copiado a la conversacion, esperando esa misma confirmacion. */
  const pendingAssetCopyRef = useRef<PreparedAssetSend | null>(null);
  /**
   * El texto o enlace de la banca que se inserto en el composer: si sale, se
   * cuenta su uso. Se olvida si el composer queda vacio.
   */
  const insertedAssetIdRef = useRef<string | null>(null);

  /** Una sugerencia descartada que se recupera: el texto vuelve al campo de escritura (editable, no se envia). */
  const recoverSuggestion = useCallback((body: string) => {
    setInput(body);
    insertedAssetIdRef.current = null;
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      // El texto recuperado suele tener varias lineas: se vuelve a medir el campo.
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
    });
  }, []);

  async function handleReact(message: Message, emoji: string) {
    if (!conversation || reactingId) return;
    setMediaError(null);
    setReactingId(message.id);
    try {
      const result = await reactToMessage({
        conversationId: conversation.id,
        // Los mensajes que vienen en vivo de Zernio no tienen fila propia: su id no es un uuid.
        messageId: /^[0-9a-f-]{36}$/i.test(message.id) ? message.id : null,
        platformMessageId: message.platform_message_id,
        platformNativeMessageId: message.platform_native_message_id,
        emoji,
      });
      if (!result.ok) setMediaError(result.error);
      await reloadReactions();
    } finally {
      setReactingId(null);
    }
  }

  async function requestSuggest() {
    if (!conversation || suggesting) return;
    setMediaError(null);
    setSuggesting(true);
    const result = await requestSuggestionAction(conversation.id);
    if (!result.ok) {
      setSuggesting(false);
      setMediaError(result.error);
      return;
    }
    // Si en un minuto y medio no aparecio nada (el agente decidio no responder), se libera el boton.
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    suggestTimer.current = setTimeout(() => setSuggesting(false), 90_000);
  }

  // Dias sin respuesta del lead. Sale de contacts.last_interaction_at y no del
  // ultimo mensaje del hilo: es el dato que marcan los dos receptores al
  // recibir, sin depender de que el guardado de mensajes este prendido ni de
  // que el hilo que se esta mostrando venga de la base o de Zernio.
  const staleDays = daysSince(conversation?.contacts?.last_interaction_at);

  const updateConversationStatus = useCallback(async (status: ConversationStatus) => {
    if (!conversation || statusUpdating) return;
    setStatusUpdating(status);
    try {
      if (status === "closed") {
        // Cerrar pasa por el servidor: es "ya me hice cargo" (borra la marca de
        // error del agente) y dispara el resumen y la clasificacion del cierre.
        const result = await closeConversation(conversation.id);
        if (!result.ok) throw new Error(result.error);
      } else {
        const { error } = await createClient().from("conversations").update({ status }).eq("id", conversation.id);
        if (error) throw error;
      }
      router.refresh();
    } catch {
      alert("No pude cambiar el estado de la conversación. Probá de nuevo.");
    } finally {
      setStatusUpdating(null);
    }
  }, [conversation, statusUpdating, router]);

  // 00259: "No necesita respuesta" a mano. El cartel de abajo del encabezado
  // explica la marca y la deshace.
  const markNoReply = useCallback(async () => {
    if (!conversation) return;
    const result = await setConversationNoReply(conversation.id, true);
    if (!result.ok) {
      alert(result.error);
      return;
    }
    router.refresh();
  }, [conversation, router]);

  const templateContext = { contact: conversation?.contacts ?? null, workspace: { name: workspaceName } };

  const openWidget = useCallback((bySlash: boolean, query = "") => {
    setMediaError(null);
    dispatchWidget({ type: "open", bySlash, query });
  }, []);

  /**
   * Cerrar el widget. Con Escape desde la lista, si se habia abierto con "/",
   * la barra (y lo buscado) vuelven al composer: hay quien de verdad quiere
   * escribir una barra.
   */
  const closeWidget = useCallback((restore: boolean) => {
    const text = restore ? textToRestoreOnClose(widget) : null;
    dispatchWidget({ type: "close" });
    if (text !== null) setInput(text);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [widget]);

  /** Un texto o un enlace de la banca: se inserta editable, nunca se manda solo. */
  function insertAsset(text: string, asset: InboxAsset) {
    setInput(text);
    insertedAssetIdRef.current = asset.id;
    dispatchWidget({ type: "close" });
    textareaRef.current?.focus();
    // El textarea creció de una linea a varias: hay que remedirlo despues de
    // que React pinte el valor nuevo.
    requestAnimationFrame(autoResize);
  }

  // ⌘/Ctrl + / abre el widget desde cualquier lugar de la conversacion.
  useEffect(() => {
    setShortcutLabel(widgetShortcutLabel(typeof navigator !== "undefined" ? navigator.platform : null));
    const onKey = (event: KeyboardEvent) => {
      if (!isWidgetShortcut(event)) return;
      event.preventDefault();
      dispatchWidget(
        widget.view === "closed" ? { type: "open", bySlash: false } : { type: "close" },
      );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [widget.view]);

  // Cambiar de conversacion cierra el widget: lo que se miraba era para otra.
  useEffect(() => {
    dispatchWidget({ type: "close" });
    insertedAssetIdRef.current = null;
  }, [conversation?.id]);

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
    if ((!input.trim() && !attachedFile) || !conversation || sending) return;
    if (conversation.contacts?.do_not_contact) {
      pendingMediaRef.current = attachedFile
        ? { file: attachedFile, filename: attachedFile.name, durationSeconds: null, isRecording: false }
        : null;
      setConfirmingDoNotContact(true);
      return;
    }
    if (attachedFile) {
      sendMediaFile(attachedFile, attachedFile.name, null, false);
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
      origin_context: null,
      conversation_id: conversation.id,
      direction: "outbound",
      text,
      attachments: null,
      quick_reply_payload: null,
      postback_payload: null,
      callback_data: null,
      platform_message_id: null,
      platform_native_message_id: null,
      sent_by_flow_id: null,
      sent_by_node_id: null,
      sent_by_user_id: null,
      sent_by_agent_id: null,
      agent_run_id: null,
      origin: "user",
      status: "pending",
      created_at: new Date().toISOString(),
      workspace_id: conversation.workspace_id,
      // Las cabeceras del correo las pone el servidor al enviar (F65): el
      // mensaje optimista todavia no las tiene.
      email_subject: null,
      email_message_id: null,
      email_in_reply_to: null,
      email_references: null,
      email_from: null,
      email_to: null,
      email_cc: null,
      // La media, la transcripcion y la interpretabilidad las completa el
      // servidor: un mensaje que se acaba de escribir es texto y nada mas.
      media_description: null,
      interpretability: "text",
      transcript: null,
      transcript_status: "none",
      transcript_error: null,
      transcript_seconds: null,
      transcript_started_at: null,
      send_error: null,
    };
    setMessages((prev) => [...prev, optimisticMessage]);

    try {
      const res = await fetch("/api/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: conversation.id, text, confirmedDoNotContact }),
      });

      if (!res.ok) {
        const errorData = (await res.json().catch(() => ({}))) as { error?: string; message?: Message | null };
        // 00262: el servidor devuelve la fila fallida que guardo (con su id y
        // el motivo): reemplaza al optimista y se puede reintentar.
        const storedFailure = errorData.message;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === optimisticId
              ? storedFailure ?? { ...m, status: "failed" as const, send_error: errorData.error || `No se pudo enviar (${res.status}).` }
              : m,
          ),
        );
        return;
      }

      const confirmedMessage: Message = await res.json();

      // Replace optimistic message with confirmed one
      setMessages((prev) =>
        prev.map((m) => (m.id === optimisticId ? confirmedMessage : m))
      );
      // Si salio un texto o un enlace de la banca, cuenta como uso. Despues de
      // mandar y sin esperar: el contador nunca puede frenar un mensaje.
      if (insertedAssetIdRef.current) {
        void markAssetUsed(insertedAssetIdRef.current);
        insertedAssetIdRef.current = null;
      }
      // Responder a mano apaga el agente de la conversacion (lo hace el
      // servidor): se refresca para que el toggle lo muestre.
      if (conversation.agent_enabled || conversation.last_agent_error_at) router.refresh();
    } catch (err) {
      console.error("Failed to send message:", err);
      // Sin respuesta del servidor (se corto la red): no se sabe si se guardo.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === optimisticId
            ? { ...m, status: "failed" as const, send_error: "No hubo respuesta del servidor. Revisá tu conexión y recargá la conversación antes de volver a mandarlo." }
            : m
        )
      );
    } finally {
      setSending(false);
    }
  }

  /**
   * Reintenta un envio que no salio (00262). La MISMA fila: el servidor la
   * reclama (`failed -> pending`) antes de mandar, asi que un doble clic o dos
   * pestanas dan un solo envio. Si vuelve a fallar, queda con el motivo nuevo.
   */
  async function handleRetry(message: Message, confirmedDoNotContact = false) {
    if (!conversation || (retryingId && !confirmedDoNotContact)) return;
    setRetryingId(message.id);
    try {
      const res = await fetch("/api/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: conversation.id, retryOf: message.id, confirmedDoNotContact }),
      });
      const data = (await res.json().catch(() => ({}))) as Message & {
        error?: string;
        message?: Message | null;
        requiresConfirmation?: boolean;
      };
      // "No contactar" (F18): se pregunta igual que al mandar.
      if (res.status === 409 && data.requiresConfirmation) {
        if (window.confirm(`${data.error ?? "Este contacto está marcado como \"no contactar\"."} ¿Reintentar igual?`)) {
          await handleRetry(message, true);
        }
        return;
      }
      if (res.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== message.id).concat(data));
        if (conversation.agent_enabled || conversation.last_agent_error_at) router.refresh();
        return;
      }
      if (data.message) {
        const updated = data.message;
        setMessages((prev) => prev.map((m) => (m.id === message.id ? updated : m)));
      } else {
        alert(data.error || "No se pudo reintentar. Probá de nuevo.");
      }
    } catch {
      alert("No hubo respuesta del servidor. Revisá tu conexión y probá de nuevo.");
    } finally {
      setRetryingId(null);
    }
  }

  /**
   * Manda un audio grabado o un archivo adjuntado del disco (F18, F19).
   *
   * Tres pasos: pedir la ruta firmada (el servidor decide el tipo por los
   * bytes), subir directo del navegador a Storage, y recien ahi mandar el
   * mensaje con esa ruta. El caption (si hay texto escrito) viaja junto.
   */
  async function sendMediaFile(
    file: Blob,
    filename: string,
    durationSeconds: number | null,
    isRecording: boolean,
    confirmedDoNotContact = false,
  ) {
    if (!conversation || sending) return;
    setSending(true);
    setMediaError(null);
    const caption = input.trim();

    try {
      const ticket = await requestChatUpload({
        conversationId: conversation.id,
        sizeBytes: file.size,
        headBase64: await headBase64Of(file),
        declaredMime: file instanceof File ? file.type || undefined : undefined,
        isRecording,
      });

      if (!ticket.ok) {
        setMediaError(ticket.error);
        return;
      }

      // Antes de subir nada: Instagram rechaza ogg/opus, webm y mp3. Mandarlo
      // igual seria subir un archivo que el servidor va a terminar tirando.
      if (
        (ticket.kind === "audio" || ticket.kind === "voice") &&
        conversation.platform === "instagram" &&
        !instagramAcceptsAudio(ticket.mime)
      ) {
        setMediaError(INSTAGRAM_AUDIO_REJECTED_MESSAGE);
        return;
      }

      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(CHAT_MEDIA_BUCKET)
        .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: ticket.mime });

      if (uploadError) {
        setMediaError("No se pudo subir el archivo. Probá de nuevo.");
        return;
      }

      const res = await fetch("/api/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversation.id,
          text: caption || undefined,
          media: { storagePath: ticket.path, kind: ticket.kind, mime: ticket.mime, filename, durationSeconds },
          confirmedDoNotContact,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        setMediaError(errorData.error || `No se pudo enviar (${res.status})`);
        return;
      }

      const confirmedMessage: Message = await res.json();
      setMessages((prev) => [...prev, confirmedMessage]);
      setInput("");
      setRecording(false);
      setAttachedFile(null);
      if (conversation.agent_enabled || conversation.last_agent_error_at) router.refresh();
    } catch (err) {
      console.error("Failed to send media:", err);
      setMediaError("No se pudo enviar el archivo. Probá de nuevo.");
    } finally {
      setSending(false);
    }
  }

  /**
   * Manda un sticker de la biblioteca (00257): el servidor lo copia a la
   * conversacion (nunca se manda el de la biblioteca) y despues va por la ruta
   * de siempre, como cualquier adjunto. Sin texto: un sticker va solo.
   */
  async function sendStickerFromLibrary(stickerId: string) {
    if (!conversation || sending) return;
    setSending(true);
    setMediaError(null);
    try {
      const prepared = await prepareStickerSend({ conversationId: conversation.id, stickerId });
      if (!prepared.ok) {
        setMediaError(prepared.error);
        return;
      }
      const res = await fetch("/api/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversation.id,
          media: { storagePath: prepared.storagePath, kind: "sticker", mime: "image/webp" },
          stickerId,
        }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        setMediaError(errorData.error || `No se pudo enviar (${res.status})`);
        return;
      }
      const confirmedMessage: Message = await res.json();
      setMessages((prev) => [...prev, confirmedMessage]);
      if (conversation.agent_enabled || conversation.last_agent_error_at) router.refresh();
    } catch (err) {
      console.error("Failed to send sticker:", err);
      setMediaError("No se pudo enviar el sticker. Probá de nuevo.");
    } finally {
      setSending(false);
    }
  }

  /**
   * Manda un recurso con archivo ya copiado a la conversacion
   * (prepareAssetSend). Analogo a sendMediaFile, pero sin pasos de subida: la
   * copia server-side (lib/response-assets/send-copy.ts) ya dejo el archivo
   * en destino, asi que solo queda pedirle a sendChannelMessage que lo mande.
   * El texto que lo acompaña es el caption del preview.
   */
  async function sendPreparedAsset(prepared: PreparedAssetSend, confirmedDoNotContact: boolean) {
    if (!conversation) return;
    setSending(true);
    setMediaError(null);
    const { copy, caption, assetId } = prepared;

    try {
      const res = await fetch("/api/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversation.id,
          text: caption.trim() || undefined,
          media: { storagePath: copy.storagePath, kind: copy.kind, mime: copy.mime, filename: copy.filename, durationSeconds: copy.durationSeconds },
          confirmedDoNotContact,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        setMediaError(errorData.error || `No se pudo enviar (${res.status})`);
        return;
      }

      const confirmedMessage: Message = await res.json();
      setMessages((prev) => [...prev, confirmedMessage]);
      dispatchWidget({ type: "close" });
      // Despues de mandar y sin esperar: el contador nunca frena un envio.
      void markAssetUsed(assetId);
      if (conversation.agent_enabled || conversation.last_agent_error_at) router.refresh();
    } catch (err) {
      console.error("Failed to send library asset:", err);
      setMediaError("No se pudo enviar el archivo. Probá de nuevo.");
    } finally {
      setSending(false);
    }
  }

  /**
   * Manda un recurso con archivo de la banca, desde el preview del widget:
   * copia el archivo a la conversacion del lado del servidor
   * (prepareAssetSend) y lo manda por sendPreparedAsset, por el mismo camino
   * que cualquier adjunto (Bloque 5/F19). No hay un envio paralelo para "un
   * recurso de la biblioteca", y nunca se manda el archivo de la biblioteca
   * directo: el barrido de 180 dias del chat se llevaria el recurso entero.
   *
   * Que el canal lo acepte ya lo chequeo el widget (channelAccepts) antes de
   * habilitar Enviar; la API lo vuelve a chequear.
   */
  async function sendLibraryAsset(asset: InboxAsset, caption: string) {
    if (!conversation || sending) return;
    setMediaError(null);
    setSending(true);

    try {
      const prepared = await prepareAssetSend(conversation.id, asset.id);
      if (!prepared.ok) {
        setMediaError(prepared.error);
        setSending(false);
        return;
      }

      const pending: PreparedAssetSend = { assetId: asset.id, copy: prepared.copy, caption };
      if (conversation.contacts?.do_not_contact) {
        pendingAssetCopyRef.current = pending;
        setSending(false);
        setConfirmingDoNotContact(true);
        return;
      }

      setSending(false);
      await sendPreparedAsset(pending, false);
    } catch (err) {
      console.error("Failed to prepare library asset:", err);
      setMediaError("No pude preparar ese recurso. Probá de nuevo.");
      setSending(false);
    }
  }

  const conversationIdForCalls = conversation?.id ?? null;
  useEffect(() => {
    if (!conversationIdForCalls || channelProvider !== "evolution") {
      setCalls([]);
      return;
    }
    let cancelled = false;
    void createClient()
      .from("whatsapp_calls")
      .select("id, status, is_video, started_at")
      .eq("conversation_id", conversationIdForCalls)
      .order("started_at")
      .limit(200)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("[llamadas] no pude leer las llamadas:", error.message);
          return;
        }
        setCalls((data ?? []).map((c) => ({ id: c.id, status: c.status, isVideo: c.is_video, startedAt: c.started_at })));
      });
    return () => {
      cancelled = true;
    };
  }, [conversationIdForCalls, channelProvider, messages.length]);
  const callTimeline = interleaveCalls(messages, calls);

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


  // Stickers (00257): solo en un canal que los admite (hoy, WhatsApp).
  const canSticker = stickerCapability(channelProvider).supported;
  const stickerDisabledReason = conversation.contacts?.do_not_contact
    ? "El contacto está marcado como «no contactar»."
    : sending
      ? "Esperá a que termine de enviarse el mensaje."
      : null;
  const composerPlan = planComposerActions({
    hasAttachment: !!attachedFile,
    hasText: !!input.trim(),
    // Solo si hay un agente prendido para este canal y no hay ya un borrador esperando.
    canSuggest: !!agentInfo?.available && !hasLiveDraft,
    canSticker,
  });
  function onComposerAction(action: ComposerMenuAction) {
    switch (action) {
      case "library":
        if (widget.view === "closed") openWidget(false);
        else closeWidget(false);
        return;
      case "attach":
        fileInputRef.current?.click();
        return;
      case "emoji":
        setEmojiOpen(true);
        return;
      case "sticker":
        setStickersOpen(true);
        return;
      case "suggest":
        void requestSuggest();
        return;
    }
  }
  const headerPlan = planHeaderActions({
    status: conversation.status,
    canCreateTask, // @plantilla-quitar(tareas)
    isAutomationPaused: !!conversation.is_automation_paused,
    agentDisabledByTag: !!conversation.agent_disabled_by_tag_id,
    draftMode: !!(agentInfo?.available && agentInfo.mode === "draft"),
    canMarkNoReply: canReply && canMarkNoReply(conversation),
    known: conversation.contact_id
      ? {
          isKnown: !!conversation.contacts?.is_known,
          canMark: canEditContacts,
          canUnmark: canEditContacts && canUnmarkKnown({ viewerId: currentUserId, markedBy: conversation.contacts?.known_marked_by ?? null, canDeleteContacts }),
        }
      : undefined,
    customer: conversation.contact_id
      ? {
          isCustomer: !!conversation.contacts?.is_customer,
          canMark: canEditContacts,
          canUnmark: canEditContacts && canUnmarkKnown({ viewerId: currentUserId, markedBy: conversation.contacts?.customer_marked_by ?? null, canDeleteContacts }),
        }
      : undefined,
  });

  async function toggleCustomer(value: boolean) {
    if (!conversation?.contact_id) return;
    setStatusUpdating(value ? "customer" : "uncustomer");
    try {
      const result = await setCustomer(conversation.contact_id, value);
      if (!result.ok) {
        setMediaError(result.error);
        return;
      }
      router.refresh();
    } finally {
      setStatusUpdating(null);
    }
  }

  async function toggleKnown(value: boolean) {
    if (!conversation?.contact_id) return;
    setStatusUpdating(value ? "known" : "unknown");
    try {
      const result = await setKnown(conversation.contact_id, value);
      if (!result.ok) {
        setMediaError(result.error);
        return;
      }
      router.refresh();
    } finally {
      setStatusUpdating(null);
    }
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header: una sola fila tambien en el telefono (lo secundario va en el menu "⋯"). */}
      <div className="flex min-h-14 items-center justify-between gap-x-2 border-b border-border px-2 py-1.5 md:gap-x-3 md:px-4 md:py-0">
        <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Volver a la bandeja"
              className="-ml-1 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent md:hidden"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </button>
          )}
          <div className="relative flex-shrink-0">
            <ContactAvatar avatarUrl={conversation.contacts?.avatar_url} displayName={conversation.contacts?.display_name} size="sm" />
            <div className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-background bg-background">
              <PlatformIcon
                platform={conversation.platform}
                className="h-2.5 w-2.5"
                size={10}
              />
            </div>
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {conversation.contacts?.display_name ?? "Sin nombre"}
            </p>
            {/* Con varias cuentas de la misma red, por cual cuenta entro: quien
                contesta tiene que saber desde cual esta hablando. */}
            {accountToShow(accounts, conversation) && (
              <p className="truncate text-[11px] text-muted-foreground">
                Vía {accountToShow(accounts, conversation)}
              </p>
            )}
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
            {/* Conocido (00256) y Cliente (00268): quien lo abrio igual sabe que no es un lead. */}
            {(conversation.contacts?.is_known || conversation.contacts?.is_customer) && (
              <p className="mt-0.5 flex flex-wrap items-center gap-1">
                {conversation.contacts.is_customer && (
                  <MarkBadge
                    mark="customer"
                    size="xs"
                    title={customerLabel(assigneeName(members, conversation.contacts.customer_marked_by ?? null), conversation.contacts.customer_source)}
                  />
                )}
                {conversation.contacts.is_known && (
                  <MarkBadge mark="known" size="xs" title={knownLabel(assigneeName(members, conversation.contacts.known_marked_by ?? null))} />
                )}
              </p>
            )}
          </div>
        </div>

        {/* A la vista: el interruptor del agente y la accion mas frecuente (cerrar o
            reabrir). El resto (posponer, otras acciones y los avisos de estado) vive
            en el menu "⋯": ver `planHeaderActions`. */}
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {onOpenContact && (
            <button
              type="button"
              onClick={onOpenContact}
              aria-label="Ver datos del contacto"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent md:hidden"
            >
              <UserRound className="h-4 w-4" aria-hidden />
            </button>
          )}
          <span
            className={cn(
              "hidden whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium sm:inline",
              conversation.status === "open"
                ? "bg-green-100 text-green-700"
                : conversation.status === "snoozed"
                ? "bg-yellow-100 text-yellow-700"
                : "bg-muted text-muted-foreground"
            )}
          >
            {STATUS_LABELS[conversation.status] ?? conversation.status}
          </span>
          {/* F11: el aviso completo va en la barra de abajo; acá alcanza un
              pill, para que se vea sin desplazar el hilo. */}
          {needsHumanBadge(conversation).show && (
            <span
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-950/50 dark:text-red-300"
              title={needsHumanBadge(conversation).title}
              aria-label={needsHumanBadge(conversation).title}
            >
              <UserRoundSearch className="h-3 w-3" aria-hidden />
              <span className="hidden sm:inline">Necesita humano</span>
            </span>
          )}
          {currentUserId && (
            <ConversationAssignee
              conversationId={conversation.id}
              assignedTo={conversation.assigned_to ?? null}
              members={members}
              currentUserId={currentUserId}
              canAssign={canAssignConversations}
              canReply={canReply}
            />
          )}
          <ConversationAgentToggle
            conversationId={conversation.id}
            mode={conversation.agent_enabled}
            pausedUntil={conversation.agent_paused_until}
            info={agentInfo}
          />
          <button
            type="button"
            onClick={() => updateConversationStatus(headerPlan.primary === "close" ? "closed" : "open")}
            disabled={!!statusUpdating}
            title={headerPlan.primary === "close" ? "Cerrar conversación" : "Reabrir conversación"}
            aria-label={headerPlan.primary === "close" ? "Cerrar conversación" : "Reabrir conversación"}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {statusUpdating === (headerPlan.primary === "close" ? "closed" : "open") ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : headerPlan.primary === "close" ? (
              <CheckCircle className="h-4 w-4" aria-hidden />
            ) : (
              <RotateCcw className="h-4 w-4" aria-hidden />
            )}
            <span className="hidden md:inline">{headerPlan.primary === "close" ? "Cerrar" : "Reabrir"}</span>
          </button>
          <ConversationMenu
            plan={headerPlan}
            statusLabel={STATUS_LABELS[conversation.status] ?? conversation.status}
            buttonRef={menuButtonRef}
            disabled={!!statusUpdating}
            onAction={(action) => {
              if (action === "snooze") void updateConversationStatus("snoozed");
              else if (action === "reopen") void updateConversationStatus("open");
              else if (action === "noReply") void markNoReply();
              else if (action === "markKnown") void toggleKnown(true);
              else if (action === "unmarkKnown") void toggleKnown(false);
              else if (action === "markCustomer") void toggleCustomer(true);
              else if (action === "unmarkCustomer") void toggleCustomer(false);
              else setTaskOpen(true); // @plantilla-quitar(tareas)
            }}
          />
          {/* @plantilla-desde(tareas) */}
          {canCreateTask && (
            <CreateTaskButton
              contactId={conversation.contact_id}
              conversationId={conversation.id}
              contactName={conversation.contacts?.display_name ?? null}
              controlled={{ open: taskOpen, onOpenChange: setTaskOpen, anchor: menuButtonRef }}
            />
          )}
          {/* @plantilla-hasta(tareas) */}
        </div>
      </div>

      {/* F11: el aviso del escalado, con el motivo y el botón "Ya lo vi". Va
          entre el encabezado y los mensajes: es lo primero que hay que leer al
          entrar a una conversación derivada. */}
      <NeedsHumanBanner conversationId={conversation.id} conversation={conversation} />
      <NoReplyBanner conversationId={conversation.id} conversation={conversation} canReply={canReply} />

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-3 md:p-4">
        <div className="mx-auto max-w-2xl space-y-4">
          {messages.map((message, i) => (
            <div key={message.id}>
              {callTimeline.before.get(i)?.map((call) => (
                <div key={call.id} className="mb-4">
                  <CallLine call={call} />
                </div>
              ))}
              {shouldShowDateSeparator(message, messages[i - 1]) && (
                <div className="my-4 flex items-center gap-3">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-[11px] text-muted-foreground">
                    {formatDateSeparator(message.created_at)}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              )}
              <MessageBubble
                message={message}
                activity={activityMap.get(message.id)}
                showMarker={markerMessageIds.has(message.id)}
                runsHref={canViewAgentRuns ? "/dashboard/agents/runs" : null}
                reactions={reactionsForMessage(reactions, message)}
                reactionCapability={reactionCap}
                myReactionEmoji={myReaction(reactions, message)}
                canReact={
                  canReply &&
                  canReactToMessage({
                    provider: channelProvider,
                    direction: message.direction,
                    platformMessageId: message.platform_message_id ?? message.platform_native_message_id,
                  }).ok
                }
                reacting={reactingId === message.id}
                onReact={(emoji) => void handleReact(message, emoji)}
                replyTime={replyTimes.get(message.id) ?? null}
                retrying={retryingId === message.id}
                onRetry={canReply ? () => void handleRetry(message) : undefined}
              />
            </div>
          ))}
          {callTimeline.after.map((call) => (
            <CallLine key={call.id} call={call} />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {staleDays !== null && staleDays >= 7 && (
        <StaleConversationNotice days={staleDays} />
      )}

      {!canReply ? (
        <div className="border-t border-border bg-muted/40 p-4 text-center text-xs text-muted-foreground" role="status">
          Podés ver esta conversación, pero tu rol no puede responder por este canal.
        </div>
      ) : (
      <>
      {/* Bloque 2c: el borrador del agente, arriba del campo de escritura. */}
      <PendingDraft
        key={conversation.id}
        conversationId={conversation.id}
        onRecover={recoverSuggestion}
        onLiveChange={onLiveDraftChange}
      />

      {/* Composer */}
      <div className="border-t border-border p-3 md:p-4">
        <div className="relative mx-auto max-w-2xl">
          <ActionError message={mediaError} />

          {/* El widget de recursos guardados: el mismo para "/", el boton y el atajo. */}
          <AssetPicker
            state={widget}
            dispatch={dispatchWidget}
            assets={assets}
            provider={channelProvider}
            context={templateContext}
            canManage={canManageAssets}
            sending={sending}
            shortcutLabel={shortcutLabel}
            onInsert={insertAsset}
            onSend={(asset, caption) => void sendLibraryAsset(asset, caption)}
            onClose={closeWidget}
          />

          {recording ? (
            // Estado grabando (F18): reemplaza al composer entero.
            <VoiceRecorder
              onCancel={() => setRecording(false)}
              onSend={(blob, mime, duration) => {
                const filename = recordingFilename(mime);
                const file = new File([blob], filename, { type: mime });
                if (conversation.contacts?.do_not_contact) {
                  pendingMediaRef.current = { file, filename, durationSeconds: duration, isRecording: true };
                  setConfirmingDoNotContact(true);
                  return;
                }
                sendMediaFile(file, filename, duration, true);
              }}
            />
          ) : (
            <div className="flex items-end gap-2">
              {attachedFile ? (
                // Estado con adjunto elegido (F19): chip con nombre y peso,
                // el textarea queda libre para el caption.
                <div className="flex flex-1 flex-col gap-1.5">
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-1.5">
                    <FileText className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-xs">{attachedFile.name}</span>
                    <span className="flex-shrink-0 text-xs text-muted-foreground">{formatBytes(attachedFile.size)}</span>
                    <button
                      type="button"
                      onClick={() => setAttachedFile(null)}
                      aria-label="Quitar adjunto"
                      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSendClick();
                      }
                    }}
                    placeholder="Agregá un texto (opcional)"
                    rows={1}
                    className="w-full resize-none rounded-lg border border-input bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              ) : (
                <div className="relative flex-1">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => {
                      const value = e.target.value;
                      // Escribir "/" al principio abre el widget, y lo que venga
                      // despues de la barra (si se pego) pasa a su buscador.
                      if (opensBySlash(input, value) && widget.view === "closed") {
                        setInput("");
                        openWidget(true, value.slice(1));
                        return;
                      }
                      setInput(value);
                      if (!value.trim()) insertedAssetIdRef.current = null;
                      autoResize();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSendClick();
                      }
                    }}
                    placeholder="Escribí un mensaje o / para un recurso guardado"
                    rows={1}
                    className="w-full resize-none rounded-lg border border-input bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    style={{ maxHeight: 150 }}
                  />
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                // Sin .txt: no tiene firma en sus bytes y la subida lo rechazaria.
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setMediaError(null);
                  setAttachedFile(file);
                }}
              />
              {/* El "⋯" agrupa lo secundario; el emoji y los stickers abren su panel anclado acá mismo. */}
              <div className="relative flex-shrink-0">
                <ComposerMoreMenu
                  actions={composerPlan.menu}
                  onAction={onComposerAction}
                  suggesting={suggesting}
                  libraryOpen={widget.view !== "closed"}
                  shortcutLabel={shortcutLabel}
                  stickerDisabledReason={stickerDisabledReason}
                />
                <EmojiButton
                  onPick={insertEmoji}
                  focusRef={textareaRef}
                  align="end"
                  hideTrigger
                  open={emojiOpen}
                  onOpenChange={setEmojiOpen}
                />
                {canSticker && (
                  <StickerPicker
                    onPick={(stickerId) => void sendStickerFromLibrary(stickerId)}
                    canDelete={canManageAssets}
                    hideTrigger
                    open={stickersOpen}
                    onOpenChange={setStickersOpen}
                    returnFocusRef={textareaRef}
                  />
                )}
              </div>
              {composerPlan.primary === "mic" ? (
                <button
                  type="button"
                  onClick={() => {
                    setMediaError(null);
                    setRecording(true);
                  }}
                  aria-label="Grabar audio"
                  title="Grabar audio"
                  className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Mic className="h-5 w-5" aria-hidden />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSendClick}
                  disabled={(!input.trim() && !attachedFile) || sending}
                  aria-label="Enviar mensaje"
                  title="Enviar"
                  className={cn(
                    "flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg transition-colors",
                    (input.trim() || attachedFile) && !sending
                      ? "bg-primary text-primary-foreground hover:opacity-90"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      </>
      )}

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
          const pendingCopy = pendingAssetCopyRef.current;
          if (pendingCopy) {
            pendingAssetCopyRef.current = null;
            void sendPreparedAsset(pendingCopy, true);
            return;
          }
          const pending = pendingMediaRef.current;
          if (pending) {
            pendingMediaRef.current = null;
            sendMediaFile(pending.file, pending.filename, pending.durationSeconds, pending.isRecording, true);
            return;
          }
          handleSend(true);
        }}
        onCancel={() => setConfirmingDoNotContact(false)}
      />
    </div>
  );
}

/**
 * Los adjuntos de un mensaje (F64).
 *
 * Los de email tienen nombre y tamaño y se bajan con un link firmado que se
 * pide al hacer clic: firmarlos al pintar el hilo seria firmar veinte links
 * que nadie va a abrir, y los links vencen.
 *
 * Los de los otros canales siguen como estaban: un clip y la palabra
 * "Adjunto", porque de Instagram y WhatsApp llega el payload crudo del
 * proveedor y no un archivo nuestro.
 */
/**
 * Los adjuntos de un mensaje (F12, F13).
 *
 * Antes sólo entendía el formato de los correos: todo lo demás mostraba un clip
 * y la palabra "Adjunto", así que una nota de voz de Instagram o WhatsApp no se
 * podía escuchar. Ahora pasa por el parser único (F1) y cada tipo tiene su
 * visor, su reproductor, su tarjeta o su etiqueta.
 *
 * El adjunto va ARRIBA del texto, como en WhatsApp, y la transcripción debajo
 * del reproductor.
 */
function MessageAttachments({ message }: { message: Message }) {
  const isInboundSticker = message.direction === "inbound";
  const items = parseAttachments(message.attachments);
  const [retrying, setRetrying] = useState(false);

  async function retryDownload() {
    if (retrying) return;
    setRetrying(true);
    try {
      await fetch(`/api/v1/messages/${message.id}/media-retry`, { method: "POST" });
    } catch {
      // El motivo ya está en la burbuja; un toast acá sería ruido encima.
    } finally {
      setRetrying(false);
    }
  }

  if (items.length === 0) return null;

  return (
    <div className="space-y-1">
      {items.map((item, index) => (
        <MediaAttachment
          key={`${message.id}-${index}`}
          item={item}
          onRetry={retryDownload}
          onSaveSticker={
            // Uno recibido se guarda con un boton; los que se mandan entran solos (00257).
            isInboundSticker && item.kind === "sticker" && item.storagePath
              ? () => saveStickerFromMessage({ messageId: message.id, storagePath: item.storagePath! })
              : undefined
          }
        />
      ))}
      <TranscriptBlock messageId={message.id} message={message} />
    </div>
  );
}
