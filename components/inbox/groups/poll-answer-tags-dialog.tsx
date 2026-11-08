"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2 } from "lucide-react";
import { ContentDialog } from "@/components/content/dialog";
import { createPollAnswerAutomations, loadPollAnswerFieldOptions } from "@/lib/actions/whatsapp-group-inbox";
import { MAX_TAG_LENGTH, NOTHING_TO_DO, pollAnswerActionsProblem, pollCategory } from "@/lib/whatsapp-groups/automation/poll-answer-actions";

const inputClass =
  "w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring";

/**
 * «Etiquetar según la respuesta», desde la encuesta en la bandeja: para cada respuesta, la etiqueta que se le pone al
 * contacto que la elige (arranca con el mismo texto; vacía = esa respuesta no etiqueta) y, si se quiere, un campo de
 * texto donde guardar lo que respondió. Crea y publica las automatizaciones sin pasar por el lienzo.
 */
export function PollAnswerTagsDialog({
  messageId,
  pollName,
  options,
  onClose,
}: {
  messageId: string;
  pollName: string;
  options: string[];
  onClose: () => void;
}) {
  const [tags, setTags] = useState<Record<string, string>>(() => Object.fromEntries(options.map((o) => [o, o.slice(0, MAX_TAG_LENGTH)])));
  const [fields, setFields] = useState<Array<{ slug: string; name: string }> | null>(null);
  const [fieldSlug, setFieldSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ created: number; published: number; draftReason: string | null } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    loadPollAnswerFieldOptions()
      .then((result) => {
        if (alive) setFields(result.ok ? result.fields : []);
      })
      .catch(() => {
        if (alive) setFields([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const field = fields?.find((f) => f.slug === fieldSlug) ?? null;
  const problem = pollAnswerActionsProblem({ options, tags, field });

  function create() {
    setError(null);
    start(async () => {
      const result = await createPollAnswerAutomations({ messageId, tags, fieldSlug: fieldSlug || null });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone({ created: result.created, published: result.published, draftReason: result.draftReason });
    });
  }

  const listHref = `/dashboard/flows?categoria=${encodeURIComponent(pollCategory(pollName))}`;

  if (done) {
    return (
      <ContentDialog
        title="Listo"
        label="Etiquetar según la respuesta"
        onClose={onClose}
        footer={
          <div className="ml-auto flex gap-2">
            <Link href={listHref} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
              Ver las automatizaciones
            </Link>
            <button type="button" onClick={onClose} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
              Cerrar
            </button>
          </div>
        }
      >
        <p className="flex items-start gap-2 text-sm">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
          <span>
            {done.published === done.created
              ? `${done.created === 1 ? "Quedó activa 1 automatización" : `Quedaron activas ${done.created} automatizaciones`}: desde ahora, cada voto etiqueta al contacto.`
              : `Creé ${done.created === 1 ? "1 automatización" : `${done.created} automatizaciones`}, ${done.published === 0 ? "pero quedaron en borrador" : `${done.published} activas y el resto en borrador`}.`}
          </span>
        </p>
        {done.draftReason && <p className="text-xs text-amber-700 dark:text-amber-400">{done.draftReason}</p>}
        <p className="text-xs text-muted-foreground">Las encontrás en Automatizaciones, en la categoría «{pollCategory(pollName)}». Ahí se pueden cambiar o apagar.</p>
      </ContentDialog>
    );
  }

  return (
    <ContentDialog
      title="Etiquetar según la respuesta"
      label="Etiquetar según la respuesta"
      onClose={onClose}
      footer={
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
            Cancelar
          </button>
          <button
            type="button"
            onClick={create}
            disabled={pending || problem !== null}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Crear y activar
          </button>
        </div>
      }
    >
      <p className="line-clamp-2 text-xs text-muted-foreground">📊 {pollName}</p>
      <p className="text-sm">Cuando alguien vote, el contacto recibe la etiqueta de la respuesta que eligió. Dejá vacía la que no quieras etiquetar.</p>

      <div className="space-y-2">
        {options.map((option, i) => (
          <div key={option}>
            <label htmlFor={`poll-tag-${i}`} className="mb-1 block text-xs font-medium text-foreground">
              Si responde «{option}», ponerle la etiqueta:
            </label>
            <input
              id={`poll-tag-${i}`}
              type="text"
              maxLength={MAX_TAG_LENGTH}
              value={tags[option] ?? ""}
              onChange={(e) => setTags((t) => ({ ...t, [option]: e.target.value }))}
              placeholder="Sin etiqueta"
              className={inputClass}
            />
          </div>
        ))}
      </div>

      <div>
        <label htmlFor="poll-field" className="mb-1 block text-xs font-medium text-foreground">
          Guardar también la respuesta en un campo (opcional)
        </label>
        {fields === null ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Cargando campos…
          </p>
        ) : fields.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No hay campos de texto.{" "}
            <Link href="/dashboard/settings/custom-fields" className="text-primary-ink underline">
              Crear uno
            </Link>
          </p>
        ) : (
          <select id="poll-field" value={fieldSlug} onChange={(e) => setFieldSlug(e.target.value)} className={inputClass}>
            <option value="">No guardar</option>
            {fields.map((f) => (
              <option key={f.slug} value={f.slug}>
                {f.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Cuenta para quien ya es contacto (o si el grupo guarda contactos) y solo en encuestas que salieron de tu número. Si alguien cambia su voto, recibe
        la etiqueta nueva y conserva la anterior.
      </p>
      {problem && problem !== NOTHING_TO_DO && <p className="text-xs text-red-600 dark:text-red-400">{problem}</p>}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </ContentDialog>
  );
}
