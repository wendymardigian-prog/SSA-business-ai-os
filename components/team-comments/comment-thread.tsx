"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Loader2, MoreHorizontal, Pencil, Send, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/filter-menu";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { colorOf, initialsOf } from "@/lib/shared/people";
import { cn } from "@/lib/utils";
import {
  activeMentionQuery,
  commentBodyProblem,
  filterCandidates,
  insertMention,
  mentionsInBody,
  type MentionCandidate,
} from "@/lib/team-comments/mentions";
import { bodySegments, threadItems, type CommentEntity, type ThreadItem } from "@/lib/team-comments/thread";
import {
  deleteTeamComment,
  editTeamComment,
  loadCommentThread,
  markEntityMentionsRead,
  postTeamComment,
  type ThreadPayload,
} from "@/lib/actions/team-comments";

/**
 * El hilo de comentarios con @menciones (F132). UNO SOLO para la tarea (F156) y la reunión (F145).
 *
 * Cuadro abajo, `@` abre la lista de personas que ven la entidad, Enter manda y Mayús+Enter salta de línea. Se
 * edita y borra lo propio. El comentario de sistema va en gris y sin acciones. Las entradas extra (historial de la
 * reunión o de la tarea) llegan por `extra` y se intercalan por fecha.
 */

export type ThreadExtra = { id: string; at: string; node: ReactNode };

function formatWhen(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("es-AR", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function CommentThread({
  entityType,
  entityId,
  canComment = true,
  extra = [],
  emptyText = "Todavía no hay comentarios.",
  onMentionsRead,
}: {
  entityType: CommentEntity;
  entityId: string;
  canComment?: boolean;
  extra?: ThreadExtra[];
  emptyText?: string;
  onMentionsRead?: () => void;
}) {
  const timeZone = useViewerTimezone();
  const [payload, setPayload] = useState<ThreadPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const toast = useMemo(() => ({ error: (m: string) => setNotice(m) }), []);

  const load = useCallback(async () => {
    const res = await loadCommentThread({ entityType, entityId });
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setPayload(res.data);
  }, [entityType, entityId]);

  // Se carga al abrir (y al cambiar de entidad). `loading` arranca en true: no hace falta prenderlo acá.
  useEffect(() => {
    let alive = true;
    void loadCommentThread({ entityType, entityId }).then((res) => {
      if (!alive) return;
      setLoading(false);
      if (!res.ok) return setError(res.error);
      setError(null);
      setPayload(res.data);
    });
    return () => {
      alive = false;
    };
  }, [entityType, entityId]);

  // Abrir el hilo marca como leídas mis menciones (el destacado queda hasta la próxima vez que se abre).
  useEffect(() => {
    if (!payload || payload.unreadMentionCommentIds.length === 0) return;
    void markEntityMentionsRead({ entityType, entityId }).then((r) => {
      if (r.ok && r.data.updated > 0) onMentionsRead?.();
    });
  }, [payload, entityType, entityId, onMentionsRead]);

  const items = useMemo(
    () => (payload ? threadItems(payload.rows, payload.viewerId, payload.unreadMentionCommentIds) : []),
    [payload],
  );

  const merged = useMemo(() => {
    const list: Array<{ at: string; key: string; comment?: ThreadItem; node?: ReactNode }> = [
      ...items.map((c) => ({ at: c.createdAt, key: `c:${c.id}`, comment: c })),
      ...extra.map((e) => ({ at: e.at, key: `e:${e.id}`, node: e.node })),
    ];
    return list.sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key));
  }, [items, extra]);

  if (loading && !payload) {
    return (
      <div className="space-y-3" aria-busy>
        {[0, 1].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    );
  }
  if (error && !payload) {
    return (
      <div className="rounded-md border border-border p-3 text-sm">
        <p className="text-muted-foreground">{error}</p>
        <button type="button" onClick={() => void load()} className="mt-2 text-sm font-medium text-primary-ink hover:underline">
          Reintentar
        </button>
      </div>
    );
  }
  const names = payload?.names ?? {};

  return (
    <div className="flex flex-col gap-3">
      {merged.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {merged.map((entry) => (
            <li key={entry.key}>
              {entry.comment ? (
                <CommentBubble
                  item={entry.comment}
                  entityType={entityType}
                  authorName={entry.comment.authorId ? names[entry.comment.authorId] ?? "Alguien del equipo" : "Sistema"}
                  mentionNames={(payload?.rows.find((r) => r.id === entry.comment!.id)?.mentions ?? []).map((id) => names[id]).filter(Boolean)}
                  candidates={payload?.candidates ?? []}
                  viewerId={payload?.viewerId ?? null}
                  when={formatWhen(entry.comment.createdAt, timeZone)}
                  onChanged={load}
                  onError={toast.error}
                />
              ) : (
                entry.node
              )}
            </li>
          ))}
        </ul>
      )}
      {notice && (
        <p role="alert" className="text-sm text-destructive">
          {notice}
        </p>
      )}
      {canComment && payload && (
        <CommentComposer
          candidates={payload.candidates}
          viewerId={payload.viewerId}
          onError={toast.error}
          onSend={async (body, mentions) => {
            const res = await postTeamComment({ entityType, entityId, body, mentions });
            if (!res.ok) {
              toast.error(res.error);
              return false;
            }
            setNotice(null);
            await load();
            return true;
          }}
        />
      )}
    </div>
  );
}

function CommentBubble({
  item,
  entityType,
  authorName,
  mentionNames,
  candidates,
  viewerId,
  when,
  onChanged,
  onError,
}: {
  item: ThreadItem;
  entityType: CommentEntity;
  authorName: string;
  mentionNames: string[];
  candidates: MentionCandidate[];
  viewerId: string | null;
  when: string;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const toast = { error: onError };
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);

  if (item.kind === "system") {
    return (
      <div className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
        <span>{item.body}</span>
        <span className="ml-2 opacity-80">{when}</span>
      </div>
    );
  }

  return (
    <div className={cn("flex gap-2", item.highlighted && "rounded-md bg-primary/10 p-2 ring-1 ring-primary-edge")}>
      {item.authorId ? (
        <Avatar initials={initialsOf(authorName)} color={colorOf(item.authorId)} userId={item.authorId} />
      ) : (
        <span className="h-[22px] w-[22px]" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold text-foreground">{authorName}</span>
          <span className="text-muted-foreground">{when}</span>
          {item.edited && <span className="text-muted-foreground">· editado</span>}
          {item.canEdit && !editing && (
            <div className="relative ml-auto">
              <button
                type="button"
                aria-label="Más acciones del comentario"
                onClick={() => setMenu((v) => !v)}
                className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted max-topbar:h-10 max-topbar:w-10"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {menu && (
                <div className="absolute right-0 z-20 mt-1 w-36 rounded-md border border-border bg-popover p-1 shadow-md">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      setMenu(false);
                      setEditing(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" /> Editar
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-destructive hover:bg-muted"
                    onClick={async () => {
                      setMenu(false);
                      if (!window.confirm("¿Borrar este comentario?")) return;
                      const res = await deleteTeamComment({ entityType, id: item.id });
                      if (!res.ok) toast.error(res.error);
                      await onChanged();
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Borrar
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        {editing ? (
          <CommentComposer
            candidates={candidates}
            viewerId={viewerId}
            initial={item.body}
            initialPicked={candidates.filter((c) => mentionNames.includes(c.name))}
            submitLabel="Guardar"
            onError={onError}
            onCancel={() => setEditing(false)}
            onSend={async (body, mentions) => {
              const res = await editTeamComment({ entityType, id: item.id, body, mentions });
              if (!res.ok) {
                toast.error(res.error);
                return false;
              }
              setEditing(false);
              await onChanged();
              return true;
            }}
          />
        ) : (
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground">
            {bodySegments(item.body, mentionNames).map((s, i) =>
              s.mention ? (
                <span key={i} className="font-medium text-primary-ink">
                  {s.text}
                </span>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )}
          </p>
        )}
      </div>
    </div>
  );
}

function CommentComposer({
  candidates,
  viewerId,
  initial = "",
  initialPicked = [],
  submitLabel = "Comentar",
  onSend,
  onCancel,
  onError,
}: {
  candidates: MentionCandidate[];
  viewerId: string | null;
  initial?: string;
  initialPicked?: MentionCandidate[];
  submitLabel?: string;
  onSend: (body: string, mentions: string[]) => Promise<boolean>;
  onCancel?: () => void;
  onError: (message: string) => void;
}) {
  const toast = { error: onError };
  const [text, setText] = useState(initial);
  const [picked, setPicked] = useState<MentionCandidate[]>(initialPicked);
  const [cursor, setCursor] = useState(initial.length);
  const [highlight, setHighlight] = useState(0);
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const active = activeMentionQuery(text, cursor);
  const options = active ? filterCandidates(candidates, active.query, viewerId) : [];

  const choose = (c: MentionCandidate) => {
    if (!active) return;
    const next = insertMention(text, active.start, cursor, c);
    setText(next.text);
    setPicked((p) => (p.some((x) => x.id === c.id) ? p : [...p, c]));
    setCursor(next.cursor);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(next.cursor, next.cursor);
    });
  };

  const submit = async () => {
    const problem = commentBodyProblem(text);
    if (problem) {
      toast.error(problem);
      return;
    }
    setSending(true);
    const ok = await onSend(text.trim(), mentionsInBody(text, picked, viewerId));
    setSending(false);
    if (ok && !onCancel) {
      setText("");
      setPicked([]);
      setCursor(0);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (options.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (h + 1) % options.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (h - 1 + options.length) % options.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        choose(options[Math.min(highlight, options.length - 1)]);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
    if (e.key === "Escape" && onCancel) onCancel();
  };

  return (
    <div className="relative">
      <label htmlFor={`comment-${viewerId ?? "x"}`} className="sr-only">
        Escribir un comentario
      </label>
      <AutoTextarea
        id={`comment-${viewerId ?? "x"}`}
        ref={ref}
        minRows={2}
        maxHeight={240}
        value={text}
        placeholder="Escribí un comentario. Usá @ para mencionar."
        onChange={(e) => {
          setText(e.target.value);
          setCursor(e.target.selectionStart ?? e.target.value.length);
          setHighlight(0);
        }}
        onSelect={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={onKeyDown}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      {options.length > 0 && (
        <ul role="listbox" aria-label="Personas para mencionar" className="absolute bottom-full left-0 z-30 mb-1 w-64 rounded-md border border-border bg-popover p-1 shadow-md">
          {options.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === highlight}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(c);
                }}
                className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm", i === highlight ? "bg-muted" : "hover:bg-muted")}
              >
                <Avatar initials={initialsOf(c.name)} color={colorOf(c.id)} userId={c.id} size="sm" />
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex items-center justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="h-8 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted max-topbar:h-10">
            Cancelar
          </button>
        )}
        <button
          type="button"
          disabled={sending || text.trim().length === 0}
          onClick={() => void submit()}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50 max-topbar:h-10"
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
