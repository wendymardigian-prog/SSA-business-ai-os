"use client";

/**
 * Modal «Automatizar» de una plantilla (Diseñador IA, F60): explica qué hace, crea el borrador de automatización
 * (Formulario enviado → Generar desde plantilla → Enviar email con el link y el PDF) y abre el lienzo. Si ya hay
 * automatizaciones que la usan, las lista con su link. La lógica vive en `lib/actions/designer/automate.ts`.
 */

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Mail, Sparkles, X, Zap } from "lucide-react";
import { automationsUsingTemplate, createAutomationFromTemplate } from "@/lib/actions/designer/automate";
import type { AutomateModalProps } from "@/lib/designer/contracts";

type UsingFlow = { id: string; name: string; href: string; status: string };

const STATUS_LABELS: Record<string, string> = { draft: "Borrador", published: "Publicada", paused: "Pausada", archived: "Archivada" };

export function AutomateModal({ templateId, open, onClose }: AutomateModalProps) {
  const router = useRouter();
  const [using, setUsing] = useState<UsingFlow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    let alive = true;
    automationsUsingTemplate({ templateId })
      .then((res) => alive && setUsing(res.ok ? res.data : []))
      .catch(() => alive && setUsing([]));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, templateId, onClose]);

  if (!open) return null;

  const create = () =>
    start(async () => {
      setError(null);
      const res = await createAutomationFromTemplate({ templateId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onClose();
      router.push(res.data.href);
    });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      <div className="fixed inset-0 bg-black/50" onClick={() => !pending && onClose()} />
      <div role="dialog" aria-modal="true" aria-labelledby="automate-title" className="relative z-10 max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-border bg-card p-5 shadow-lg sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="automate-title" className="text-base font-semibold text-foreground">Automatizar con esta plantilla</h2>
            <p className="mt-1 text-xs text-muted-foreground">Cada vez que alguien completa un formulario, se genera su pieza con sus datos y se la manda por email.</p>
          </div>
          <button type="button" onClick={onClose} disabled={pending} aria-label="Cerrar" className="rounded-lg p-1 text-muted-foreground hover:bg-accent">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <ol className="mt-4 space-y-2 text-sm" aria-label="Cómo queda la automatización">
          <li className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
            <Zap className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>
              <b className="font-medium">Formulario enviado</b>
              <span className="block text-xs text-muted-foreground">El formulario lo elegís en el lienzo.</span>
            </span>
          </li>
          <li className="flex items-center gap-2 rounded-lg border border-primary-edge bg-primary/5 px-3 py-2">
            <Sparkles className="h-4 w-4 shrink-0 text-primary-ink" aria-hidden />
            <span>
              <b className="font-medium">Generar desde plantilla</b>
              <span className="block text-xs text-muted-foreground">Con esta plantilla, para quien respondió. Cada variable se puede llenar con una respuesta.</span>
            </span>
          </li>
          <li className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
            <Mail className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>
              <b className="font-medium">Enviar email</b>
              <span className="block text-xs text-muted-foreground">Con el link ({"{{design.link}}"}) y el PDF adjunto.</span>
            </span>
          </li>
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">Se crea como borrador: no corre hasta que elijas el formulario y la publiques.</p>

        {using && using.length > 0 ? (
          <div className="mt-4">
            <p className="text-xs font-semibold text-foreground">Ya la usan</p>
            <ul className="mt-1.5 space-y-1">
              {using.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link href={f.href} className="truncate text-primary-ink underline-offset-2 hover:underline">
                    {f.name}
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">{STATUS_LABELS[f.status] ?? f.status}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={pending} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent">
            Cerrar
          </button>
          <button type="button" onClick={create} disabled={pending} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
            Crear una automatización con esta plantilla
          </button>
        </div>
      </div>
    </div>
  );
}
