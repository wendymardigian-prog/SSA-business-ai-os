"use client";

/**
 * Pestaña IA del editor (F31): la conversación con la IA del diseño o la plantilla.
 *
 * Arriba «Estilo ▾» (con sus colores); en el medio los mensajes (con las
 * imágenes adjuntas, «qué cambió», los avisos de la revisión y las propuestas
 * con Hacerlo / No); abajo «Sobre: Todo / Solo la página N», el campo (Enter
 * envía, Shift+Enter hace una línea nueva), «+ Imagen» y las sugerencias.
 *
 * Mientras la IA trabaja se ve «Diseñando…» con los puntos animados; el lienzo
 * no se bloquea (los cambios manuales se conservan: la fusión la hace el
 * servidor). Cuando la IA guarda cambios se llama a `onApplied()` para que el
 * editor vuelva a leer el documento. La lógica de qué se ve y cuándo va en
 * `lib/designer/screens/ai-panel.ts`.
 *
 * Lo que el permiso no da se OCULTA: sin `canEdit` se ve la conversación pero no
 * el campo ni el estilo ni los botones de las propuestas.
 */

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { AlertTriangle, Check, ChevronDown, ImagePlus, Loader2, Send, Sparkles, X } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { answerProposal, changeStyle, loadConversation, sendAiMessage } from "@/lib/actions/designer/ai";
import { uploadDesignImageAction } from "@/lib/actions/designer/designs";
import type { LoadConversationData, StyleOption } from "@/lib/designer/ai/action-types";
import type { AiPanelProps } from "@/lib/designer/contracts";
import {
  ACCEPTED_IMAGE_TYPES,
  actionErrorText,
  bubbleFor,
  checkPickedImage,
  composerState,
  COMPOSER_PLACEHOLDER,
  EMPTY_CONVERSATION,
  isWaiting,
  keyAction,
  newlyApplied,
  normalizeScope,
  pollDelayMs,
  proposalStatusLabel,
  scopeOptions,
  STYLE_HINT,
  suggestionsFor,
  toAttachment,
  WORKING_LABEL,
  type PendingAttachment,
} from "@/lib/designer/screens/ai-panel";

const INTEGRATIONS_HREF = "/dashboard/settings/integrations";

function StyleDots({ style }: { style: Pick<StyleOption, "palette"> }) {
  return (
    <span className="flex shrink-0 -space-x-1" aria-hidden>
      {[style.palette.bg, style.palette.text, style.palette.accent].map((color, i) => (
        <i key={i} className="h-3.5 w-3.5 rounded-full border border-border" style={{ background: color }} />
      ))}
    </span>
  );
}

/** Los tres puntos animados de «Diseñando…». */
function Dots() {
  return (
    <span className="inline-flex gap-1" aria-hidden>
      {[0, 150, 300].map((delay) => (
        <i key={delay} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: `${delay}ms` }} />
      ))}
    </span>
  );
}

export function AiPanel(props: AiPanelProps) {
  const { target, format, isTemplate, currentPage, pageCount, rev, styleKey, canEdit, onApplied } = props;
  const inputId = useId();
  const [data, setData] = useState<LoadConversationData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [scopeMode, setScopeMode] = useState<"all" | "page">("all");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, startSending] = useTransition();
  const [answering, setAnswering] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmStyle, setConfirmStyle] = useState<StyleOption | null>(null);
  const [changingStyle, setChangingStyle] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string> | null>(null);
  const onAppliedRef = useRef(onApplied);
  useEffect(() => {
    onAppliedRef.current = onApplied;
  }, [onApplied]);

  const refresh = useCallback(async () => {
    try {
      const result = await loadConversation({ kind: target.kind, id: target.id });
      if (!result.ok) {
        setLoadError(result.error);
        return;
      }
      setLoadError(null);
      setData(result.data);
      if (seen.current === null) {
        // La primera carga marca todo lo viejo como visto: no se recarga el editor por lo que ya estaba.
        seen.current = new Set(result.data.messages.map((m) => m.id));
      } else {
        const fresh = newlyApplied(seen.current, result.data.messages);
        for (const m of result.data.messages) seen.current.add(m.id);
        if (fresh.length > 0) onAppliedRef.current();
      }
    } catch {
      setLoadError("No pude cargar la conversación. Probá de nuevo.");
    }
  }, [target.kind, target.id]);

  useEffect(() => {
    seen.current = null;
    // Cargar la conversación de este diseño: es el efecto que sincroniza el panel con el servidor.
    void refresh();
  }, [refresh]);

  const messages = data?.messages ?? [];
  const waiting = isWaiting(messages);

  // Mientras la IA trabaja se vuelve a mirar cada pocos segundos (cada vez menos seguido si tarda).
  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await refresh();
      timer = setTimeout(tick, pollDelayMs(Date.now() - started));
    };
    timer = setTimeout(tick, pollDelayMs(0));
    return () => clearTimeout(timer);
  }, [waiting, refresh]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, waiting]);

  const scopes = useMemo(() => scopeOptions(currentPage, pageCount), [currentPage, pageCount]);
  const scopePage = scopeMode === "page" ? normalizeScope(currentPage, pageCount) : null;
  const suggestions = suggestionsFor({ format, isTemplate, pageCount });
  const aiConnected = data?.ai.connected ?? true;
  const state = composerState({ text, attachments: attachments.length, busy: waiting || sending, uploading, aiConnected });
  const styles = data?.styles ?? [];
  const currentStyle = styles.find((s) => s.key === (styleKey ?? "auto"));

  function send() {
    if (!state.canSend) return;
    setError(null);
    const request = { text, attachments: attachments.map((a) => ({ asset_path: a.asset_path, name: a.name, mime: a.mime })), page: scopePage };
    startSending(async () => {
      try {
        const result = await sendAiMessage({ kind: target.kind, id: target.id, text: request.text, page: request.page, attachments: request.attachments, baseRev: rev });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setText("");
        setAttachments([]);
        await refresh();
      } catch (e) {
        setError(actionErrorText(e));
      }
    });
  }

  async function pickImage(file: File | undefined) {
    if (!file) return;
    const problem = checkPickedImage(file, attachments.length);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await uploadDesignImageAction(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAttachments((list) => [...list, { ...toAttachment(result.data), previewUrl: result.data.url }]);
    } catch (e) {
      setError(actionErrorText(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function answer(messageId: string, accept: boolean) {
    setAnswering(messageId);
    setError(null);
    try {
      const result = await answerProposal({ kind: target.kind, id: target.id, messageId, accept });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await refresh();
      if (accept && result.data.rev !== undefined) onAppliedRef.current();
    } catch (e) {
      setError(actionErrorText(e));
    } finally {
      setAnswering(null);
    }
  }

  async function confirmChangeStyle() {
    if (!confirmStyle) return;
    setChangingStyle(true);
    setError(null);
    try {
      const result = await changeStyle({ kind: target.kind, id: target.id, style: confirmStyle.key });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirmStyle(null);
      await refresh();
    } catch (e) {
      setError(actionErrorText(e));
    } finally {
      setChangingStyle(false);
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-card" aria-label="Conversación con la IA">
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <span className="text-xs text-muted-foreground">Estilo</span>
          <Popover
            label="Elegir el estilo del diseño"
            align="start"
            panelClassName="w-72 p-1"
            closeOnSelect
            triggerClassName="inline-flex items-center gap-2 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent"
            trigger={
              <>
                {currentStyle && <StyleDots style={currentStyle} />}
                <span>{currentStyle?.name ?? "Automático"}</span>
                <ChevronDown className="h-3 w-3" aria-hidden />
              </>
            }
          >
            <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Estilo del diseño</p>
            <ul className="flex flex-col">
              {styles.map((style) => {
                const active = style.key === (styleKey ?? "auto");
                return (
                  <li key={style.key}>
                    <button
                      type="button"
                      aria-current={active ? "true" : undefined}
                      onClick={() => {
                        if (!active) setConfirmStyle(style);
                      }}
                      className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent aria-[current=true]:bg-accent"
                    >
                      <span className="mt-0.5">
                        <StyleDots style={style} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <b className="block font-medium">{style.name}</b>
                        {style.description && <span className="block text-muted-foreground">{style.description}</span>}
                      </span>
                      {active && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ul>
            {data?.canManage && (
              <Link href="/dashboard/disenos/ajustes" className="mt-1 block rounded-md border-t border-border px-2 py-2 text-xs text-primary-ink hover:bg-accent">
                ＋ Crear un estilo propio…
              </Link>
            )}
          </Popover>
          <span className="text-[11px] text-muted-foreground">{STYLE_HINT}</span>
        </div>
      )}

      {confirmStyle && canEdit && (
        <div className="border-b border-border bg-accent/50 px-3 py-3 text-xs" role="alertdialog" aria-label="Confirmar el cambio de estilo">
          <p>
            Rehace el diseño con el estilo <b>«{confirmStyle.name}»</b>: mismos textos, otra paleta, tipografía y composición. Podés volver atrás desde las versiones.
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={confirmChangeStyle} disabled={changingStyle || waiting} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {changingStyle && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              Rehacer el diseño
            </button>
            <button type="button" onClick={() => setConfirmStyle(null)} className="rounded-md border border-border px-3 py-1.5 hover:bg-accent">
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto bg-background p-3" role="log" aria-live="polite" aria-label="Mensajes con la IA">
        {!data && !loadError && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Cargando la conversación…
          </p>
        )}
        {loadError && (
          <p className="text-xs text-destructive" role="alert">
            {loadError}{" "}
            <button type="button" onClick={() => void refresh()} className="underline">
              Reintentar
            </button>
          </p>
        )}
        {data && messages.length === 0 && !waiting && <p className="text-xs text-muted-foreground">{EMPTY_CONVERSATION}</p>}

        {messages.map((message) => {
          const bubble = bubbleFor(message);
          const proposal = bubble.proposal;
          const base = "max-w-[92%] whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-[13px] leading-relaxed";
          const tone = bubble.kind === "user" ? "self-end bg-primary text-primary-foreground" : bubble.kind === "error" ? "self-start border border-destructive/40 bg-destructive/10 text-destructive" : "self-start border border-border bg-card";
          return (
            <div key={bubble.id} className={`${base} ${tone}`}>
              {bubble.scopeLabel && <span className="mb-0.5 block text-[11px] opacity-80">{bubble.scopeLabel}</span>}
              {bubble.text}
              {bubble.attachmentNames.length > 0 && (
                <span className="mt-1.5 flex flex-wrap gap-1.5">
                  {bubble.attachmentNames.map((name, i) => (
                    <span key={`${name}-${i}`} className="inline-flex items-center gap-1 rounded-md bg-black/15 px-1.5 py-0.5 text-[11px]">
                      <ImagePlus className="h-3 w-3" aria-hidden /> {name}
                    </span>
                  ))}
                </span>
              )}
              {bubble.did && (
                <span className="mt-1.5 flex items-center gap-1 text-[11.5px] text-muted-foreground">
                  <Check className="h-3 w-3" aria-hidden /> {bubble.did}
                </span>
              )}
              {bubble.warnings.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {bubble.warnings.map((warning, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[11.5px] text-warn">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> {warning}
                    </li>
                  ))}
                </ul>
              )}
              {proposal && proposal.status === "pending" && canEdit && (
                <span className="mt-2 flex gap-2">
                  <button type="button" onClick={() => void answer(message.id, true)} disabled={answering === message.id} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
                    {answering === message.id && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                    Hacerlo
                  </button>
                  <button type="button" onClick={() => void answer(message.id, false)} disabled={answering === message.id} className="rounded-md border border-border px-3 py-1 text-xs hover:bg-accent disabled:opacity-50">
                    No
                  </button>
                </span>
              )}
              {proposal && proposalStatusLabel(proposal.status) && <span className="mt-1.5 block text-[11.5px] text-muted-foreground">{proposalStatusLabel(proposal.status)}</span>}
            </div>
          );
        })}

        {waiting && (
          <div className="flex max-w-[92%] items-center gap-2 self-start rounded-xl border border-border bg-card px-3 py-2 text-[13px] text-muted-foreground" role="status">
            <Dots /> {WORKING_LABEL}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {canEdit && (
        <div className="flex flex-col gap-2 border-t border-border p-3">
          {scopes.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">Sobre:</span>
              <div role="group" aria-label="Alcance del pedido" className="inline-flex overflow-hidden rounded-md border border-border">
                {scopes.map((option) => {
                  const active = (scopeMode === "page" ? scopePage : null) === option.value;
                  return (
                    <button key={option.label} type="button" aria-pressed={active} onClick={() => setScopeMode(option.value === null ? "all" : "page")} className="px-2.5 py-1 hover:bg-accent aria-pressed:bg-primary aria-pressed:text-primary-foreground">
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {attachments.map((a, i) => (
                <span key={`${a.asset_path}-${i}`} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11.5px]">
                  <ImagePlus className="h-3 w-3" aria-hidden /> {a.name}
                  <button type="button" aria-label={`Quitar ${a.name}`} onClick={() => setAttachments((list) => list.filter((_, j) => j !== i))} className="rounded-full hover:text-destructive">
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          )}

          <label htmlFor={inputId} className="sr-only">
            Pedido para la IA
          </label>
          <textarea
            id={inputId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              const action = keyAction({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey });
              if (action === "send") {
                e.preventDefault();
                send();
              }
            }}
            rows={3}
            maxLength={4000}
            placeholder={COMPOSER_PLACEHOLDER}
            className="min-h-16 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />

          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading || attachments.length >= 5} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50">
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ImagePlus className="h-3.5 w-3.5" aria-hidden />}+ Imagen
            </button>
            <input ref={fileRef} type="file" accept={ACCEPTED_IMAGE_TYPES.join(",")} className="sr-only" tabIndex={-1} aria-label="Elegir una imagen para la IA" onChange={(e) => void pickImage(e.target.files?.[0])} />
            {!aiConnected ? (
              <Link href={INTEGRATIONS_HREF} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">
                <Sparkles className="h-3.5 w-3.5" aria-hidden /> Conectá una clave de IA en Configuración
              </Link>
            ) : (
              <button type="button" onClick={send} disabled={!state.canSend} title={!state.canSend && state.reason ? state.reason : undefined} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
                Enviar
              </button>
            )}
          </div>

          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}

          {!waiting && (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => setText(suggestion)} className="rounded-full border border-dashed border-border px-2.5 py-0.5 text-[11.5px] text-muted-foreground hover:border-muted-foreground hover:text-foreground">
                  {suggestion}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
