"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Link2 as LinkIcon, Loader2, Plus, Users } from "lucide-react";
import { movePostToColumn } from "@/lib/actions/content";
import { drawerHref } from "@/lib/content/drawer-url";
import {
  attributionTooltip,
  buildBoard,
  evaluateDrop,
  redistributionChip,
  type BoardCard,
  type BoardIdea,
  type BoardPost,
} from "@/lib/content/board";
import { contentExcerpt } from "@/lib/content/ideas";
import { STATUS_LABELS, type BoardColumn, type ContentPermissions } from "@/lib/content/status";
import { NetworkBadge, NetworkBadges } from "./network-badge";
import { IdeaDialog, NewPostDialog } from "./create-dialogs";
import type { TaxonomyOptions } from "./classification-fields";
import { PillarDot } from "./pillar-tag";

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
  taxonomy,
}: {
  ideas: BoardIdea[];
  posts: BoardPost[];
  perms: Omit<ContentPermissions, "isAuthor"> & { ai: boolean };
  currentUserId: string;
  aiAvailable: boolean;
  /** Las redes conectadas, para el modal de crear. */
  platforms: string[];
  /** Pilares y ofertas, para clasificar una idea (F91). */
  taxonomy: TaxonomyOptions;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  // Los modales viven acá y no en cada tarjeta: así el tablero no se
  // desmonta al abrirlos y volver no cuesta nada (C2, C3).
  const [dialog, setDialog] = useState<{ kind: "new-idea" } | { kind: "new-post"; ideaId?: string } | null>(null);

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
        router.push(drawerHref(new URLSearchParams(params.toString()), { kind: "piece", id }), { scroll: false });
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
                    <IdeaCard key={card.id} idea={card} href={drawerHref(new URLSearchParams(params.toString()), { kind: "idea", id: card.id })} />
                  ) : (
                    <PostCard
                      key={card.id}
                      post={card}
                      href={drawerHref(new URLSearchParams(params.toString()), { kind: "piece", id: card.id })}
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
          platforms={platforms}
          taxonomy={taxonomy}
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
 * La tarjeta de una idea (C13, F98).
 *
 * Solo abre: aprobar y descartar se hacen en el drawer (F95), donde se ve la
 * idea entera. La tarjeta muestra lo que hace falta para ubicarla: el formato,
 * las redes a las que apunta, el pilar, el comienzo del texto entre comillas
 * —que es de lo que uno se acuerda—, la oferta y quien la escribio.
 */
function IdeaCard({ idea, href }: { idea: BoardIdea; href: string }) {
  const excerpt = contentExcerpt(idea.content);

  return (
    <article className="rounded-lg border border-border bg-card">
      <Link href={href} scroll={false} data-card-id={`idea-${idea.id}`} className="block p-3 hover:bg-accent/40">
        <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-0.5 font-medium uppercase tracking-wide">Idea</span>
          {idea.format && <span>{idea.format}</span>}
          {idea.platforms.length > 0 && <NetworkBadges platforms={idea.platforms} />}
          {idea.pillar && <PillarDot tag={idea.pillar} className="ml-0" />}
        </span>

        <span className="mt-1.5 block text-sm font-medium">{idea.title}</span>

        {excerpt && <span className="mt-1 block text-xs italic text-muted-foreground">“{excerpt}”</span>}

        {idea.offer && (
          <span className="mt-1.5 inline-block rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground" title="Producto">
            {idea.offer.name}
          </span>
        )}

        <span className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          {idea.authorship && <span>{idea.authorship}</span>}
          {idea.reference && (
            <span title={idea.reference} aria-label="Tiene una referencia">
              <LinkIcon className="h-3 w-3" aria-hidden />
            </span>
          )}
        </span>
      </Link>
    </article>
  );
}

/** "hace 2 h", "3 oct". Lo que sirve para ubicarse sin leer una fecha. */
/**
 * La tarjeta de una pieza (C13).
 *
 * El bloque de color con el formato es lo que deja reconocerla de un
 * vistazo en una columna de diez. Los chips dicen qué le falta: sin eso hay
 * que abrir cada una para saber cuál está lista para grabar.
 *
 * Abre el drawer de la pieza (F96): el mismo para un borrador que para algo
 * ya publicado.
 */
function PostCard({
  post,
  href,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  post: BoardPost;
  href: string;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const chip = redistributionChip(post.networks);
  const editable = post.status === "draft" || post.status === "in_production";
  const color = post.networks[0] ? NETWORK_TINT[post.networks[0].platform] : null;

  return (
    <article
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`overflow-hidden rounded-lg border border-border bg-card ${dragging ? "opacity-50" : ""}`}
    >
      <Link href={href} scroll={false} data-card-id={`piece-${post.id}`} className="block hover:bg-accent/40">
        {post.format && (
          <span
            className="flex h-9 items-center px-3 text-[11px] font-medium uppercase tracking-wide text-white/90"
            style={{ background: color ?? "var(--muted-foreground)" }}
          >
            {post.format}
          </span>
        )}

        <span className="block p-3">
          <span className="block text-sm font-medium">
            {post.title}
            {post.pillar && <PillarDot tag={post.pillar} />}
          </span>

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
                  className={NETWORK_STATE_TINT[n.status ?? ""]}
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
                {post.hasCopy ? "✓" : "○"} Guion{post.hasCopy && post.copyFromAi ? " ✦" : ""}
              </Chip>
              <Chip on={post.hasCaption}>{post.hasCaption ? "✓" : "○"} Caption</Chip>
            </span>
          )}

          <span className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            {post.authorship && <span>{post.authorship}</span>}
            {post.attributedContacts !== null && (
              <span
                className="inline-flex items-center gap-0.5 tabular-nums"
                title={attributionTooltip(post.attributedContacts)}
                data-testid="attributed-contacts"
              >
                <Users className="h-3 w-3" aria-hidden />
                {post.attributedContacts}
              </span>
            )}
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

/**
 * Las redes resaltadas en la tarjeta del kanban (Contenido v4, C8): lo que
 * esta en la cola se ve distinto de lo que todavia es solo una fecha.
 */
const NETWORK_STATE_TINT: Record<string, string> = {
  scheduled: "border-blue-500 bg-blue-500/10",
  uploading: "border-blue-500 bg-blue-500/10",
  publishing: "border-blue-500 bg-blue-500/10",
  published: "border-emerald-500 bg-emerald-500/10",
  failed: "border-red-500 bg-red-500/10",
};

/** El color del bloque de formato. El mismo de la insignia de la red. */
const NETWORK_TINT: Record<string, string> = {
  instagram: "#E4405F",
  tiktok: "#111827",
  youtube: "#FF0000",
  linkedin: "#0A66C2",
  threads: "#111827",
  facebook: "#1877F2",
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
  taxonomy,
  copywriter,
  canApprove,
}: {
  canCreate: boolean;
  ideas: Array<{ id: string; title: string }>;
  platforms: string[];
  taxonomy: TaxonomyOptions;
  copywriter: { available: boolean; reason?: string };
  canApprove: boolean;
}) {
  const [dialog, setDialog] = useState<"idea" | "post" | null>(null);
  if (!canCreate) return null;

  return (
    <>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setDialog("idea")}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 text-sm font-medium hover:bg-accent"
        >
          <Plus className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Nueva idea</span>
        </button>
        <button
          type="button"
          onClick={() => setDialog("post")}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground"
        >
          <Plus className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Nuevo post</span>
        </button>
      </div>

      {dialog === "idea" && (
        <IdeaDialog canApprove={canApprove} platforms={platforms} taxonomy={taxonomy} onClose={() => setDialog(null)} />
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
