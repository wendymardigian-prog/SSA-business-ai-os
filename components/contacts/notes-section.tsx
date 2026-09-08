"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { createNote, updateNote, deleteNote } from "@/lib/actions/contact-notes";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ActionError, EmptyHint, Section, formatDateTime } from "./ui";

/**
 * Notas del contacto (F13).
 *
 * Cualquier miembro que vea el contacto puede escribir; editar y borrar es del
 * autor o de un Owner/Admin. La regla la aplica la RLS: aca solo se esconden
 * los botones que esa persona no podria usar igual.
 */

export interface NoteItem {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  authorId: string | null;
  authorLabel: string;
}

export function NotesSection({
  contactId,
  notes,
  currentUserId,
  isAdmin,
}: {
  contactId: string;
  notes: NoteItem[];
  currentUserId: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function add() {
    if (!draft.trim()) return;
    start(async () => {
      const result = await createNote(contactId, draft);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDraft("");
      setError(null);
      router.refresh();
    });
  }

  function saveEdit(noteId: string) {
    start(async () => {
      const result = await updateNote(noteId, editingText);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditingId(null);
      setError(null);
      router.refresh();
    });
  }

  function remove(noteId: string) {
    start(async () => {
      const result = await deleteNote(noteId);
      setConfirmId(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      router.refresh();
    });
  }

  return (
    <Section title="Notas">
      <div className="mb-3">
        <textarea
          value={draft}
          rows={2}
          placeholder="Escribí una nota sobre este contacto…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Ctrl/Cmd + Enter guarda, igual que el campo de respuesta del inbox.
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              add();
            }
          }}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={add}
            disabled={pending || !draft.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Agregar nota
          </button>
          <span className="text-xs text-muted-foreground/70">Ctrl + Enter</span>
        </div>
      </div>

      <ActionError message={error} />

      {notes.length === 0 ? (
        <EmptyHint>
          Todavía no hay notas. Lo que anotes acá lo ve todo el equipo que
          trabaje este contacto.
        </EmptyHint>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => {
            const canEdit = isAdmin || note.authorId === currentUserId;
            const isEditing = editingId === note.id;

            return (
              <li key={note.id} className="rounded-lg border border-border p-3">
                {isEditing ? (
                  <>
                    <textarea
                      value={editingText}
                      rows={3}
                      onChange={(e) => setEditingText(e.target.value)}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => saveEdit(note.id)}
                        disabled={pending}
                        className="rounded-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
                      >
                        Guardar
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="rounded-lg border border-input px-3 py-1 text-xs font-medium hover:bg-accent"
                      >
                        Cancelar
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap text-sm">{note.content}</p>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">
                        {note.authorLabel} · {formatDateTime(note.createdAt)}
                        {note.updatedAt !== note.createdAt && " · editada"}
                      </p>
                      {canEdit && (
                        <div className="flex gap-1">
                          <button
                            onClick={() => {
                              setEditingId(note.id);
                              setEditingText(note.content);
                            }}
                            aria-label="Editar nota"
                            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setConfirmId(note.id)}
                            aria-label="Eliminar nota"
                            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={confirmId !== null}
        title="Eliminar nota"
        message="La nota deja de mostrarse. Se puede recuperar durante 30 dias."
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        destructive
        onConfirm={() => confirmId && remove(confirmId)}
        onCancel={() => setConfirmId(null)}
      />
    </Section>
  );
}
