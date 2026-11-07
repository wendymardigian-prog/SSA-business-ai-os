"use client";

/**
 * El Kanban de contactos: una columna por estado de setter o de vendedor.
 *
 * Se arrastra con HTML nativo, como los tableros de Agenda y
 * Contenido: tarjetas simples, sin librería. El movimiento se valida ANTES de
 * pedirlo al servidor (`evaluateContactDrop`): una tarjeta que se mueve y
 * vuelve sola, sin explicación, parece un error. La tarjeta cambia de columna
 * en el momento; si el servidor dice que no, vuelve y se muestra el motivo.
 *
 * El arrastre nunca es el único camino: cada tarjeta tiene "Mover a…" (un
 * `<select>`, que anda con el teclado y en el celular, donde no se arrastra).
 */

import { useViewerTimezone } from "@/components/dashboard-chrome";
import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DoNotContactBadge, TemperatureBadge, formatRelative } from "@/components/contacts/ui";
import { MarkBadge } from "@/components/contacts/mark-badge";
import { setContactStatus } from "@/lib/actions/contact-status";
import { loadContactsKanbanColumn } from "@/lib/actions/contacts-kanban";
import { appendCards, columnOf, evaluateContactDrop, moveCard, type KanbanCard, type KanbanColumn } from "@/lib/contacts/kanban";
import { NONE } from "@/lib/contacts/list-query";
import { interestLabel, type InterestCatalog } from "@/lib/contacts/interest";
import { STATUS_ROLE_LABELS, type StatusRole } from "@/lib/contacts/statuses";

export function ContactsKanban({
  columns: fromServer,
  role,
  canEdit,
  memberLabel,
  interestCatalog,
}: {
  columns: KanbanColumn[];
  role: StatusRole;
  canEdit: boolean;
  memberLabel: Map<string, string>;
  interestCatalog: InterestCatalog;
}) {
  const searchParams = useSearchParams();
  // Lo que viene del servidor manda: cuando cambia (otro filtro, o la página se
  // vuelve a pedir después de mover), el tablero arranca de nuevo con eso.
  const [columns, setColumns] = useState(fromServer);
  const [seen, setSeen] = useState(fromServer);
  if (fromServer !== seen) {
    setSeen(fromServer);
    setColumns(fromServer);
  }
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(fromServer.filter((c) => c.archived).map((c) => c.key)));
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  const targets = columns.filter((c) => !c.archived);

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function move(cardId: string, toKey: string) {
    const from = columnOf(columns, cardId);
    const target = columns.find((c) => c.key === toKey);
    if (!from || !target) return;
    const verdict = evaluateContactDrop(from, target, canEdit);
    if (verdict.kind === "noop") return;
    if (verdict.kind === "blocked") {
      setProblem(verdict.reason);
      return;
    }
    setProblem(null);
    setColumns((current) => moveCard(current, cardId, toKey));
    const result = await setContactStatus(cardId, role, toKey === NONE ? null : toKey);
    if (!result.ok) {
      setColumns((current) => moveCard(current, cardId, from));
      setProblem(`No se pudo mover: ${result.error}.`);
    }
  }

  async function loadMore(column: KanbanColumn) {
    setLoadingKey(column.key);
    const result = await loadContactsKanbanColumn(searchParams.toString(), column.key, column.cards.length);
    setLoadingKey(null);
    if (!result.ok) {
      setProblem(result.error);
      return;
    }
    setColumns((current) => appendCards(current, column.key, result.cards));
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-4 py-4 md:px-8">
      {problem && (
        <p role="alert" className="flex items-start justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          <span>{problem}</span>
          <button type="button" onClick={() => setProblem(null)} className="text-xs underline">
            Cerrar
          </button>
        </p>
      )}

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
        {columns.map((column) => {
          const dot = (
            <span
              aria-hidden
              className={cn("h-2 w-2 shrink-0 rounded-full", !column.color && "border border-muted-foreground/50")}
              style={column.color ? { backgroundColor: column.color } : undefined}
            />
          );
          if (collapsed.has(column.key)) {
            return (
              <button
                key={column.key}
                type="button"
                onClick={() => toggle(column.key)}
                title={`Mostrar ${column.name}`}
                className="flex w-11 shrink-0 flex-col items-center gap-2 rounded-xl border border-border bg-muted/40 py-3 text-xs text-muted-foreground hover:bg-muted"
              >
                {dot}
                <span className="whitespace-nowrap [writing-mode:vertical-rl]">{column.name}</span>
                <span className="tabular-nums">{column.total}</span>
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            );
          }
          const droppable = canEdit && !column.archived;
          return (
            <section
              key={column.key}
              aria-label={`${column.name}: ${column.total} ${column.total === 1 ? "contacto" : "contactos"}`}
              onDragOver={(e) => {
                if (!dragging || !droppable) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (over !== column.key) setOver(column.key);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = dragging;
                setDragging(null);
                setOver(null);
                if (id) void move(id, column.key);
              }}
              className={cn(
                "flex max-h-full w-72 shrink-0 flex-col rounded-xl border bg-muted/40 transition-colors",
                over === column.key ? "border-primary-edge bg-primary/5" : "border-border",
              )}
            >
              <h3 className="flex items-center justify-between gap-2 px-3 pb-1.5 pt-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <span className="flex min-w-0 items-center gap-1.5">
                  {dot}
                  <span className="truncate">{column.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="tabular-nums">{column.total}</span>
                  <button type="button" onClick={() => toggle(column.key)} aria-label={`Contraer ${column.name}`} className="rounded p-0.5 hover:bg-muted">
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                </span>
              </h3>

              <div className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto px-2.5 pb-2.5">
                {column.cards.length === 0 && <p className="px-1 py-4 text-center text-xs text-muted-foreground">Sin contactos</p>}
                {column.cards.map((card) => (
                  <ContactKanbanCard
                    key={card.id}
                    card={card}
                    role={role}
                    columnKey={column.key}
                    targets={targets}
                    canEdit={canEdit}
                    memberLabel={memberLabel}
                    interestCatalog={interestCatalog}
                    dragging={dragging === card.id}
                    onDragStart={() => setDragging(card.id)}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    onMove={(to) => void move(card.id, to)}
                  />
                ))}
                {column.cards.length < column.total && (
                  <button
                    type="button"
                    onClick={() => void loadMore(column)}
                    disabled={loadingKey === column.key}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 text-xs text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-60"
                  >
                    {loadingKey === column.key && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                    Cargar más ({column.total - column.cards.length})
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        {canEdit
          ? `Arrastrá una tarjeta (o usá «Mover a…») para cambiar el estado de ${STATUS_ROLE_LABELS[role].toLowerCase()}. Queda en el historial del contacto.`
          : "Para mover contactos entre estados hace falta el permiso de editar contactos."}
      </p>
    </div>
  );
}

function ContactKanbanCard({
  card,
  role,
  columnKey,
  targets,
  canEdit,
  memberLabel,
  interestCatalog,
  dragging,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  card: KanbanCard;
  role: StatusRole;
  columnKey: string;
  targets: KanbanColumn[];
  canEdit: boolean;
  memberLabel: Map<string, string>;
  interestCatalog: InterestCatalog;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (to: string) => void;
}) {
  const timeZone = useViewerTimezone();
  const name = card.displayName ?? "Sin nombre";
  const setter = card.setterId ? memberLabel.get(card.setterId) : null;
  const vendedor = card.vendedorId ? memberLabel.get(card.vendedorId) : null;
  const product = card.interestProductId ? interestLabel(interestCatalog, card.interestProductId, card.interestVariantId) : null;

  return (
    <article
      draggable={canEdit}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", card.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "group flex flex-col gap-1.5 rounded-lg border border-border bg-card p-2.5 text-sm shadow-sm transition-opacity hover:border-ring",
        canEdit && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-50",
      )}
    >
      <Link href={`/dashboard/contacts/${card.id}`} className="flex flex-wrap items-center gap-1.5 font-medium hover:underline" draggable={false}>
        <span className="min-w-0 truncate">{name}</span>
        <TemperatureBadge value={card.temperature} />
        {card.doNotContact && <DoNotContactBadge />}
        {card.isCustomer && <MarkBadge mark="customer" size="xs" />}
        {card.isKnown && <MarkBadge mark="known" size="xs" />}
      </Link>
      {(card.email || card.phone) && <span className="truncate text-xs text-muted-foreground">{card.email ?? card.phone}</span>}
      {product && <span className="truncate text-xs text-muted-foreground">Interés: {product}</span>}
      {(setter || vendedor) && (
        <span className="truncate text-xs text-muted-foreground">
          {[setter && `Setter: ${setter}`, vendedor && `Vendedor: ${vendedor}`].filter(Boolean).join(" · ")}
        </span>
      )}
      <span className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground/80">{formatRelative(card.lastInteractionAt, timeZone)}</span>
        {canEdit && targets.length > 1 && (
          <label className="opacity-100 transition-opacity focus-within:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">
            <span className="sr-only">Mover a {name} a otro estado de {STATUS_ROLE_LABELS[role].toLowerCase()}</span>
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) onMove(e.target.value);
              }}
              className="max-w-32 rounded-md border border-input bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground"
            >
              <option value="">Mover a…</option>
              {targets
                .filter((t) => t.key !== columnKey)
                .map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
        )}
      </span>
    </article>
  );
}
