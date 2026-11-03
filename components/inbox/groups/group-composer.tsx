"use client";

import { useRef, useState, useTransition } from "react";
import { BarChart3, Loader2, Paperclip, Plus, Send, X } from "lucide-react";
import { EmojiButton, useEmojiInsert } from "@/components/ui/emoji-picker";
import { CenterDialog } from "@/components/tasks/overlay";
import { createClient } from "@/lib/supabase/client";
import { CHAT_MEDIA_BUCKET } from "@/lib/chat-media/bucket";
import { headBase64Of } from "@/lib/content/media";
import { requestGroupUpload, sendGroupMessage, sendGroupPoll } from "@/lib/actions/whatsapp-group-inbox";
import { POLL_MAX_OPTIONS } from "@/lib/whatsapp-groups/poll";

/**
 * Escribir en un grupo: texto, emoji, una foto / video / archivo (con el texto como pie) o una encuesta. Enter manda;
 * Shift+Enter hace un salto de línea.
 */
export function GroupComposer({ groupId, onSent }: { groupId: string; onSent: () => void }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pollOpen, setPollOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const insertEmoji = useEmojiInsert(textareaRef, text, setText);

  function send() {
    if (pending || (!text.trim() && !file)) return;
    setError(null);
    start(async () => {
      let media = null;
      if (file) {
        const auth = await requestGroupUpload(groupId, { sizeBytes: file.size, headBase64: await headBase64Of(file), declaredMime: file.type || undefined });
        if (!auth.ok) {
          setError(auth.error);
          return;
        }
        const { error: uploadError } = await createClient().storage.from(CHAT_MEDIA_BUCKET).uploadToSignedUrl(auth.path, auth.token, file, { contentType: auth.mime });
        if (uploadError) {
          setError("No pude subir el archivo. Probá de nuevo.");
          return;
        }
        const kind = auth.mime.startsWith("image/") ? "image" : auth.mime.startsWith("video/") ? "video" : "document";
        media = { storagePath: auth.path, kind: kind as "image" | "video" | "document", mime: auth.mime, filename: file.name || null };
      }
      const result = await sendGroupMessage(groupId, { text, media });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setText("");
      setFile(null);
      onSent();
    });
  }

  return (
    <div className="border-t border-border bg-background p-2">
      {file && (
        <div className="mb-1.5 flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs">
          <Paperclip className="h-3 w-3" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <button type="button" aria-label="Quitar el archivo" onClick={() => setFile(null)}>
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mb-1.5 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}
      <div className="flex items-end gap-1.5">
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
          className="hidden"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
        <button type="button" onClick={() => fileRef.current?.click()} aria-label="Adjuntar un archivo" className="rounded-lg p-2 text-muted-foreground hover:bg-muted">
          <Paperclip className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" onClick={() => setPollOpen(true)} aria-label="Mandar una encuesta" title="Encuesta" className="rounded-lg p-2 text-muted-foreground hover:bg-muted">
          <BarChart3 className="h-4 w-4" aria-hidden />
        </button>
        <EmojiButton onPick={insertEmoji} focusRef={textareaRef} className="p-2" />
        <textarea
          ref={textareaRef}
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Escribí al grupo…"
          aria-label="Mensaje al grupo"
          className="max-h-40 min-h-[38px] flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={send}
          disabled={pending || (!text.trim() && !file)}
          aria-label="Mandar"
          className="rounded-lg bg-primary p-2 text-primary-foreground disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
        </button>
      </div>
      {pollOpen && <PollDialog groupId={groupId} onClose={() => setPollOpen(false)} onSent={onSent} />}
    </div>
  );
}

function PollDialog({ groupId, onClose, onSent }: { groupId: string; onClose: () => void; onSent: () => void }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multiple, setMultiple] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send() {
    setError(null);
    start(async () => {
      const result = await sendGroupPoll(groupId, { question, options, multiple });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSent();
      onClose();
    });
  }

  const input = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm";
  return (
    <CenterDialog label="Mandar una encuesta" onClose={onClose}>
      <div className="space-y-3 overflow-y-auto p-5">
        <h2 className="text-base font-semibold">Encuesta</h2>
        <label className="block space-y-1">
          <span className="text-xs font-semibold">Pregunta</span>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="¿Qué día te queda mejor?" className={input} />
        </label>
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-xs font-semibold">Opciones</legend>
          {options.map((option, index) => (
            <div key={index} className="flex items-center gap-1.5">
              <input
                value={option}
                aria-label={`Opción ${index + 1}`}
                onChange={(e) => setOptions(options.map((o, i) => (i === index ? e.target.value : o)))}
                placeholder={`Opción ${index + 1}`}
                className={input}
              />
              {options.length > 2 && (
                <button type="button" aria-label={`Quitar la opción ${index + 1}`} onClick={() => setOptions(options.filter((_, i) => i !== index))} className="rounded p-1 hover:bg-muted">
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </div>
          ))}
          {options.length < POLL_MAX_OPTIONS && (
            <button type="button" onClick={() => setOptions([...options, ""])} className="inline-flex items-center gap-1 text-xs font-medium text-primary-ink hover:underline">
              <Plus className="h-3 w-3" aria-hidden />
              Agregar opción
            </button>
          )}
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} />
          Se puede elegir más de una opción
        </label>
        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
        <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
          Cancelar
        </button>
        <button type="button" onClick={send} disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          Mandar encuesta
        </button>
      </div>
    </CenterDialog>
  );
}
