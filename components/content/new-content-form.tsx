"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createIdea, createPost } from "@/lib/actions/content";

/**
 * El formulario de "nueva idea" y "nueva pieza".
 *
 * Una idea pide lo minimo para no perderla (titulo) y ofrece lo que ayuda a
 * retomarla despues. Una pieza pide titulo y, si hay redes conectadas, en
 * cuales va: elegirlas ahora ahorra volver al editor solo para eso.
 */
export function NewContentForm({
  kind,
  ideas,
  platforms,
}: {
  kind: "idea" | "post";
  ideas: Array<{ id: string; title: string }>;
  platforms: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState({
    title: "",
    hook: "",
    angle: "",
    format: "",
    pillar: "",
    reference: "",
    notes: "",
    ideaId: "",
  });
  const [selected, setSelected] = useState<string[]>([]);

  const set = (key: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    start(async () => {
      const result =
        kind === "idea"
          ? await createIdea(values)
          : await createPost({
              title: values.title,
              format: values.format || null,
              ideaId: values.ideaId || null,
              platforms: selected,
            });

      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/dashboard/content");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-xl space-y-4">
      <Field label="Titulo" hint={kind === "idea" ? "Con una frase alcanza." : undefined}>
        <input
          required
          autoFocus
          value={values.title}
          onChange={set("title")}
          className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm"
        />
      </Field>

      <Field label="Formato" hint="Reel, carrusel, video, texto…">
        <input
          value={values.format}
          onChange={set("format")}
          className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm"
        />
      </Field>

      {kind === "idea" ? (
        <>
          <Field label="Hook" hint="La frase con la que arranca.">
            <input
              value={values.hook}
              onChange={set("hook")}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm"
            />
          </Field>
          <Field label="Angulo" hint="Desde donde se cuenta.">
            <input
              value={values.angle}
              onChange={set("angle")}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm"
            />
          </Field>
          <Field label="Pilar">
            <input
              value={values.pillar}
              onChange={set("pillar")}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm"
            />
          </Field>
          <Field label="Referencia" hint="Un link o de donde salio.">
            <input
              value={values.reference}
              onChange={set("reference")}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm"
            />
          </Field>
          <Field label="Notas">
            <textarea
              rows={3}
              value={values.notes}
              onChange={set("notes")}
              className="w-full rounded-lg border border-border bg-background p-3 text-sm"
            />
          </Field>
        </>
      ) : (
        <>
          {ideas.length > 0 && (
            <Field label="Idea de origen" hint="Opcional: para saber de donde salio.">
              <select
                value={values.ideaId}
                onChange={set("ideaId")}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm"
              >
                <option value="">Sin idea</option>
                {ideas.map((idea) => (
                  <option key={idea.id} value={idea.id}>
                    {idea.title}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <fieldset>
            <legend className="text-xs font-medium">Redes</legend>
            {platforms.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Todavia no hay redes conectadas. Podes crear la pieza igual y elegirlas despues.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {platforms.map((platform) => {
                  const on = selected.includes(platform);
                  return (
                    <button
                      key={platform}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setSelected((s) =>
                          on ? s.filter((p) => p !== platform) : [...s, platform],
                        )
                      }
                      className={`h-8 rounded-lg border px-3 text-sm ${
                        on ? "border-primary bg-primary/10" : "border-border hover:bg-accent"
                      }`}
                    >
                      {platform}
                    </button>
                  );
                })}
              </div>
            )}
          </fieldset>
        </>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {pending ? "Guardando..." : kind === "idea" ? "Guardar idea" : "Crear pieza"}
      </button>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}
