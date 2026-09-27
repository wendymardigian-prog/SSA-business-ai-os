"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { createIdea, createPost, updateIdea } from "@/lib/actions/content";
import { FORMAT_SUGGESTIONS } from "@/lib/content/ideas";
import { ContentDialog, DialogField, fieldInput } from "./dialog";
import { NetworkBadge } from "./network-badge";

/**
 * Crear una idea o un post, encima del tablero (C2).
 *
 * Antes eran una pagina aparte: se perdia el tablero de vista y volver
 * costaba dos clics. Y "Crear" devolvia al kanban, asi que para escribir
 * habia que buscar la pieza y entrar. Ahora "Crear y abrir" lleva al editor,
 * que es lo que se iba a hacer igual.
 */

export interface CreateDialogsProps {
  /** Las ideas sin decidir, para vincular un post a una. */
  ideas: Array<{ id: string; title: string }>;
  /** Las redes conectadas del negocio. */
  platforms: string[];
  /** Los pilares que ya se usaron, para sugerirlos. */
  pillars: string[];
  /** Si el copywriter puede escribir al crear. */
  copywriter: { available: boolean; reason?: string };
}

function FormatField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <DialogField label="Formato">
      <>
        <input
          list="formatos-de-contenido"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Reel"
          className={fieldInput}
        />
        <datalist id="formatos-de-contenido">
          {FORMAT_SUGGESTIONS.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </>
    </DialogField>
  );
}

// ── Nueva idea ────────────────────────────────────────────────────────────

const EMPTY_IDEA = {
  title: "",
  hook: "",
  angle: "",
  format: "",
  pillar: "",
  reference: "",
  notes: "",
};

export function IdeaDialog({
  pillars,
  /** Con idea, edita; sin idea, crea. */
  idea,
  canApprove,
  onClose,
}: {
  pillars: string[];
  idea?: (typeof EMPTY_IDEA & { id: string }) | null;
  canApprove: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState(idea ?? EMPTY_IDEA);

  const set = (key: keyof typeof EMPTY_IDEA) => (v: string) =>
    setValues((prev) => ({ ...prev, [key]: v }));

  function save() {
    setError(null);
    start(async () => {
      const result = idea ? await updateIdea(idea.id, values) : await createIdea(values);
      if (!result.ok) return setError(result.error);
      onClose();
      router.refresh();
    });
  }

  return (
    <ContentDialog
      label={idea ? "Editar idea" : "Nueva idea"}
      title={idea ? "Editar idea" : "Nueva idea"}
      onClose={onClose}
      footer={
        <>
          <span className="text-[11px] text-muted-foreground">
            {canApprove ? "Queda en la columna Ideas." : "Queda esperando aprobación."}
          </span>
          <span className="flex-1" />
          {error && (
            <span role="alert" className="text-xs text-red-700 dark:text-red-400">
              {error}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending || !values.title.trim()}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {idea ? "Guardar" : "Guardar idea"}
          </button>
        </>
      }
    >
      <DialogField label="Título *" hint="Con una frase alcanza.">
        <input
          value={values.title}
          onChange={(e) => set("title")(e.target.value)}
          maxLength={200}
          className={fieldInput}
        />
      </DialogField>

      <DialogField label="Hook" hint="La frase con la que arranca.">
        <input value={values.hook} onChange={(e) => set("hook")(e.target.value)} className={fieldInput} />
      </DialogField>

      <DialogField label="Ángulo" hint="Desde dónde se cuenta.">
        <textarea
          rows={2}
          value={values.angle}
          onChange={(e) => set("angle")(e.target.value)}
          className={fieldInput}
        />
      </DialogField>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormatField value={values.format} onChange={set("format")} />
        <DialogField label="Pilar">
          <>
            <input
              list="pilares-de-contenido"
              value={values.pillar}
              onChange={(e) => set("pillar")(e.target.value)}
              className={fieldInput}
            />
            <datalist id="pilares-de-contenido">
              {pillars.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </>
        </DialogField>
      </div>

      <DialogField label="Referencia" hint="Un link o de dónde salió.">
        <input
          value={values.reference}
          onChange={(e) => set("reference")(e.target.value)}
          placeholder="https://…"
          className={fieldInput}
        />
      </DialogField>

      <DialogField label="Notas">
        <textarea
          rows={2}
          value={values.notes}
          onChange={(e) => set("notes")(e.target.value)}
          className={fieldInput}
        />
      </DialogField>
    </ContentDialog>
  );
}

// ── Nuevo post ────────────────────────────────────────────────────────────

export function NewPostDialog({
  ideas,
  platforms,
  copywriter,
  /** La idea de la que sale, si viene de aprobar una. */
  ideaId,
  onClose,
}: {
  ideas: CreateDialogsProps["ideas"];
  platforms: string[];
  copywriter: CreateDialogsProps["copywriter"];
  ideaId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState("");
  const [origin, setOrigin] = useState(ideaId ?? "");
  const [selected, setSelected] = useState<string[]>(platforms.slice(0, 1));
  const [withAi, setWithAi] = useState(false);

  function create() {
    setError(null);
    start(async () => {
      const result = await createPost({
        title,
        format: format || null,
        ideaId: origin || null,
        platforms: selected,
      });

      if (!result.ok) return setError(result.error);

      // "Crear y abrir": lleva al editor, que es donde se iba a ir igual.
      // Si se pidio el copy, el editor ya lo muestra escribiendo.
      if (withAi && copywriter.available) {
        const { requestCopy } = await import("@/lib/actions/copywriter");
        await requestCopy({ postId: result.data.id, confirmed: true });
      }

      onClose();
      router.push(`/dashboard/content/${result.data.id}/edit`);
      router.refresh();
    });
  }

  return (
    <ContentDialog
      label="Nuevo post"
      title="Nuevo post"
      onClose={onClose}
      footer={
        <>
          <span className="flex-1" />
          {error && (
            <span role="alert" className="text-xs text-red-700 dark:text-red-400">
              {error}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={create}
            disabled={pending || !title.trim()}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Crear y abrir
          </button>
        </>
      }
    >
      <DialogField label="Título interno *" hint="Cómo lo vas a reconocer en el tablero.">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          className={fieldInput}
        />
      </DialogField>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormatField value={format} onChange={setFormat} />
        <DialogField label="Idea de origen" hint="Opcional.">
          <select
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            className={fieldInput}
          >
            <option value="">Ninguna</option>
            {ideas.map((idea) => (
              <option key={idea.id} value={idea.id}>
                {idea.title}
              </option>
            ))}
          </select>
        </DialogField>
      </div>

      <DialogField label="Redes" hint="Se pueden cambiar después, en el editor.">
        {platforms.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Todavía no hay ninguna red conectada. La pieza se crea igual.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {platforms.map((platform) => {
              const on = selected.includes(platform);
              return (
                <button
                  key={platform}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setSelected(on ? selected.filter((p) => p !== platform) : [...selected, platform])
                  }
                  className={
                    on
                      ? "rounded-full ring-2 ring-primary"
                      : "rounded-full opacity-60 hover:opacity-100"
                  }
                >
                  <NetworkBadge platform={platform} />
                </button>
              );
            })}
          </div>
        )}
      </DialogField>

      <label className="flex items-start gap-2.5 rounded-lg border border-border p-3">
        <input
          type="checkbox"
          checked={withAi && copywriter.available}
          disabled={!copywriter.available}
          onChange={(e) => setWithAi(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span className="text-sm">
          <span className="flex items-center gap-1">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Generar guion y caption con IA al crear
          </span>
          <span className="block text-xs text-muted-foreground">
            {copywriter.available
              ? "El copywriter escribe mientras abrís el editor."
              : (copywriter.reason ?? "No está disponible.")}
          </span>
        </span>
      </label>
    </ContentDialog>
  );
}
