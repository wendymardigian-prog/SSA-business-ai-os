"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { addField, relabelField, removeField, moveField, setFieldKey, updateField } from "@/lib/forms/builder";
import { changeFieldType, dropTargetIndex, duplicateField, moveFieldTo } from "@/lib/forms/builder-ops";
import { selectionAfterRemove, type BuilderSelection } from "@/lib/forms/builder-selection";
import { MAX_FIELDS, type FormField, type FormFieldType } from "@/lib/forms/fields";
import type { CardActions } from "./question-card";

/**
 * Las acciones del constructor sobre la lista de preguntas (plano formularios-ui, F9-F11): las comparten el lienzo
 * de un formulario y el de un reporte de fin de dia. Solo compone las funciones puras de `lib/forms/builder*.ts`.
 *
 * Las acciones que reciben las tarjetas son SIEMPRE las mismas (leen lo ultimo desde refs): asi una tarjeta que no
 * cambio no se vuelve a dibujar cuando se escribe en otra.
 */
export function useBuilderActions({
  fields,
  selection,
  neverPublished,
  onFields,
  onSelect,
  adder = addField,
}: {
  fields: FormField[];
  selection: BuilderSelection;
  neverPublished: boolean;
  onFields: (next: FormField[]) => void;
  onSelect: (selection: BuilderSelection) => void;
  /** Un reporte de fin de dia agrega con sus propios valores (`addEodField`). */
  adder?: (fields: FormField[], type: FormFieldType) => FormField[];
}) {
  const latest = useRef({ fields, selection, neverPublished, onFields, onSelect, adder });
  useEffect(() => {
    latest.current = { fields, selection, neverPublished, onFields, onSelect, adder };
  });

  const dragging = useRef<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; position: "before" | "after" } | null>(null);
  const dropRef = useRef(dropAt);
  useEffect(() => {
    dropRef.current = dropAt;
  });

  const actions = useMemo<CardActions>(() => {
    const indexOf = (id: string) => latest.current.fields.findIndex((f) => f.id === id);
    const positionOf = (event: DragEvent<HTMLElement>): "before" | "after" => {
      const rect = event.currentTarget.getBoundingClientRect();
      return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    };
    return {
      select: (id) => latest.current.onSelect({ kind: "field", id }),
      relabel: (id, label) => {
        const { fields: list, neverPublished: fresh, onFields: write } = latest.current;
        const i = indexOf(id);
        if (i >= 0) write(relabelField(list, i, label, fresh));
      },
      move: (id, delta) => {
        const { fields: list, onFields: write } = latest.current;
        const i = indexOf(id);
        if (i >= 0) write(moveField(list, i, delta));
      },
      duplicate: (id) => {
        const { fields: list, onFields: write, onSelect: choose } = latest.current;
        const i = indexOf(id);
        const result = i >= 0 ? duplicateField(list, i) : null;
        if (!result) return;
        write(result.fields);
        choose({ kind: "field", id: result.fields[result.index].id });
      },
      remove: (id) => {
        const { fields: list, selection: current, onFields: write, onSelect: choose } = latest.current;
        const i = indexOf(id);
        if (i < 0) return;
        const next = removeField(list, i);
        write(next);
        if (current.kind === "field" && current.id === id) choose(selectionAfterRemove(next, i));
      },
      dragStart: (id, event) => {
        dragging.current = id;
        event.dataTransfer.effectAllowed = "move";
        // Firefox no arranca un arrastre sin un dato.
        event.dataTransfer.setData("text/plain", id);
        const card = event.currentTarget.closest("li");
        if (card) event.dataTransfer.setDragImage(card, 16, 16);
      },
      dragOver: (id, event) => {
        if (!dragging.current) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (id === dragging.current) {
          if (dropRef.current) setDropAt(null);
          return;
        }
        const position = positionOf(event);
        if (dropRef.current?.id !== id || dropRef.current.position !== position) setDropAt({ id, position });
      },
      drop: (id, event) => {
        const from = dragging.current;
        if (!from) return;
        event.preventDefault();
        const { fields: list, onFields: write } = latest.current;
        const fromIndex = indexOf(from);
        const overIndex = indexOf(id);
        dragging.current = null;
        setDropAt(null);
        if (fromIndex < 0 || overIndex < 0 || from === id) return;
        write(moveFieldTo(list, fromIndex, dropTargetIndex(fromIndex, overIndex, positionOf(event))));
      },
      dragEnd: () => {
        dragging.current = null;
        setDropAt(null);
      },
    };
  }, []);

  return {
    actions,
    dropAt,
    canAdd: fields.length < MAX_FIELDS,
    /** Agrega al final y deja la pregunta nueva elegida. */
    add(type: FormFieldType) {
      const { fields: list, onFields: write, onSelect: choose, adder: make } = latest.current;
      const next = make(list, type);
      if (next === list || next.length === list.length) return;
      write(next);
      choose({ kind: "field", id: next[next.length - 1].id });
    },
    patch(id: string, patch: Partial<FormField>) {
      const { fields: list, onFields: write } = latest.current;
      const i = list.findIndex((f) => f.id === id);
      if (i >= 0) write(updateField(list, i, patch));
    },
    changeType(id: string, type: FormFieldType) {
      const { fields: list, onFields: write } = latest.current;
      const i = list.findIndex((f) => f.id === id);
      if (i >= 0) write(changeFieldType(list, i, type));
    },
    /** Devuelve el error (clave repetida o invalida) o undefined. */
    setKey(id: string, key: string): string | undefined {
      const { fields: list, onFields: write } = latest.current;
      const i = list.findIndex((f) => f.id === id);
      if (i < 0) return undefined;
      const result = setFieldKey(list, i, key);
      if (!result.error) write(result.fields);
      return result.error;
    },
  };
}
