"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import {
  createCustomField,
  updateCustomField,
  deleteCustomField,
} from "@/lib/actions/custom-fields";
import {
  CUSTOM_FIELD_TYPES,
  CUSTOM_FIELD_TYPE_LABELS,
} from "@/lib/custom-fields";
import type { CustomFieldType } from "@/lib/types/database";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ActionError, EmptyHint } from "@/components/contacts/ui";

export interface FieldRow {
  id: string;
  name: string;
  slug: string;
  type: CustomFieldType;
  /** Cuantos contactos tienen un valor cargado en este campo. */
  usedBy: number;
}

export function CustomFieldsView({ fields }: { fields: FieldRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<FieldRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<FieldRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  function confirmDelete() {
    if (!deleting) return;
    const target = deleting;
    start(async () => {
      const result = await deleteCustomField(target.id);
      setDeleting(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="border-b border-border px-8 py-6">
        <Link
          href="/dashboard/settings"
          className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Configuración
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Campos personalizados</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Datos propios de tu negocio que no vienen con el sistema. Se completan
              en la ficha de cada contacto, y los flows pueden leerlos y escribirlos.
            </p>
          </div>

          <button
            onClick={() => { setError(null); setEditing("new"); }}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Nuevo campo
          </button>
        </div>

        {error && <div className="mt-4 max-w-2xl"><ActionError message={error} /></div>}
      </div>

      <div className="flex-1">
        {fields.length === 0 ? (
          <div className="px-8 py-12">
            <EmptyHint>
              Todavía no hay campos personalizados. Creá el primero con algo que tu
              negocio necesite saber de cada contacto y el sistema no traiga: el
              presupuesto que pidió, de dónde vino, qué plan tiene.
            </EmptyHint>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                <th className="px-8 py-3 text-xs font-medium uppercase text-muted-foreground">Nombre</th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Tipo</th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Identificador</th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">En uso</th>
                <th className="w-24 px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => (
                <tr key={field.id} className="border-b border-border">
                  <td className="px-8 py-3 text-sm font-medium">{field.name}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {CUSTOM_FIELD_TYPE_LABELS[field.type]}
                  </td>
                  <td className="px-4 py-3">
                    <code
                      className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                      title="Con este nombre lo referencian los flows. No cambia si renombrás el campo."
                    >
                      {field.slug}
                    </code>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {field.usedBy === 0
                      ? "—"
                      : `${field.usedBy} ${field.usedBy === 1 ? "contacto" : "contactos"}`}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button
                        onClick={() => { setError(null); setEditing(field); }}
                        aria-label={`Editar ${field.name}`}
                        className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleting(field)}
                        aria-label={`Eliminar ${field.name}`}
                        className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <FieldDialog
          field={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); router.refresh(); }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Eliminar campo personalizado"
        message={
          deleting
            ? deleting.usedBy > 0
              ? `"${deleting.name}" tiene un valor cargado en ${deleting.usedBy} contacto(s). El campo deja de aparecer en las fichas, pero los valores se conservan por si hace falta volver atrás.`
              : `"${deleting.name}" deja de aparecer en las fichas de contacto.`
            : ""
        }
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function FieldDialog({
  field,
  onClose,
  onSaved,
}: {
  field: FieldRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(field?.name ?? "");
  const [type, setType] = useState<CustomFieldType>(field?.type ?? "text");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // El tipo no se puede cambiar si ya hay valores: se guardan como texto y
  // pasar de texto a numero dejaria datos que el input nuevo blanquea.
  const typeLocked = Boolean(field && field.usedBy > 0);

  function submit() {
    start(async () => {
      const result = field
        ? await updateCustomField(field.id, name, type)
        : await createCustomField(name, type);

      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg">
        <h2 className="text-base font-semibold">
          {field ? "Editar campo" : "Nuevo campo personalizado"}
        </h2>

        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor="cf-name" className="mb-1 block text-xs font-medium text-muted-foreground">
              Nombre
            </label>
            <input
              id="cf-name"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(null); }}
              placeholder="Presupuesto pedido"
              maxLength={60}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label htmlFor="cf-type" className="mb-1 block text-xs font-medium text-muted-foreground">
              Tipo
            </label>
            <select
              id="cf-type"
              value={type}
              disabled={typeLocked}
              onChange={(e) => { setType(e.target.value as CustomFieldType); setError(null); }}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
            >
              {CUSTOM_FIELD_TYPES.map((t) => (
                <option key={t} value={t}>{CUSTOM_FIELD_TYPE_LABELS[t]}</option>
              ))}
            </select>
            {typeLocked && (
              <p className="mt-1 text-xs text-muted-foreground/70">
                No se puede cambiar: ya hay {field?.usedBy} contacto(s) con un valor cargado.
              </p>
            )}
          </div>

          {field && (
            <p className="text-xs text-muted-foreground/70">
              El identificador <code className="rounded bg-muted px-1">{field.slug}</code> no
              cambia al renombrar, porque es con el que los flows encuentran el campo.
            </p>
          )}
        </div>

        {error && <div className="mt-3"><ActionError message={error} /></div>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={pending}
            className="rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={pending || !name.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
