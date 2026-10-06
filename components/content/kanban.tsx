"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Link2 as LinkIcon, Loader2, Plus, Sparkles } from "lucide-react";
import {
  approveIdea,
  movePostToColumn,
} from "@/lib/actions/content";
import { buildBoard, evaluateDrop, redistributionChip, type BoardCard, type BoardIdea, type BoardPost } from "@/lib/content/board";
import { contentExcerpt, ideaActions } from "@/lib/content/ideas";
import { STATUS_LABELS, type BoardColumn, type ContentPermissions } from "@/lib/content/status";
import { NetworkBadge } from "./network-badge";
import { IdeaDialog, NewPostDialog } from "./create-dialogs";
import { IdeaDetailDialog } from "./idea-detail-dialog";

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
  platforms,
}: {
  ideas: BoardIdea[];
  posts: BoardPost[];
  perms: Omit<ContentPermissions, "isAuthor"> & { ai: boolean };
  currentUserId: string;
  aiAvailable: boolean;
  /** Las redes conectadas, para el modal de crear. */
  platforms: string[];
  /** Los pilares ya usados, para sugerirlos. */
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  // Los modales viven acá y no en cada tarjeta: así el tablero no se
  // desmonta al abrirlos y volver no cuesta nada (C2, C3).
  const [dialog, setDialog] = useState<
    | { kind: "new-idea" }
    | { kind: "new-post"; ideaId?: string }
    | { kind: "idea"; id: string }
    | { kind: "edit-idea"; id: string }
    | null
  >(null);

  const selectedIdea = dialog && "id" in dialog ? ideas.find((i) => i.id === dialog.id) : null;

  const copywriter = {
    available: perms.ai && aiAvailable,
    reason: !perms.ai
      ? "Necesitás el permiso de generar copy con IA."
      : !aiAvailable
        ? "Conectá un proveedor de IA en Ajustes → Integraciones."
        : undefined,
  };

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
              {column.cards.length === 0 && (
                <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                  {emptyHint(column.column)}
                </p>
              )}
              {(
                column.cards.map((card) =>
                  card.kind === "idea" ? (
                    <IdeaCard
                      key={card.id}
                      idea={card}
                      canApprove={perms.approve}
                      canUseAi={perms.ai}
                      aiAvailable={aiAvailable}
                      pending={pending}
                      onOpen={() => setDialog({ kind: "idea", id: card.id })}
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

              {/* Crear donde se está mirando, y no arriba a la derecha (C4). */}
              {perms.create && column.column === "ideas" && (
                <AddCard label="+ Idea" onClick={() => setDialog({ kind: "new-idea" })} />
              )}
              {perms.create && column.column === "draft" && (
                <AddCard label="+ Post" onClick={() => setDialog({ kind: "new-post" })} />
              )}
            </div>
          </section>
        ))}
      </div>

      {dialog?.kind === "new-idea" && (
        <IdeaDialog
          canApprove={perms.approve}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "edit-idea" && selectedIdea && (
        <IdeaDialog
          canApprove={perms.approve}
          idea={{
            id: selectedIdea.id,
            title: selectedIdea.title,
            content: selectedIdea.content ?? "",
            format: selectedIdea.format ?? "",
            reference: selectedIdea.reference ?? "",
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "idea" && selectedIdea && (
        <IdeaDetailDialog
          idea={selectedIdea}
          canApprove={perms.approve}
          canUseAi={perms.ai}
          aiAvailable={aiAvailable}
          aiReason={copywriter.reason}
          onEdit={() => setDialog({ kind: "edit-idea", id: selectedIdea.id })}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "new-post" && (
        <NewPostDialog
          ideas={ideas.map((i) => ({ id: i.id, title: i.title }))}
          platforms={platforms}
          copywriter={copywriter}
          ideaId={dialog.ideaId}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

/** El botón al pie de una columna, donde termina lo que ya hay. */
function AddCard({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-dashed border-border py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {label}
    </button>
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

/**
 * La tarjeta de una idea (C13).
 *
 * Lo que se ve es lo que hace falta para decidir sin abrirla: el formato, el
 * comienzo del texto entre comillas —que es de lo que uno se acuerda— y quién
 * la propuso. El resto vive en el detalle.
 */
function IdeaCard({
  idea,
  canApprove,
  canUseAi,
  aiAvailable,
  pending,
  onOpen,
  onDone,
}: {
  idea: BoardIdea;
  canApprove: boolean;
  canUseAi: boolean;
  aiAvailable: boolean;
  pending: boolean;
  onOpen: () => void;
  onDone: (message: string | null) => void;
}) {
  const [busy, start] = useTransition();
  const actions = ideaActions(idea.status, { approve: canApprove, ai: canUseAi, aiAvailable });

  return (
    <article className="rounded-lg border border-border bg-card">
      <button type="button" onClick={onOpen} className="block w-full p-3 text-left hover:bg-accent/40">
        <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-0.5 font-medium uppercase tracking-wide">
            Idea
          </span>
          {idea.format && <span>{idea.format}</span>}
        </span>

        <span className="mt-1.5 block text-sm font-medium">{idea.title}</span>

        {contentExcerpt(idea.content) && (
          <span className="mt-1 block text-xs italic text-muted-foreground">
            “{contentExcerpt(idea.content)}”
          </span>
        )}

        <span className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {idea.authorName && <span>{idea.authorName}</span>}
          {idea.createdAt && <span>{cuando(idea.createdAt)}</span>}
          {idea.reference && (
            <span title={idea.reference} aria-label="Tiene una referencia">
              <LinkIcon className="h-3 w-3" aria-hidden />
            </span>
          )}
        </span>
      </button>

      {actions.length === 0 ? (
        <p className="px-3 pb-3 text-[11px] text-muted-foreground">
          Esperando aprobación de Owner o Admin
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5 px-3 pb-3">
          {actions.map((action) => (
            <button
              key={action.action}
              type="button"
              disabled={busy || pending || Boolean(action.disabledReason)}
              title={action.disabledReason}
              onClick={() =>
                start(async () => {
                  const result = await approveIdea(idea.id, {
                    produceCopy: action.action === "approve_and_generate",
                  });
                  onDone(
                    result.ok
                      ? result.data.copyError
                        ? `Aprobada, pero el copy no salió: ${result.data.copyError}`
                        : result.data.copyQueued
                          ? "Aprobada. El copywriter está escribiendo."
                          : null
                      : result.error,
                  );
                })
              }
              className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs disabled:opacity-50 ${
                action.action === "approve_and_generate"
                  ? "bg-primary text-primary-foreground"
                  : "border border-border hover:bg-accent"
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

/** "hace 2 h", "3 oct". Lo que sirve para ubicarse sin leer una fecha. */
function cuando(iso: string): string {
  const date = new Date(iso);
  const minutos = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutos < 60) return `hace ${Math.max(1, minutos)} min`;
  if (minutos < 60 * 24) return `hace ${Math.round(minutos / 60)} h`;
  return date.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}

/**
 * La tarjeta de una pieza (C13).
 *
 * El bloque de color con el formato es lo que deja reconocerla de un
 * vistazo en una columna de diez. Los chips dicen qué le falta: sin eso hay
 * que abrir cada una para saber cuál está lista para grabar.
 *
 * Un borrador o algo en producción abre el EDITOR, que es lo que se va a
 * hacer. Lo demás abre el detalle, que es para mirar.
 */
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
  const editable = post.status === "draft" || post.status === "in_production";
  const href = editable ? `/dashboard/content/${post.id}/edit` : `/dashboard/content/${post.id}`;
  const color = post.networks[0] ? NETWORK_TINT[post.networks[0].platform] : null;

  return (
    <article
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`overflow-hidden rounded-lg border border-border bg-card ${dragging ? "opacity-50" : ""}`}
    >
      <Link href={href} className="block hover:bg-accent/40">
        {post.format && (
          <span
            className="flex h-9 items-center px-3 text-[11px] font-medium uppercase tracking-wide text-white/90"
            style={{ background: color ?? "var(--muted-foreground)" }}
          >
            {post.format}
          </span>
        )}

        <span className="block p-3">
          <span className="block text-sm font-medium">{post.title}</span>

          {post.copyStatus === "generating" && (
            <span className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              El copywriter está escribiendo…
            </span>
          )}

          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {post.networks.length === 0 ? (
              <span className="text-[11px] text-muted-foreground">Sin redes</span>
            ) : (
              post.networks.map((n) => (
                <NetworkBadge
                  key={n.platform}
                  platform={n.platform}
                  size="sm"
                  detail={
                    n.at
                      ? new Date(n.at).toLocaleDateString("es-AR", { day: "numeric", month: "short" })
                      : null
                  }
                />
              ))
            )}
            {(post.status === "failed" || post.status === "partially_published") && (
              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                {STATUS_LABELS[post.status]}
              </span>
            )}
            {chip && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{chip}</span>}
          </span>

          {editable && post.copyStatus !== "generating" && (
            <span className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
              <Chip on={post.hasCopy}>
                {post.hasCopy ? "✓" : "○"} Copy{post.hasCopy && post.copyFromAi ? " ✦" : ""}
              </Chip>
              <Chip on={post.hasCaption}>{post.hasCaption ? "✓" : "○"} Caption</Chip>
              {post.status === "in_production" && (
                <Chip on>🎬 {MATERIAL_LABELS[post.materialStatus] ?? post.materialStatus}</Chip>
              )}
            </span>
          )}

          <span className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {post.authorName && <span>{post.authorName}</span>}
            {post.createdAt && <span>{cuando(post.createdAt)}</span>}
          </span>
        </span>
      </Link>
    </article>
  );
}

function Chip({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span className={on ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
      {children}
    </span>
  );
}

/** El color del bloque de formato. El mismo de la insignia de la red. */
const NETWORK_TINT: Record<string, string> = {
  instagram: "#E4405F",
  tiktok: "#111827",
  youtube: "#FF0000",
  linkedin: "#0A66C2",
  threads: "#111827",
  facebook: "#1877F2",
};

const MATERIAL_LABELS: Record<string, string> = {
  pendiente: "Sin grabar",
  grabado: "Grabado",
  editado: "Editado",
  listo: "Listo",
};

/**
 * Los botones de crear de la barra superior.
 *
 * Los del pie de cada columna son los que se usan cuando ya hay algo; estos
 * son para cuando el tablero está vacío, para el calendario y la lista, y en
 * el celular, donde las columnas quedan lejos.
 *
 * Tiene su propio estado de modal: así la barra no depende de que el kanban
 * esté montado (en la vista de lista no lo está).
 */
export function NewContentButtons({
  canCreate,
  ideas,
  platforms,
  copywriter,
  canApprove,
}: {
  canCreate: boolean;
  ideas: Array<{ id: string; title: string }>;
  platforms: string[];
  copywriter: { available: boolean; reason?: string };
  canApprove: boolean;
}) {
  const [dialog, setDialog] = useState<"idea" | "post" | null>(null);
  if (!canCreate) return null;

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setDialog("idea")}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-accent"
        >
          <Plus className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Nueva idea</span>
        </button>
        <button
          type="button"
          onClick={() => setDialog("post")}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground"
        >
          <Plus className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Nuevo post</span>
        </button>
      </div>

      {dialog === "idea" && (
        <IdeaDialog canApprove={canApprove} onClose={() => setDialog(null)} />
      )}
      {dialog === "post" && (
        <NewPostDialog
          ideas={ideas}
          platforms={platforms}
          copywriter={copywriter}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
