"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Check, Copy, FileText, Loader2, Mail, MessageCircle, Send } from "lucide-react";
import { emailContractLink, generateContractLink, listContractForms, type ContractFormOption, type ContractLink } from "@/lib/actions/sales-contract";
import { getContractPdfUrl } from "@/lib/actions/forms/contracts";
import { SaleModal } from "@/components/shared/sale-modal";
import { Section } from "@/components/sales/sale-detail";
import type { SaleContractsData } from "@/lib/sales/contracts-load";
import { EMAIL_STATUS_LABELS } from "@/lib/forms/contract/status";
import type { ContractEmailStatus } from "@/lib/types/database";

function formatWhen(value: string, timeZone: string): string {
  return new Date(value).toLocaleString("es-AR", { timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** «Contratos» de la ficha de la venta: firmados, enviados sin firmar y el botón para enviar uno. */
export function SaleContracts({
  saleId,
  data,
  canManage,
  canViewForms,
  canManageForms,
  saleOpen,
  timeZone,
}: {
  saleId: string;
  data: SaleContractsData;
  canManage: boolean;
  canViewForms: boolean;
  canManageForms: boolean;
  /** Una venta cancelada o reembolsada ya no manda contratos. */
  saleOpen: boolean;
  timeZone: string;
}) {
  const [open, setOpen] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfPending, startPdf] = useTransition();

  function openPdf(submissionId: string) {
    setPdfError(null);
    startPdf(async () => {
      const r = await getContractPdfUrl({ submissionId });
      if (!r.ok) return setPdfError(r.error);
      window.open(r.url, "_blank", "noopener,noreferrer");
    });
  }

  const empty = data.signed.length === 0 && data.unsigned.length === 0;

  return (
    <Section title="Contratos" icon={<FileText className="h-4 w-4" aria-hidden />}>
      {canManage && saleOpen && (
        <div>
          <button type="button" onClick={() => setOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent">
            <Send className="h-4 w-4" aria-hidden /> Enviar contrato
          </button>
        </div>
      )}
      {empty ? (
        <p className="text-sm text-muted-foreground">Todavía no se mandó ningún contrato para esta venta.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border text-sm">
          {data.unsigned.map((u) => (
            <li key={`${u.formId}-${u.sentAt}`} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 font-medium">{u.formName}</span>
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">Enviado sin firmar</span>
              <span className="text-xs text-muted-foreground">{formatWhen(u.sentAt, timeZone)}</span>
            </li>
          ))}
          {data.signed.map((s) => (
            <li key={s.submissionId} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{s.formName}</span>
                {s.versionNumber != null && <span className="text-muted-foreground"> · versión {s.versionNumber}</span>}
              </span>
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">Firmado</span>
              <span className="text-xs text-muted-foreground">{formatWhen(s.signedAt, timeZone)} · copia: {EMAIL_STATUS_LABELS[s.emailStatus as ContractEmailStatus] ?? s.emailStatus}</span>
              {canViewForms && s.pdfStatus === "generated" && (
                <button type="button" disabled={pdfPending} onClick={() => openPdf(s.submissionId)} className="inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-xs hover:bg-accent disabled:opacity-50">
                  {pdfPending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <FileText className="h-3 w-3" aria-hidden />} Ver PDF
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {pdfError && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{pdfError}</p>}
      {open && <SendContractModal saleId={saleId} canManageForms={canManageForms} onClose={() => setOpen(false)} />}
    </Section>
  );
}

function SendContractModal({ saleId, canManageForms, onClose }: { saleId: string; canManageForms: boolean; onClose: () => void }) {
  const [forms, setForms] = useState<ContractFormOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formId, setFormId] = useState("");
  const [link, setLink] = useState<ContractLink | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    let cancelled = false;
    listContractForms({ saleId }).then((r) => {
      if (cancelled) return;
      if (!r.ok) return setLoadError(r.error);
      setForms(r.forms);
      if (r.forms.length === 1) setFormId(r.forms[0].id);
    });
    return () => { cancelled = true; };
  }, [saleId]);

  const selected = forms?.find((f) => f.id === formId) ?? null;

  function generate() {
    setMessage(null);
    start(async () => {
      const r = await generateContractLink({ saleId, formId });
      if (!r.ok) return setMessage({ ok: false, text: r.error });
      setLink(r.link);
    });
  }

  function email() {
    setMessage(null);
    start(async () => {
      const r = await emailContractLink({ saleId, formId });
      setMessage(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    });
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage({ ok: false, text: "No pude copiar: seleccioná el link y copialo a mano." });
    }
  }

  const inboxHref = (conversationId: string) => `/dashboard/inbox?c=${conversationId}&texto=${encodeURIComponent(link?.message ?? "")}`;

  return (
    <SaleModal
      size="lg"
      title="Enviar contrato"
      label="Enviar contrato"
      onClose={onClose}
      footer={
        <>
          {message && <p role={message.ok ? "status" : "alert"} className={`mr-auto min-w-0 text-xs ${message.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>{message.text}</p>}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">Cerrar</button>
            {!link && (
              <button type="button" disabled={!formId || pending} onClick={generate} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">
                {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Generar link
              </button>
            )}
          </div>
        </>
      }
    >
      {loadError ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">{loadError}</p>
      ) : forms === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando los contratos…</p>
      ) : forms.length === 0 ? (
        <div className="space-y-2 rounded-lg border border-border p-4 text-sm">
          <p className="font-medium">No hay contratos publicados</p>
          <p className="text-xs text-muted-foreground">Un contrato es un formulario de tipo «Contrato» que ya está publicado.</p>
          {canManageForms ? <Link href="/dashboard/formularios" className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs hover:bg-accent">Ir a Formularios</Link> : <p className="text-xs text-muted-foreground">Pedile a un admin que publique uno.</p>}
        </div>
      ) : (
        <>
          <fieldset className="space-y-1.5" disabled={!!link}>
            <legend className="mb-1 text-xs font-medium">Contrato</legend>
            {forms.map((f) => (
              <label key={f.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <input type="radio" name="contract" value={f.id} checked={formId === f.id} onChange={() => setFormId(f.id)} />
                <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
                <span className="text-xs text-muted-foreground">versión {f.versionNumber}</span>
              </label>
            ))}
          </fieldset>

          {selected && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs font-medium">Texto de la versión publicada</p>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-2 text-xs">{selected.text || "Sin texto"}{selected.textTruncated ? "\n…" : ""}</pre>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium">Se prellena con la venta</p>
                {selected.preview.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Este contrato no tiene campos que se puedan prellenar con la venta: la persona completa todo.</p>
                ) : (
                  <ul className="space-y-1 rounded-lg border border-border p-2 text-xs">
                    {selected.preview.map((p) => <li key={p.fieldKey} className="flex justify-between gap-2"><span className="text-muted-foreground">{p.label}</span><span className="min-w-0 truncate font-medium">{p.value}</span></li>)}
                  </ul>
                )}
              </div>
            </div>
          )}

          {link && (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <p className="text-xs font-medium">Link para {link.contactName}</p>
              <div className="flex gap-2">
                <input readOnly value={link.url} aria-label="Link del contrato" onFocus={(e) => e.currentTarget.select()} className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-xs" />
                <button type="button" onClick={copy} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent">
                  {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} {copied ? "Copiado" : "Copiar"}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {link.conversations.map((c) => (
                  <Link key={c.id} href={inboxHref(c.id)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent">
                    <MessageCircle className="h-4 w-4" aria-hidden /> {c.platform === "instagram" ? "Enviar por Instagram" : "Enviar por WhatsApp"}
                  </Link>
                ))}
                {link.hasEmail && (
                  <button type="button" disabled={pending} onClick={email} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-50">
                    {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Mail className="h-4 w-4" aria-hidden />} Enviar por email
                  </button>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">WhatsApp e Instagram abren la conversación con el mensaje escrito: no se manda solo. El link vence a los 60 días.</p>
            </div>
          )}
        </>
      )}
    </SaleModal>
  );
}
