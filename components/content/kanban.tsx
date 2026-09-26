"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Sparkles } from "lucide-react";
import {
  approveIdea,
  discardIdea,
  movePostToColumn,
} from "@/lib/actions/content";
import { buildBoard, evaluateDrop, redistributionChip, type BoardCard, type BoardIdea, type BoardPost } from "@/lib/content/board";
import { ideaActions } from "@/lib/content/ideas";
import { STATUS_LABELS, type BoardColumn, type ContentPermissions } from "@/lib/content/status";

/**
 * El kanban de contenido (F20).
 *
 * Arrastrar con HTML nativo y no con una libreria: son siete columnas y
 * tarjetas simples, y sumar una dependencia de arrastre para esto seria pagar
 * peso y bugs de teclado a cambio de nada.
 *
 * El movimiento se valida ANTES de pedirlo al servidor (`evaluateDrop`, que es
 * la misma funcion que usa la accion). Si no se puede, la tarjeta no se mueve
 * y se muestra el motivo: una tarjeta que se mueve y vuelve sola, sin
 * explicacion, parece un error del sistema.
 */
export function ContentKanban({
  ideas,
  posts,
  perms,
  currentUserId,
  aiAvailable,
}: {
  ideas: BoardIdea[];
  posts: BoardPost[];
  perms: Omit<ContentPermissions, "isAuthor"> & { ai: boolean };
  currentUserId: string;
  aiAvailable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  // El tablero se mueve al soltar, sin esperar al servidor: con la respuesta
  // de por medio, la tarjeta se queda quieta medio segundo y parece que el
  // arrastre no funciono.
  const [optimistic, applyOptimistic] = useOptimistic(
    posts,
    (current: BoardPost[], change: { id: string; status: BoardPost["status"] }) =>
      current.map((p) => (p.id === change.id ? { ...p, status: change.status } : p)),
  );

  const board = useMemo(() => buildBoard(ideas, optimistic), [ideas, optimistic]);

  function permsFor(card: BoardPost): ContentPermissions {
    return { ...perms, isAuthor: card.createdBy === currentUserId };
  }

  function onDrop(target: BoardColumn) {
    const id = dragging;
    setDragging(null);
    if (!id) return;

    const card = optimistic.find((p) => p.id === id);
    if (!card) return;

    const decision = evaluateDrop({ perms: permsFor(card), post: card, target });

    if (!decision.ok) {
      setMessage({ tone: "error", text: decision.reason });
      if ("openEditor" in decision && decision.openEditor) {
        router.push(`/dashboard/content/${id}/edit`);
      }
      return;
    }

    setMessage(null);
    startTransition(async () => {
      applyOptimistic({ id, status: decision.status });
      const result = await movePostToColumn(id, target);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
      }
      router.refresh();
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {message && (
        <p
          role="alert"
          className={`mx-4 mt-3 rounded-lg p-2 text-xs md:mx-6 ${
            message.tone === "error"
              ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4 md:p-6">
        {board.map((column) => (
          <section
            key={column.column}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(column.column)}
            className="flex w-72 flex-shrink-0 flex-col rounded-xl bg-muted/40"
            aria-label={column.label}
          >
            <header className="flex items-center justify-between px-3 py-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {column.label}
              </h2>
              <span className="text-xs text-muted-foreground">{column.count}</span>
            </header>

            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
              {column.cards.length === 0 ? (
                <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                  {emptyHint(column.column)}
                </p>
              ) : (
                column.cards.map((card) =>
                  card.kind === "idea" ? (
                    <IdeaCard
                      key={card.id}
                      idea={card}
                      canApprove={perms.approve}
                      canUseAi={perms.ai}
                      aiAvailable={aiAvailable}
                      pending={pending}
                      onDone={(text) => {
                        setMessage(text ? { tone: "info", text } : null);
                        router.refresh();
                      }}
                    />
                  ) : (
                    <PostCard
                      key={card.id}
                      post={card}
                      dragging={dragging === card.id}
                      onDragStart={() => setDragging(card.id)}
                      onDragEnd={() => setDragging(null)}
                    />
                  ),
                )
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function emptyHint(column: BoardColumn): string {
  switch (column) {
    case "ideas":
      return "Anota una idea apenas se te ocurre, aunque sea una frase.";
    case "draft":
      return "Nada en borrador.";
    case "published":
      return "Todavia no publicaste nada desde aca.";
    default:
      return "Vacio.";
  }
}

function IdeaCard({
  idea,
  canApprove,
  canUseAi,
  aiAvailable,
  pending,
  onDone,
}: {
  idea: BoardIdea;
  canApprove: boolean;
  canUseAi: boolean;
  aiAvailable: boolean;
  pending: boolean;
  onDone: (message: string | null) => void;
}) {
  const [busy, start] = useTransition();
  const actions = ideaActions(idea.status, { approve: canApprove, ai: canUseAi, aiAvailable });

  return (
    <article className="rounded-lg border border-border bg-card p-3">
      <h3 className="text-sm font-medium">{idea.title}</h3>
      {idea.format && <p className="mt-0.5 text-xs text-muted-foreground">{idea.format}</p>}

      {actions.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Esperando aprobacion</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {actions.map((action) => (
            <button
              key={action.action}
              type="button"
              disabled={busy || pending || Boolean(action.disabledReason)}
              title={action.disabledReason}
              onClick={() =>
                start(async () => {
                  const result =
                    action.action === "discard"
                      ? await discardIdea(idea.id)
                      : await approveIdea(idea.id);
                  onDone(result.ok ? null : result.error);
                })
              }
              className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs disabled:opacity-50 ${
                action.action === "discard"
                  ? "text-muted-foreground hover:bg-accent"
                  : "bg-primary text-primary-foreground"
              }`}
            >
              {action.action === "approve_and_generate" && <Sparkles className="h-3 w-3" aria-hidden />}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

function PostCard({
  post,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  post: BoardPost;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const chip = redistributionChip(post.networks);

  return (
    <article
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`rounded-lg border border-border bg-card p-3 ${dragging ? "opacity-50" : ""}`}
    >
      <Link href={`/dashboard/content/${post.id}`} className="text-sm font-medium hover:underline">
        {post.title}
      </Link>

      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {post.format && <span>{post.format}</span>}
        {post.networks.map((n) => (
          <span key={n.platform} className="rounded bg-muted px-1.5 py-0.5">
            {n.platform}
            {n.at ? ` · ${new Date(n.at).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}` : ""}
          </span>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        {(post.status === "draft" || post.status === "in_production") && (
          <>
            <span className={post.hasCopy ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
              {post.copyFromAi && "✦ "}
              {post.hasCopy ? "con guion" : "sin guion"}
            </span>
            <span className={post.hasCaption ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
              {post.hasCaption ? "con caption" : "sin caption"}
            </span>
            <span className="text-muted-foreground">material: {post.materialStatus}</span>
          </>
        )}
        {(post.status === "failed" || post.status === "partially_published") && (
          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
            {STATUS_LABELS[post.status]}
          </span>
        )}
        {chip && <span className="rounded bg-muted px-1.5 py-0.5">{chip}</span>}
      </div>
    </article>
  );
}

/** El boton de crear, para la barra superior. */
export function NewContentButtons({ canCreate }: { canCreate: boolean }) {
  if (!canCreate) return null;
  return (
    <div className="flex items-center gap-2">
      <Link
        href="/dashboard/content/new?tipo=idea"
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-accent"
      >
        <Plus className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">Nueva idea</span>
      </Link>
      <Link
        href="/dashboard/content/new"
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground"
      >
        <Plus className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">Nuevo post</span>
      </Link>
    </div>
  );
}
