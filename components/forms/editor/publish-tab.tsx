"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, Copy, ExternalLink, Loader2, ShieldCheck, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Notice, Field, inputClass } from "@/components/agents/fields";
import { Tabs } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { changeFormSlug } from "@/lib/actions/forms/forms";
import { generateFormEmbedCode } from "@/lib/embed/code";
import { ContactLinkCard } from "./contact-link-card";
import type { EditorForm, EditorVersion } from "./types";

/**
 * La pestaña Publicar (F8, F10): el link público, el código para embeber, el
 * estado de Turnstile y el historial de versiones.
 */

type CodeTab = "inline" | "floating";

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  return {
    copied,
    copy(id: string, text: string) {
      void navigator.clipboard?.writeText(text).then(() => {
        setCopied(id);
        window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1800);
      });
    },
  };
}

function CopyButton({ id, text, label, state }: { id: string; text: string; label: string; state: ReturnType<typeof useCopy> }) {
  const done = state.copied === id;
  return (
    <button type="button" onClick={() => state.copy(id, text)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-accent">
      {done ? <Check className="h-3.5 w-3.5 text-green-600" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      {done ? "Copiado" : label}
    </button>
  );
}

export function PublishTab({
  form,
  versions,
  canManage,
  turnstileConfigured,
  appUrl,
  published,
  onSlugChanged,
  timeZone,
}: {
  form: EditorForm;
  versions: EditorVersion[];
  canManage: boolean;
  turnstileConfigured: boolean;
  appUrl: string;
  published: boolean;
  onSlugChanged: (slug: string) => void;
  timeZone: string;
}) {
  const copy = useCopy();
  const [slug, setSlug] = useState(form.slug);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [confirmSlug, setConfirmSlug] = useState(false);
  const [saving, startSaving] = useTransition();
  const [codeTab, setCodeTab] = useState<CodeTab>("inline");

  const base = appUrl || (typeof window !== "undefined" ? window.location.origin : "");
  const publicUrl = `${base}/f/${form.slug}`;
  const code = useMemo(() => generateFormEmbedCode(codeTab, { slug: form.slug }, base || "https://tu-dominio.com"), [codeTab, form.slug, base]);

  function saveSlug(confirm: boolean) {
    setMessage(null);
    startSaving(async () => {
      const result = await changeFormSlug({ formId: form.id, slug, confirm });
      if (result.ok) {
        onSlugChanged(result.slug);
        setMessage({ tone: "success", text: "Link actualizado" });
      } else {
        setMessage({ tone: "error", text: result.error });
      }
    });
  }

  function requestSlugChange() {
    if (form.status === "published") setConfirmSlug(true);
    else saveSlug(false);
  }

  return (
    <div className="space-y-6">
      {!published && <Notice tone="info">Este formulario todavía no está publicado: el link y el código funcionan recién cuando lo publiques.</Notice>}

      <section className="space-y-3 rounded-xl border border-border bg-card p-5" aria-labelledby="link-publico">
        <h2 id="link-publico" className="text-sm font-semibold">
          Link público
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-3 py-2 text-xs">{publicUrl}</code>
          <CopyButton id="url" text={publicUrl} label="Copiar" state={copy} />
          <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-accent">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Abrir
          </a>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[14rem] flex-1">
              <Field label="Parte final del link" hint="De 3 a 60 caracteres: minúsculas, números y guiones.">
                {(id) => <input id={id} className={inputClass} value={slug} maxLength={60} onChange={(e) => setSlug(e.target.value.toLowerCase())} />}
              </Field>
            </div>
            <button
              type="button"
              disabled={saving || slug === form.slug}
              onClick={requestSlugChange}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Cambiar link
            </button>
          </div>
        )}
        {message && (
          <div role="status">
            <Notice tone={message.tone}>{message.text}</Notice>
          </div>
        )}
      </section>

      {canManage && <ContactLinkCard formId={form.id} published={published} type={form.type} />}

      <section className="space-y-3 rounded-xl border border-border bg-card p-5" aria-labelledby="embed">
        <h2 id="embed" className="text-sm font-semibold">
          Pegarlo en tu web
        </h2>
        <Tabs
          label="Tipo de embed"
          value={codeTab}
          onChange={setCodeTab}
          tabs={[
            { value: "inline", label: "En la página" },
            { value: "floating", label: "Botón flotante" },
          ]}
        >
          <div className="space-y-2 pt-3">
            <textarea readOnly aria-label="Código HTML para pegar" rows={9} value={code.html} className="w-full rounded-lg border border-input bg-muted px-3 py-2 font-mono text-[11px]" />
            <CopyButton id="embed-html" text={code.html} label="Copiar código" state={copy} />
          </div>
        </Tabs>
        <p className="text-xs text-muted-foreground">Si la web ya carga el embed de la Agenda, no hace falta repetir la primera parte: es el mismo script.</p>
      </section>

      <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="proteccion">
        <h2 id="proteccion" className="text-sm font-semibold">
          Protección contra bots
        </h2>
        {turnstileConfigured ? (
          <p className="mt-2 flex items-center gap-2 text-sm text-green-700 dark:text-green-300">
            <ShieldCheck className="h-4 w-4" aria-hidden /> Protegido con Cloudflare Turnstile
          </p>
        ) : (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
            <ShieldAlert className="h-4 w-4" aria-hidden /> Falta configurar Turnstile.
            <Link href="/dashboard/settings/integrations" className="underline">
              Integraciones → Seguridad
            </Link>
          </p>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="versiones">
        <h2 id="versiones" className="text-sm font-semibold">
          Versiones publicadas
        </h2>
        {versions.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Todavía no publicaste ninguna versión.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border text-sm">
            {versions.map((v) => (
              <li key={v.number} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">Versión {v.number}</span>
                  {v.shaPrefix && <span className="ml-2 font-mono text-xs text-muted-foreground">huella {v.shaPrefix}…</span>}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(v.publishedAt).toLocaleString("es-AR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone })}
                  {v.publishedByName ? ` · ${v.publishedByName}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={confirmSlug}
        title="¿Cambiar el link?"
        message="Este formulario está publicado: los links que ya compartiste dejan de funcionar."
        confirmLabel="Cambiar link"
        cancelLabel="Cancelar"
        destructive
        onCancel={() => setConfirmSlug(false)}
        onConfirm={() => {
          setConfirmSlug(false);
          saveSlug(true);
        }}
      />
    </div>
  );
}
