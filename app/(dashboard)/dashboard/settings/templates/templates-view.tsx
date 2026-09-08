"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import {
  createTemplate,
  updateTemplate,
  deleteTemplate,
  type TemplateInput,
} from "@/lib/actions/templates";
import {
  TEMPLATE_VARIABLES,
  PREVIEW_CONTEXT,
  interpolateTemplate,
} from "@/lib/templates/interpolate";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ActionError, EmptyHint, formatRelative } from "@/components/contacts/ui";

/**
 * Pantalla de templates (F17).
 *
 * El formulario muestra una vista previa con datos de ejemplo mientras se
 * escribe. No es adorno: las variables son el unico pedazo del template que no
 * se ve como va a quedar, y son justo lo que se rompe en silencio.
 */

export interface TemplateRow {
  id: string;
  name: string;
  content: string;
  shortcut: string | null;
  author: string;
  updatedAt: string;
}

export function TemplatesView({
  templates,
  canManage,
  workspaceName,
}: {
  templates: TemplateRow[];
  canManage: boolean;
  workspaceName: string;
}) {
  const [editing, setEditing] = useState<TemplateRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<TemplateRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function confirmDelete() {
    if (!deleting) return;
    const target = deleting;
    start(async () => {
      const result = await deleteTemplate(target.id);
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
            <h1 className="text-xl font-semibold">Respuestas rápidas</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Textos que el equipo reutiliza en la bandeja. Se insertan escribiendo{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">/</code> en el campo de respuesta.
            </p>
          </div>

          {canManage && (
            <button
              onClick={() => { setError(null); setEditing("new"); }}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Plus className="h-4 w-4" />
              Nuevo template
            </button>
          )}
        </div>

        {error && <div className="mt-4"><ActionError message={error} /></div>}
      </div>

      <div className="flex-1">
        {templates.length === 0 ? (
          <div className="px-8 py-12">
            <EmptyHint>
              Todavía no hay respuestas rápidas.{" "}
              {canManage
                ? "Creá la primera con lo que más repetís: el precio, el horario de atención, cómo sigue el proceso."
                : "Cuando un Owner o Admin cree la primera, la vas a poder usar desde la bandeja."}
            </EmptyHint>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                <th className="px-8 py-3 text-xs font-medium uppercase text-muted-foreground">Nombre</th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Atajo</th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Texto</th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Creado por</th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Editado</th>
                {canManage && <th className="w-24 px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <tr key={template.id} className="border-b border-border">
                  <td className="px-8 py-3 text-sm font-medium">{template.name}</td>
                  <td className="px-4 py-3">
                    {template.shortcut ? (
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{template.shortcut}</code>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="max-w-md px-4 py-3">
                    <span className="block truncate text-sm text-muted-foreground">
                      {template.content}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{template.author}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {formatRelative(template.updatedAt)}
                  </td>
                  {canManage && (
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button
                          onClick={() => { setError(null); setEditing(template); }}
                          aria-label={`Editar ${template.name}`}
                          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleting(template)}
                          aria-label={`Eliminar ${template.name}`}
                          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <TemplateDialog
          template={editing === "new" ? null : editing}
          workspaceName={workspaceName}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); router.refresh(); }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Eliminar template"
        message={
          deleting
            ? `Se elimina "${deleting.name}". Deja de aparecer en la bandeja.`
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

function TemplateDialog({
  template,
  workspaceName,
  onClose,
  onSaved,
}: {
  template: TemplateRow | null;
  workspaceName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<TemplateInput>({
    name: template?.name ?? "",
    content: template?.content ?? "",
    shortcut: template?.shortcut ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // La vista previa usa el nombre real del negocio y datos de ejemplo para el
  // contacto: es lo mas parecido a lo que va a leer el lead.
  const preview = interpolateTemplate(values.content, {
    ...PREVIEW_CONTEXT,
    workspace: { name: workspaceName },
  });

  function submit() {
    start(async () => {
      const result = template
        ? await updateTemplate(template.id, values)
        : await createTemplate(values);

      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved();
    });
  }

  function set(key: keyof TemplateInput, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setError(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg border border-border bg-background p-5 shadow-lg">
        <h2 className="text-base font-semibold">
          {template ? "Editar template" : "Nuevo template"}
        </h2>

        <div className="mt-4 grid gap-3 sm:grid-cols-[2fr_1fr]">
          <div>
            <label htmlFor="tpl-name" className="mb-1 block text-xs font-medium text-muted-foreground">
              Nombre
            </label>
            <input
              id="tpl-name"
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Precio del servicio"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label htmlFor="tpl-shortcut" className="mb-1 block text-xs font-medium text-muted-foreground">
              Atajo (opcional)
            </label>
            <input
              id="tpl-shortcut"
              value={values.shortcut ?? ""}
              onChange={(e) => set("shortcut", e.target.value)}
              placeholder="/precio"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        <div className="mt-3">
          <label htmlFor="tpl-content" className="mb-1 block text-xs font-medium text-muted-foreground">
            Texto
          </label>
          <textarea
            id="tpl-content"
            value={values.content}
            onChange={(e) => set("content", e.target.value)}
            rows={6}
            placeholder="Hola {{contact.display_name}}, gracias por escribir a {{workspace.name}}."
            className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs font-medium text-muted-foreground">Variables disponibles</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {TEMPLATE_VARIABLES.map((variable) => (
              <button
                key={variable.key}
                type="button"
                onClick={() => set("content", `${values.content}{{${variable.key}}}`)}
                title={`${variable.label} — clic para agregarla al final`}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs transition-colors hover:bg-accent"
              >
                {`{{${variable.key}}}`}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground/70">
            Si el contacto no tiene ese dato cargado, la variable queda vacía.
          </p>
        </div>

        {values.content.trim() && (
          <div className="mt-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Así se ve con datos de ejemplo
            </p>
            <p className="whitespace-pre-wrap rounded-lg border border-border bg-background px-3 py-2 text-sm">
              {preview}
            </p>
          </div>
        )}

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
            disabled={pending}
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
