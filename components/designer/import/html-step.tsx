"use client";

/**
 * Paso «Archivo» del modal Nuevo (F39–F41): subir el .html o .zip, ver lo detectado y corregirlo.
 *
 * Las reglas (qué se acepta, qué opciones se ofrecen, qué se avisa) son funciones puras de
 * `lib/designer/screens/html-step.ts`; acá solo se componen. El archivo se lee y se limpia en el
 * servidor (`inspectHtmlUpload`): el navegador nunca interpreta lo que sube la persona.
 *
 * Le avisa al modal con `onChange({ uploadId, as })` cuando hay un archivo leído y una opción válida
 * (o `null` mientras no). El botón «Cargar» lo pone el modal y llama a `importHtml`.
 */

import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { FileCode2, Loader2 } from "lucide-react";
import { inspectHtmlUpload } from "@/lib/actions/designer/import";
import type { HtmlImportKind, HtmlInspection, HtmlStepProps } from "@/lib/designer/contracts";
import { assetsText, checkPickedFile, choiceProblem, DROP_HINT, DROP_TITLE, formatOptions, helpText, initialChoice, loadAsText, removedNotice, stepValue } from "@/lib/designer/screens/html-step";

type Phase = { name: "idle" } | { name: "reading"; fileName: string } | { name: "error"; message: string } | { name: "ready"; inspection: HtmlInspection };

export function HtmlStep({ kind, onChange }: HtmlStepProps) {
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [picked, setPicked] = useState<HtmlImportKind | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const inputId = useId();
  const groupId = useId();

  const inspection = phase.name === "ready" ? phase.inspection : null;
  // Una plantilla no puede ser una página web: aunque la opción guardada sea otra, acá siempre es presentación.
  const choice: HtmlImportKind | null = inspection ? (kind === "template" ? "slides" : (picked ?? initialChoice(kind, inspection))) : null;

  // El modal puede pasar una función nueva en cada render: se guarda en una referencia y no vuelve a disparar el efecto.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  useEffect(() => {
    onChangeRef.current(stepValue(inspection, choice));
  }, [inspection, choice]);

  async function read(file: File) {
    const check = checkPickedFile(file);
    const request = ++requestRef.current;
    setPicked(null);
    if (!check.ok) {
      setPhase({ name: "error", message: check.error });
      return;
    }
    setPhase({ name: "reading", fileName: file.name });
    const form = new FormData();
    form.set("file", file);
    try {
      const result = await inspectHtmlUpload(form);
      if (request !== requestRef.current) return;
      setPhase(result.ok ? { name: "ready", inspection: result.data } : { name: "error", message: result.error });
    } catch {
      if (request !== requestRef.current) return;
      setPhase({ name: "error", message: "No se pudo leer el archivo. Probá de nuevo." });
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void read(file);
  }

  const reading = phase.name === "reading";
  const title = phase.name === "reading" ? phase.fileName : inspection ? inspection.fileName : DROP_TITLE;
  const problem = inspection && choice ? choiceProblem(choice, inspection) : null;
  const note = inspection && choice ? loadAsText(choice, inspection) : null;
  const removed = inspection ? removedNotice(inspection) : null;

  return (
    <div className="space-y-3">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${dragging ? "border-primary-edge bg-muted" : "border-border bg-card"}`}
      >
        {reading ? <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden /> : <FileCode2 className="h-8 w-8 text-muted-foreground" aria-hidden />}
        <b className="max-w-full break-words text-sm">{title}</b>
        <span className="text-xs text-muted-foreground">{reading ? "Leyendo y limpiando el archivo… un zip grande puede tardar un poco." : DROP_HINT}</span>
        <label htmlFor={inputId} className="sr-only">
          Elegir un archivo .html o .zip
        </label>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept=".html,.htm,.zip,text/html,application/zip"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void read(file);
          }}
        />
        <button
          type="button"
          disabled={reading}
          onClick={() => inputRef.current?.click()}
          className="h-8 rounded-lg border border-border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-60"
        >
          {inspection ? "Cambiar archivo" : "Elegir archivo"}
        </button>
      </div>

      <div aria-live="polite">
        {phase.name === "error" ? (
          <p role="alert" className="rounded-lg border border-border bg-card p-3 text-sm text-bad">
            {phase.message}
          </p>
        ) : null}
      </div>

      {inspection && choice ? (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-good">Archivo leído</span>
            <span className="text-muted-foreground">El formato sale del archivo: no hace falta elegirlo.</span>
          </div>

          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-muted-foreground">Detectamos</span>
            <b className="min-w-0 break-words text-right">{inspection.detected.label}</b>
          </div>

          <div className="space-y-2">
            <p id={groupId} className="text-muted-foreground">
              ¿Es correcto?
            </p>
            <div role="group" aria-labelledby={groupId} className="flex flex-wrap gap-2">
              {formatOptions(kind).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={choice === option.key}
                  onClick={() => setPicked(option.key)}
                  className={`min-h-8 rounded-lg border px-3 py-1.5 text-left text-xs font-medium ${choice === option.key ? "border-primary-edge bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
            {problem ? (
              <p role="alert" className="text-xs text-bad">
                {problem}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-muted-foreground">Imágenes y fuentes</span>
            <span className="min-w-0 break-words text-right">{assetsText(inspection.assets)}</span>
          </div>

          {removed ? <p className="rounded-lg bg-muted p-2.5 text-xs text-warn">{removed}</p> : null}

          <p className="rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">{helpText(kind)}</p>
        </div>
      ) : null}
    </div>
  );
}
