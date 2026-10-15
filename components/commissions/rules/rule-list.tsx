"use client";

import { useEffect, useId, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { Plus } from "lucide-react";
import { isShadowed, moveByKeyboard, reorder } from "@/lib/commissions/describe";
import { sameIdSet } from "@/lib/commissions/reorder";
import { applyDrop, createOrderSaver, isLowerHalf, moveAnnouncement, type OrderSaveResult } from "@/lib/commissions/rules-ui-order";
import { ruleMissingPerson } from "@/lib/commissions/rules-ui-warnings";
import type { RuleView } from "@/lib/commissions/rules-view";
import type { CommissionRole } from "@/lib/commissions/types";
import { RuleRow } from "./rule-row";
import { btnPrimary } from "./ui";

/**
 * La lista ordenada de las reglas de un rol (F57). Gana la primera que cumple, así que el orden importa y se
 * guarda apenas se cambia. Se reordena arrastrando (mouse), con Alt + ↑/↓ sobre la regla enfocada (teclado) o con
 * los botones de subir y bajar (pantallas táctiles). Si el guardado falla, la lista vuelve a su orden y se dice.
 *
 * El orden local es el que manda mientras las reglas sean las mismas; si el servidor trae otro conjunto (se creó,
 * se archivó o se duplicó una), se adopta su orden. Así un guardado en curso nunca se pisa con datos viejos.
 */
export function RuleList({
  role,
  rules,
  canManage,
  busy,
  onReorder,
  onSettled,
  onCreate,
  onEdit,
  onDuplicate,
  onToggle,
  onArchive,
}: {
  role: CommissionRole;
  rules: RuleView[];
  canManage: boolean;
  busy: boolean;
  onReorder: (ids: string[]) => Promise<OrderSaveResult>;
  /** Se guardó todo el orden pedido: el padre vuelve a pedir los datos. */
  onSettled: () => void;
  onCreate: () => void;
  onEdit: (view: RuleView) => void;
  onDuplicate: (view: RuleView) => void;
  onToggle: (view: RuleView) => void;
  onArchive: (view: RuleView) => void;
}) {
  const hintId = useId();
  const [ids, setIds] = useState(() => rules.map((r) => r.id));
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [error, setError] = useState<string | null>(null);

  const rows = useRef(new Map<string, HTMLLIElement>());
  const focusAfter = useRef<string | null>(null);

  const [saver] = useState(() => createOrderSaver(rules.map((r) => r.id)));
  useEffect(() => {
    saver.configure({
      save: onReorder,
      onFail: (committed, message) => {
        setIds(committed);
        setError(message);
        setAnnouncement("No se pudo guardar el orden: la lista volvió al orden anterior");
      },
      onIdle: onSettled,
    });
  });

  // Si cambió el conjunto de reglas (alta, archivo, copia), se adopta el orden del servidor.
  const serverIds = rules.map((r) => r.id);
  if (!sameIdSet(ids, serverIds)) setIds(serverIds);

  const byId = useMemo(() => new Map(rules.map((r) => [r.id, r])), [rules]);
  const ordered = useMemo(() => ids.map((id) => byId.get(id)).filter((v): v is RuleView => !!v), [ids, byId]);
  const shadowed = useMemo(() => ordered.map((view, i) => isShadowed(view.rule, ordered.slice(0, i).map((v) => v.rule))), [ordered]);

  // Después de mover una regla con el teclado, el foco la sigue.
  useEffect(() => {
    const id = focusAfter.current;
    if (!id) return;
    focusAfter.current = null;
    rows.current.get(id)?.focus();
  }, [ids]);

  function commit(next: string[], movedId: string) {
    if (next.join("|") === ids.join("|")) return;
    setIds(next);
    setError(null);
    setAnnouncement(moveAnnouncement(byId.get(movedId)?.name ?? "", next.indexOf(movedId) + 1, next.length));
    saver.request(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLLIElement>, id: string) {
    // Las flechas dentro de un botón o un campo no son para mover reglas.
    if (event.target !== event.currentTarget) return;
    const move = moveByKeyboard(ids, ids.indexOf(id), event);
    if (!move) return;
    event.preventDefault();
    if (move.moved) {
      focusAfter.current = id;
      commit(move.ids, id);
    } else {
      rows.current.get(ids[move.focusIndex])?.focus();
    }
  }

  function onDragOver(event: DragEvent<HTMLLIElement>, id: string) {
    if (!dragId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const after = isLowerHalf(event.clientY - rect.top, rect.height);
    setOver((current) => (current && current.id === id && current.after === after ? current : { id, after }));
  }

  function onDrop(event: DragEvent<HTMLLIElement>, id: string) {
    if (!dragId) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const after = isLowerHalf(event.clientY - rect.top, rect.height);
    const moved = dragId;
    setDragId(null);
    setOver(null);
    commit(applyDrop(ids, moved, id, after), moved);
  }

  if (ordered.length === 0) {
    return (
      <div className="rounded-xl border border-border p-8 text-center text-sm">
        <p className="font-medium">Sin reglas de {role.name}: nadie cobra comisión como {role.name}</p>
        <p className="mx-auto mt-1 max-w-md text-muted-foreground">
          {canManage ? "Creá la primera regla para que este rol empiece a generar comisiones cuando se cobre un pago." : "Todavía no se armó ninguna regla para este rol."}
        </p>
        {canManage && (
          <button type="button" onClick={onCreate} className={`${btnPrimary} mt-4`}>
            <Plus className="h-4 w-4" aria-hidden /> Crear regla
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p id={hintId} className="text-xs text-muted-foreground">
        Gana la primera regla de la lista que cumple las condiciones del cobro.
        {canManage && " Para cambiar el orden arrastrá una regla, o enfocala y usá Alt + flecha arriba o abajo."}
      </p>
      {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</p>}

      <ol aria-label={`Reglas de ${role.name}, de la primera a la última`} className="space-y-2">
        {ordered.map((view, index) => (
          <RuleRow
            key={view.id}
            view={view}
            index={index}
            total={ordered.length}
            shadowed={shadowed[index]}
            missingPerson={ruleMissingPerson(role, view.rule)}
            canManage={canManage}
            busy={busy}
            dragging={dragId === view.id}
            dropMark={over && over.id === view.id && dragId && dragId !== view.id ? (over.after ? "after" : "before") : null}
            hintId={hintId}
            registerRow={(el) => {
              if (el) rows.current.set(view.id, el);
              else rows.current.delete(view.id);
            }}
            onEdit={() => onEdit(view)}
            onDuplicate={() => onDuplicate(view)}
            onToggle={() => onToggle(view)}
            onArchive={() => onArchive(view)}
            onMove={(delta) => commit(reorder(ids, index, index + delta), view.id)}
            onKeyDown={(event) => onKeyDown(event, view.id)}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", view.id);
              const row = rows.current.get(view.id);
              if (row) event.dataTransfer.setDragImage(row, 16, 16);
              setDragId(view.id);
            }}
            onDragEnd={() => {
              setDragId(null);
              setOver(null);
            }}
            onDragOver={(event) => onDragOver(event, view.id)}
            onDrop={(event) => onDrop(event, view.id)}
          />
        ))}
      </ol>

      <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
    </div>
  );
}
