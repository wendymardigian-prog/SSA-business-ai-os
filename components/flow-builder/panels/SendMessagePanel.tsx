"use client";

import { useCallback, useId, useRef, useState } from "react";
import { Plus, X, GripVertical, Image, Type, MousePointer, MessageCircle, LayoutGrid, ChevronDown, ChevronRight, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmojiButton, useEmojiInsert } from "@/components/ui/emoji-picker";
import {
  attributionPanelView,
  nextAttribution,
  splitCodeSpans,
  type AttributionDefaults,
} from "@/lib/attribution/panel-view";

interface QuickReply {
  title: string;
  payload: string;
}

interface Button {
  title: string;
  type: "postback" | "url";
  payload?: string;
  url?: string;
}

interface CarouselElement {
  imageUrl?: string;
  title: string;
  subtitle?: string;
  buttons?: Button[];
}

interface Carousel {
  elements: CarouselElement[];
}

interface Message {
  text?: string;
  imageUrl?: string;
  // Media attachment. mediaType + mediaUrl supersede the legacy image-only imageUrl
  // and let a message send an image, video, or audio file.
  mediaUrl?: string;
  mediaType?: "image" | "video" | "audio";
  quickReplies?: QuickReply[];
  buttons?: Button[];
  carousel?: Carousel;
}

interface SendMessagePanelData {
  messages?: Message[];
  [key: string]: unknown;
}

/** Lo que el editor sabe del flujo para armar el bloque «Atribución de links» (F39). */
export interface AttributionPanelContext {
  flowId: string;
  flowName: string;
  /** Los valores por defecto del negocio (Ajustes → Atribución). */
  defaults: AttributionDefaults;
  triggerType?: string | null;
  storyReply?: boolean;
}

interface SendMessagePanelProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
  availableVariables?: string[];
  /** Sin esto el bloque de atribución no se muestra. */
  attributionContext?: AttributionPanelContext;
}

function VariablePicker({
  variables,
  onInsert,
}: {
  variables: string[];
  onInsert: (variable: string) => void;
}) {
  return (
    <div className="mt-1.5">
      <p className="text-[11px] text-muted-foreground/60">
        Tocá una variable para insertarla. Con puntos, como {"{{myvar.data.name}}"}, se leen
        campos de una respuesta JSON.
      </p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {variables.map((variable) => (
          <button
            key={variable}
            type="button"
            onClick={() => onInsert(variable)}
            className="rounded px-1.5 py-0.5 font-mono text-[11px] font-medium text-blue-500 hover:bg-blue-50"
          >
            {`{{${variable}}}`}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SendMessagePanel({ data: rawData, onChange, availableVariables, attributionContext }: SendMessagePanelProps) {
  const data = rawData as SendMessagePanelData;
  const messages = data.messages || [];

  const updateMessage = useCallback(
    (index: number, updated: Message) => {
      const msgs = [...messages];
      msgs[index] = updated;
      onChange({ ...data, messages: msgs });
    },
    [data, messages, onChange]
  );

  const addMessage = useCallback(() => {
    onChange({ ...data, messages: [...messages, { text: "" }] });
  }, [data, messages, onChange]);

  const removeMessage = useCallback(
    (index: number) => {
      onChange({ ...data, messages: messages.filter((_, i) => i !== index) });
    },
    [data, messages, onChange]
  );

  return (
    <div className="space-y-4">
      {messages.map((message, msgIndex) => (
        <MessageEditor
          key={msgIndex}
          index={msgIndex}
          message={message}
          onChange={(updated) => updateMessage(msgIndex, updated)}
          onRemove={() => removeMessage(msgIndex)}
          canRemove={messages.length > 1}
          availableVariables={availableVariables}
        />
      ))}

      <button
        type="button"
        onClick={addMessage}
        className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground transition-colors hover:border-blue-400 hover:text-blue-500"
      >
        <Plus className="h-4 w-4" />
        Agregar mensaje
      </button>

      {messages.length === 0 && (
        <p className="text-center text-xs text-muted-foreground">
          Agregá al menos un mensaje para enviar.
        </p>
      )}

      {attributionContext && <AttributionBlock data={rawData} onChange={onChange} context={attributionContext} />}

      {/* Platform hints */}
      <div className="rounded-lg border border-border bg-muted p-3">
        <p className="text-xs font-medium text-muted-foreground">Notas por canal</p>
        <ul className="mt-1.5 space-y-1 text-[11px] text-muted-foreground">
          <li>Facebook, Instagram y WhatsApp: hasta 3 botones por mensaje.</li>
          <li>Telegram: los botones aparecen debajo del mensaje.</li>
          <li>Las respuestas rápidas desaparecen cuando la persona contesta.</li>
          <li>Carruseles: nativos en Facebook e Instagram; en los demás canales llegan como texto.</li>
          <li>
            WhatsApp: Meta solo acepta mensajes libres dentro de las 24 horas
            del último mensaje del contacto.
          </li>
        </ul>
      </div>
    </div>
  );
}

function SwitchRow({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
      />
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-xs font-medium text-foreground">{label}</span>
        {description && <span className="mt-0.5 block text-[11px] text-muted-foreground">{description}</span>}
      </label>
    </div>
  );
}

/**
 * «Atribución de links» (Extra I, F39 y F40): los parámetros que se agregan a cada link del mensaje y, opcionalmente, el
 * registro del clic. Plegable (un botón con `aria-expanded`); arranca abierto si ya está encendido. Todo lo que decide qué
 * mostrar sale de `attributionPanelView`. No escribe nada en el nodo hasta que la persona toca un interruptor.
 */
function AttributionBlock({
  data,
  onChange,
  context,
}: {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
  context: AttributionPanelContext;
}) {
  const view = attributionPanelView({
    attribution: data.attribution,
    defaults: context.defaults,
    flowId: context.flowId,
    flowName: context.flowName,
    triggerType: context.triggerType,
    storyReply: context.storyReply,
  });
  const [open, setOpen] = useState(view.startOpen);
  const bodyId = useId();

  const update = (change: { append?: boolean; trackClicks?: boolean }) =>
    onChange({ ...data, attribution: nextAttribution(data.attribution, change, context.defaults) });

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 text-xs font-semibold text-foreground">Atribución de links</span>
        {view.append && (
          <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
            Encendida
          </span>
        )}
      </button>

      {open && (
        <div id={bodyId} className="space-y-3 border-t border-border px-3 py-3">
          <SwitchRow
            checked={view.append}
            onChange={(value) => update({ append: value })}
            label="Agregar parámetros de atribución"
            description="Cada link del mensaje (texto y botones) sale con parámetros que dicen de dónde vino la visita."
          />
          {view.businessDefaultHint && <p className="text-[11px] text-muted-foreground">{view.businessDefaultHint}</p>}

          {view.showTrackClicks && (
            <SwitchRow
              checked={view.trackClicks}
              onChange={(value) => update({ trackClicks: value })}
              label="Registrar el clic"
              description="Anota quién hizo clic y cuándo."
            />
          )}

          {view.append && (
            <div className="space-y-2 rounded-lg bg-muted p-2.5">
              <p className="text-[11px] font-medium text-muted-foreground">Parámetros que se agregan</p>
              <ul className="space-y-0.5">
                {view.params.map((p) => (
                  <li key={p.key} className="break-all font-mono text-[11px] text-foreground">
                    {p.key}={p.value}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted-foreground">
                {view.exampleLead}, el link{" "}
                <code className="break-all rounded bg-card px-1 py-0.5 font-mono text-[11px] text-foreground">{view.exampleBefore}</code>{" "}
                sale como{" "}
                <code className="break-all rounded bg-card px-1 py-0.5 font-mono text-[11px] text-foreground">{view.exampleAfter}</code>.
              </p>
              <p className="text-[11px] text-muted-foreground">
                {splitCodeSpans(view.contentLine).map((part, i) =>
                  part.code ? (
                    <code key={i} className="break-all rounded bg-card px-1 py-0.5 font-mono text-[11px] text-foreground">
                      {part.text}
                    </code>
                  ) : (
                    <span key={i}>{part.text}</span>
                  ),
                )}
              </p>
              {view.sourceNote && <p className="text-[11px] text-muted-foreground">{view.sourceNote}</p>}
              <p className="text-[11px] text-muted-foreground">
                Si el link ya trae alguno de estos parámetros, se respeta el que tiene. Los links de chat (wa.me, m.me, instagram.com) no se tocan.
              </p>
            </div>
          )}

          {view.trackNote && <p className="text-[11px] text-muted-foreground">{view.trackNote}</p>}
          {view.noContactNote && (
            <p role="note" className="rounded-lg bg-amber-500/10 p-2 text-[11px] text-amber-800 dark:text-amber-300">
              {view.noContactNote}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function MessageEditor({
  index,
  message,
  onChange,
  onRemove,
  canRemove,
  availableVariables,
}: {
  index: number;
  message: Message;
  onChange: (m: Message) => void;
  onRemove: () => void;
  canRemove: boolean;
  availableVariables?: string[];
}) {
  const isCarouselMode = !!message.carousel;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const insertVariable = useCallback(
    (variable: string) => {
      const token = `{{${variable}}}`;
      const textarea = textareaRef.current;
      const text = message.text || "";
      const caret = textarea?.selectionStart ?? text.length;
      onChange({
        ...message,
        text: text.slice(0, caret) + token + text.slice(caret),
      });
      // Restore focus and place the caret after the inserted token
      requestAnimationFrame(() => {
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(caret + token.length, caret + token.length);
      });
    },
    [message, onChange]
  );

  const insertEmoji = useEmojiInsert(textareaRef, message.text || "", (text) => onChange({ ...message, text }));

  const toggleMode = useCallback(() => {
    if (isCarouselMode) {
      // Switch to text mode: remove carousel
      const { carousel: _, ...rest } = message;
      onChange({ ...rest, text: rest.text || "" });
    } else {
      // Switch to carousel mode: remove text-mode fields, add empty carousel
      onChange({
        carousel: {
          elements: [{ title: "", subtitle: "", imageUrl: "" }],
        },
      });
    }
  }, [isCarouselMode, message, onChange]);

  // Quick replies
  const addQuickReply = useCallback(() => {
    const replies = message.quickReplies || [];
    onChange({ ...message, quickReplies: [...replies, { title: "", payload: "" }] });
  }, [message, onChange]);

  const updateQuickReply = useCallback(
    (i: number, updated: QuickReply) => {
      const replies = [...(message.quickReplies || [])];
      replies[i] = updated;
      onChange({ ...message, quickReplies: replies });
    },
    [message, onChange]
  );

  const removeQuickReply = useCallback(
    (i: number) => {
      const replies = (message.quickReplies || []).filter((_, idx) => idx !== i);
      onChange({ ...message, quickReplies: replies.length > 0 ? replies : undefined });
    },
    [message, onChange]
  );

  // Buttons
  const addButton = useCallback(() => {
    const buttons = message.buttons || [];
    onChange({ ...message, buttons: [...buttons, { title: "", type: "postback", payload: "" }] });
  }, [message, onChange]);

  const updateButton = useCallback(
    (i: number, updated: Button) => {
      const buttons = [...(message.buttons || [])];
      buttons[i] = updated;
      onChange({ ...message, buttons });
    },
    [message, onChange]
  );

  const removeButton = useCallback(
    (i: number) => {
      const buttons = (message.buttons || []).filter((_, idx) => idx !== i);
      onChange({ ...message, buttons: buttons.length > 0 ? buttons : undefined });
    },
    [message, onChange]
  );

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Message header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60" />
          <span className="text-xs font-semibold text-muted-foreground">
            Mensaje {index + 1}
          </span>
        </div>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Quitar el mensaje ${index + 1}`}
            className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Mode toggle */}
      <div className="flex border-b border-border">
        <button
          type="button"
          onClick={() => isCarouselMode && toggleMode()}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors",
            !isCarouselMode
              ? "border-b-2 border-blue-500 text-blue-600"
              : "text-muted-foreground/60 hover:text-muted-foreground"
          )}
        >
          <Type className="h-3 w-3" />
          Texto
        </button>
        <button
          type="button"
          onClick={() => !isCarouselMode && toggleMode()}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors",
            isCarouselMode
              ? "border-b-2 border-blue-500 text-blue-600"
              : "text-muted-foreground/60 hover:text-muted-foreground"
          )}
        >
          <LayoutGrid className="h-3 w-3" />
          Carrusel
        </button>
      </div>

      <div className="space-y-4 p-3">
        {isCarouselMode ? (
          <CarouselEditor
            carousel={message.carousel!}
            onChange={(carousel) => onChange({ ...message, carousel })}
          />
        ) : (
          <>
            {/* Text */}
            <div>
              <div className="mb-1.5 flex items-center gap-1.5">
                <Type className="h-3 w-3 text-muted-foreground/60" />
                <label className="flex-1 text-xs font-medium text-muted-foreground">Texto</label>
                <EmojiButton
                  onPick={insertEmoji}
                  focusRef={textareaRef}
                  placement="bottom"
                  align="end"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                />
              </div>
              <textarea
                ref={textareaRef}
                value={message.text || ""}
                onChange={(e) => onChange({ ...message, text: e.target.value })}
                placeholder="Escribí tu mensaje… Abajo podés insertar variables"
                rows={3}
                className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {availableVariables && availableVariables.length > 0 ? (
                <VariablePicker
                  variables={availableVariables}
                  onInsert={insertVariable}
                />
              ) : (
                <p className="text-[11px] text-muted-foreground/60">
                  Usá {"{{variable}}"} para insertar datos de cada contacto
                </p>
              )}
            </div>

            {/* Media (image / video / audio) */}
            <div>
              <div className="mb-1.5 flex items-center gap-1.5">
                <Image className="h-3 w-3 text-muted-foreground/60" />
                <label className="text-xs font-medium text-muted-foreground">URL del archivo</label>
              </div>
              <div className="flex gap-2">
                <select
                  value={message.mediaType || "image"}
                  onChange={(e) =>
                    onChange({
                      ...message,
                      mediaType: e.target.value as "image" | "video" | "audio",
                    })
                  }
                  className="rounded-lg border border-border bg-card px-2 py-2 text-sm text-foreground focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="image">Imagen</option>
                  <option value="video">Video</option>
                  <option value="audio">Audio</option>
                </select>
                <input
                  type="url"
                  value={message.mediaUrl ?? message.imageUrl ?? ""}
                  onChange={(e) =>
                    onChange({
                      ...message,
                      mediaUrl: e.target.value || undefined,
                      mediaType: message.mediaType || "image",
                      // Clear the legacy image-only field so the two don't diverge.
                      imageUrl: undefined,
                    })
                  }
                  placeholder="https://ejemplo.com/archivo.mp4"
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground/60">
                Manda una imagen, un video o un audio junto con este mensaje.
              </p>
            </div>

            {/* Quick Replies */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <MessageCircle className="h-3 w-3 text-muted-foreground/60" />
                  <label className="text-xs font-medium text-muted-foreground">
                    Respuestas rápidas
                  </label>
                </div>
                <button
                  type="button"
                  onClick={addQuickReply}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-blue-500 hover:bg-blue-50"
                >
                  <Plus className="h-3 w-3" />
                  Agregar
                </button>
              </div>
              {(message.quickReplies || []).map((qr, i) => (
                <div key={i} className="mb-2 flex items-center gap-2">
                  <input
                    type="text"
                    value={qr.title}
                    onChange={(e) => updateQuickReply(i, { ...qr, title: e.target.value })}
                    placeholder="Texto"
                    className="flex-1 rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <input
                    type="text"
                    value={qr.payload}
                    onChange={(e) => updateQuickReply(i, { ...qr, payload: e.target.value })}
                    placeholder="Valor"
                    className="flex-1 rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => removeQuickReply(i)}
                    aria-label="Quitar la respuesta rápida"
                    className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>

            {/* Buttons */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <MousePointer className="h-3 w-3 text-muted-foreground/60" />
                  <label className="text-xs font-medium text-muted-foreground">
                    Botones
                  </label>
                </div>
                <button
                  type="button"
                  onClick={addButton}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-blue-500 hover:bg-blue-50"
                >
                  <Plus className="h-3 w-3" />
                  Agregar
                </button>
              </div>
              {(message.buttons || []).map((btn, i) => (
                <div
                  key={i}
                  className="mb-2 rounded-lg border border-border bg-muted p-2.5"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <input
                      type="text"
                      value={btn.title}
                      onChange={(e) => updateButton(i, { ...btn, title: e.target.value })}
                      placeholder="Texto del botón"
                      className="flex-1 rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => removeButton(i)}
                      aria-label="Quitar el botón"
                      className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={btn.type}
                      onChange={(e) => {
                        const type = e.target.value as "postback" | "url";
                        updateButton(i, {
                          ...btn,
                          type,
                          payload: type === "postback" ? btn.payload || "" : undefined,
                          url: type === "url" ? btn.url || "" : undefined,
                        });
                      }}
                      className="rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="postback">Respuesta</option>
                      <option value="url">Link</option>
                    </select>
                    {btn.type === "postback" ? (
                      <input
                        type="text"
                        value={btn.payload || ""}
                        onChange={(e) => updateButton(i, { ...btn, payload: e.target.value })}
                        placeholder="Valor"
                        className="flex-1 rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    ) : (
                      <input
                        type="url"
                        value={btn.url || ""}
                        onChange={(e) => updateButton(i, { ...btn, url: e.target.value })}
                        placeholder="https://..."
                        className="flex-1 rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>

            <p className="text-[11px] text-muted-foreground/60">
              En WhatsApp las opciones llegan como una lista numerada en el texto.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function CarouselEditor({
  carousel,
  onChange,
}: {
  carousel: Carousel;
  onChange: (c: Carousel) => void;
}) {
  const elements = carousel.elements || [];

  const addCard = useCallback(() => {
    onChange({
      elements: [...elements, { title: "", subtitle: "", imageUrl: "" }],
    });
  }, [elements, onChange]);

  const updateCard = useCallback(
    (i: number, updated: CarouselElement) => {
      const els = [...elements];
      els[i] = updated;
      onChange({ elements: els });
    },
    [elements, onChange]
  );

  const removeCard = useCallback(
    (i: number) => {
      onChange({ elements: elements.filter((_, idx) => idx !== i) });
    },
    [elements, onChange]
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <LayoutGrid className="h-3 w-3 text-muted-foreground/60" />
          <label className="text-xs font-medium text-muted-foreground">
            Tarjetas ({elements.length})
          </label>
        </div>
        <button
          type="button"
          onClick={addCard}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-blue-500 hover:bg-blue-50"
        >
          <Plus className="h-3 w-3" />
          Agregar tarjeta
        </button>
      </div>

      {elements.map((el, i) => (
        <CarouselCardEditor
          key={i}
          index={i}
          element={el}
          onChange={(updated) => updateCard(i, updated)}
          onRemove={() => removeCard(i)}
          canRemove={elements.length > 1}
        />
      ))}

      {elements.length === 0 && (
        <p className="text-center text-xs text-muted-foreground">
          Agregá al menos una tarjeta al carrusel.
        </p>
      )}
    </div>
  );
}

function CarouselCardEditor({
  index,
  element,
  onChange,
  onRemove,
  canRemove,
}: {
  index: number;
  element: CarouselElement;
  onChange: (el: CarouselElement) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const buttons = element.buttons || [];

  const addButton = useCallback(() => {
    if (buttons.length >= 3) return;
    onChange({
      ...element,
      buttons: [...buttons, { title: "", type: "postback", payload: "" }],
    });
  }, [element, buttons, onChange]);

  const updateButton = useCallback(
    (i: number, updated: Button) => {
      const btns = [...buttons];
      btns[i] = updated;
      onChange({ ...element, buttons: btns });
    },
    [element, buttons, onChange]
  );

  const removeButton = useCallback(
    (i: number) => {
      const btns = buttons.filter((_, idx) => idx !== i);
      onChange({ ...element, buttons: btns.length > 0 ? btns : undefined });
    },
    [element, buttons, onChange]
  );

  return (
    <div className="rounded-lg border border-border bg-muted p-2.5">
      {/* Card header */}
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-muted-foreground">
          Tarjeta {index + 1}
        </span>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Quitar la tarjeta ${index + 1}`}
            className="rounded p-0.5 text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <div className="space-y-2">
        {/* Image URL */}
        <div>
          <div className="mb-1 flex items-center gap-1">
            <Image className="h-2.5 w-2.5 text-muted-foreground/60" />
            <label className="text-[11px] font-medium text-muted-foreground">URL de la imagen</label>
          </div>
          <input
            type="url"
            value={element.imageUrl || ""}
            onChange={(e) =>
              onChange({ ...element, imageUrl: e.target.value || undefined })
            }
            placeholder="https://ejemplo.com/imagen.png"
            className="w-full rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Title */}
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
            Título
          </label>
          <input
            type="text"
            value={element.title}
            onChange={(e) => onChange({ ...element, title: e.target.value })}
            placeholder="Título de la tarjeta (hasta 80 caracteres)"
            maxLength={80}
            className="w-full rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Subtitle */}
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
            Subtítulo
          </label>
          <input
            type="text"
            value={element.subtitle || ""}
            onChange={(e) =>
              onChange({ ...element, subtitle: e.target.value || undefined })
            }
            placeholder="Subtítulo de la tarjeta"
            className="w-full rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Buttons */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <MousePointer className="h-2.5 w-2.5 text-muted-foreground/60" />
              <label className="text-[11px] font-medium text-muted-foreground">
                Botones ({buttons.length}/3)
              </label>
            </div>
            {buttons.length < 3 && (
              <button
                type="button"
                onClick={addButton}
                className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium text-blue-500 hover:bg-blue-50"
              >
                <Plus className="h-2.5 w-2.5" />
                Agregar
              </button>
            )}
          </div>
          {buttons.map((btn, i) => (
            <div
              key={i}
              className="mb-1.5 rounded border border-border bg-card p-2"
            >
              <div className="mb-1.5 flex items-center gap-1.5">
                <input
                  type="text"
                  value={btn.title}
                  onChange={(e) =>
                    updateButton(i, { ...btn, title: e.target.value })
                  }
                  placeholder="Texto del botón"
                  className="flex-1 rounded border border-border bg-card px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => removeButton(i)}
                  aria-label="Quitar el botón"
                  className="rounded p-0.5 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <select
                  value={btn.type}
                  onChange={(e) => {
                    const type = e.target.value as "postback" | "url";
                    updateButton(i, {
                      ...btn,
                      type,
                      payload:
                        type === "postback" ? btn.payload || "" : undefined,
                      url: type === "url" ? btn.url || "" : undefined,
                    });
                  }}
                  className="rounded border border-border bg-card px-1.5 py-1 text-[11px] text-foreground focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="postback">Respuesta</option>
                  <option value="url">Link</option>
                </select>
                {btn.type === "postback" ? (
                  <input
                    type="text"
                    value={btn.payload || ""}
                    onChange={(e) =>
                      updateButton(i, { ...btn, payload: e.target.value })
                    }
                    placeholder="Valor"
                    className="flex-1 rounded border border-border bg-card px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                ) : (
                  <input
                    type="url"
                    value={btn.url || ""}
                    onChange={(e) =>
                      updateButton(i, { ...btn, url: e.target.value })
                    }
                    placeholder="https://..."
                    className="flex-1 rounded border border-border bg-card px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
