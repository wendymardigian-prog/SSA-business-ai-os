"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, FileText, Loader2, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/forms/back-link";
import { Historial } from "@/components/historial/historial";
import { Notice } from "@/components/agents/fields";
import { LinkContact } from "./link-contact";
import { ContractPanel, type ContractView } from "./contract-panel";
import { getSubmissionFileUrl } from "@/lib/actions/forms/responses";
import { setSubmissionSpam } from "@/lib/actions/forms/forms";
import { answerToText, orderedAnswers, statusLabel, type StoredAnswer, type SubmissionStatus } from "@/lib/forms/responses";
import { filesOfAnswers } from "@/lib/forms/files";
import { formatInZone } from "@/lib/forms/responses-query";
import { attributionSections, entryUrlOf } from "@/lib/forms/attribution-view";
import { EntryUrlBlock } from "@/components/attribution/entry-url-block";
import { matchedByText, type ConflictView } from "@/lib/forms/contact-outcome";

export interface SubmissionView {
  id: string;
  status: SubmissionStatus;
  createdAt: string;
  answers: Record<string, StoredAnswer>;
  score: number | null;
  npsCategory: string | null;
  attribution: Record<string, unknown>;
  versionNumber: number | null;
  origin: string | null;
  sitePath: string | null;
  timezone: string | null;
  contactCreated: boolean;
  matchedBy: string | null;
  /** Datos de la respuesta que coinciden con OTRO contacto (R5). */
  conflicts: ConflictView[];
  /** Datos de la respuesta que no se pudieron guardar en el contacto (país no reconocido…). */
  contactNotes: string[];
}

const ORIGIN_LABELS: Record<string, string> = { public_page: "Página del formulario", embed: "Embebido en otra web", site: "Página del sitio" };
const NPS_LABELS: Record<string, string> = { promoter: "Promotor", passive: "Pasivo", detractor: "Detractor" };

export function SubmissionDetail({
  formId,
  formName,
  formType,
  submission,
  fieldOrder,
  contact,
  canManage,
  showHistory,
  names,
  timeZone,
  contract,
}: {
  formId: string;
  formName: string;
  formType: "custom" | "survey" | "contract";
  submission: SubmissionView;
  /** El orden de los campos de la versión con la que se respondió. */
  fieldOrder: string[];
  contact: { id: string; name: string } | null;
  canManage: boolean;
  showHistory: boolean;
  names: Record<string, string>;
  timeZone: string;
  /** Solo en la respuesta de un contrato: su firma. */
  contract?: ContractView | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const files = filesOfAnswers(submission.answers);
  const fileKeys = new Set(files.map((f) => f.path));
  const sections = attributionSections(submission.attribution);
  const entryUrl = entryUrlOf(submission.attribution);

  function openFile(path: string) {
    setMessage(null);
    start(async () => {
      const result = await getSubmissionFileUrl({ submissionId: submission.id, path });
      if (result.ok) window.open(result.url, "_blank", "noopener,noreferrer");
      else setMessage({ tone: "error", text: result.error });
    });
  }

  function toggleSpam() {
    setMessage(null);
    start(async () => {
      const result = await setSubmissionSpam({ submissionId: submission.id, spam: submission.status !== "spam" });
      if (result.ok) {
        setMessage({ tone: "success", text: submission.status === "spam" ? "Sacada de spam" : "Marcada como spam" });
        router.refresh();
      } else setMessage({ tone: "error", text: result.error });
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Respuesta"
        tooltip="Una respuesta con su contacto, su atribución y su versión del formulario."
        backHref={<BackLink href={`/dashboard/formularios/${formId}/respuestas`} label="Volver a las respuestas" />}
        right={
          canManage ? (
            <button type="button" onClick={toggleSpam} disabled={pending} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm hover:bg-accent disabled:opacity-50">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ShieldAlert className="h-4 w-4" aria-hidden />}
              <span className="hidden sm:inline">{submission.status === "spam" ? "Sacar de spam" : "Marcar como spam"}</span>
            </button>
          ) : null
        }
      />
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto max-w-3xl space-y-5">
          <Link href={`/dashboard/formularios/${formId}/respuestas`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Respuestas de {formName}
          </Link>

          {message && <div role="status"><Notice tone={message.tone}>{message.text}</Notice></div>}

          <section className="rounded-xl border border-border bg-card p-5">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Recibida</dt>
                <dd>{formatInZone(submission.createdAt, timeZone)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Estado</dt>
                <dd>{statusLabel(submission.status)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Contacto</dt>
                <dd>
                  {contact ? (
                    <Link href={`/dashboard/contacts/${contact.id}`} className="underline-offset-2 hover:underline">
                      {contact.name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Sin contacto</span>
                  )}
                  {submission.contactCreated && <span className="ml-2 text-xs text-muted-foreground">(se creó con esta respuesta)</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Versión del formulario</dt>
                <dd>{submission.versionNumber ? `Versión ${submission.versionNumber}` : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Origen</dt>
                <dd>
                  {submission.origin ? ORIGIN_LABELS[submission.origin] ?? submission.origin : "—"}
                  {submission.sitePath ? ` · ${submission.sitePath}` : ""}
                </dd>
              </div>
              {formType === "survey" && (
                <div>
                  <dt className="text-xs text-muted-foreground">Puntaje</dt>
                  <dd>
                    {submission.score ?? "—"}
                    {submission.npsCategory ? ` · ${NPS_LABELS[submission.npsCategory] ?? submission.npsCategory}` : ""}
                  </dd>
                </div>
              )}
            </dl>
            {submission.conflicts.length > 0 && (
              <div className="mt-3 space-y-2">
                {submission.conflicts.map((conflict) => (
                  <Notice key={`${conflict.by}:${conflict.contactId}`} tone="warning">
                    {conflict.text}:{" "}
                    <Link href={`/dashboard/contacts/${conflict.contactId}`} className="underline">
                      verlo
                    </Link>
                    . {matchedByText(submission.matchedBy) ?? "La respuesta se vinculó al otro dato."}
                  </Notice>
                ))}
              </div>
            )}
            {submission.contactNotes.length > 0 && (
              <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {submission.contactNotes.map((note) => (
                  <li key={note}>{note} (no se guardó en el contacto)</li>
                ))}
              </ul>
            )}
          </section>

          {contract && <ContractPanel submissionId={submission.id} contract={contract} canManage={canManage} timeZone={timeZone} />}

          {canManage && !contact && submission.status !== "spam" && <LinkContact submissionId={submission.id} />}

          <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="respuestas-titulo">
            <h2 id="respuestas-titulo" className="text-sm font-semibold">
              Lo que respondió
            </h2>
            {Object.keys(submission.answers).length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No hay respuestas guardadas.</p>
            ) : (
              <dl className="mt-3 space-y-3">
                {orderedAnswers(submission.answers, fieldOrder).map(([key, answer]) => {
                  const own = filesOfAnswers({ [key]: answer });
                  return (
                    <div key={key}>
                      <dt className="text-xs text-muted-foreground">{answer.label || key}</dt>
                      <dd className="whitespace-pre-line text-sm">
                        {own.length > 0 ? (
                          <ul className="space-y-1">
                            {own.map((file) => (
                              <li key={file.path}>
                                <button
                                  type="button"
                                  onClick={() => fileKeys.has(file.path) && openFile(file.path)}
                                  disabled={pending}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
                                >
                                  <FileText className="h-3.5 w-3.5" aria-hidden /> {file.name}
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          answerToText(answer.value) || <span className="text-muted-foreground">—</span>
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            )}
          </section>

          {/* Plano formularios-ui, diferencia 13: siempre abierta, como el prototipo. */}
          <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="de-donde-vino">
            <h2 id="de-donde-vino" className="text-sm font-semibold">
              De dónde vino
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">La atribución de la visita: se guarda sola en cada respuesta.</p>
            {sections.length === 0 && !entryUrl ? (
              <p className="mt-3 text-sm text-muted-foreground">Esta visita llegó sin datos de campaña.</p>
            ) : (
              <div className="mt-3 space-y-4">
                {sections.map((section) => (
                  <div key={section.title}>
                    <h3 className="text-xs font-semibold text-muted-foreground">{section.title}</h3>
                    <dl className="mt-1 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                      {section.items.map((item) => (
                        <div key={item.key} className="min-w-0">
                          <dt className="text-xs text-muted-foreground">{item.label}</dt>
                          <dd className="truncate" title={item.value}>
                            {item.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
                {entryUrl && <EntryUrlBlock url={entryUrl} />}
              </div>
            )}
          </section>

          {showHistory && (
            <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="historial-titulo">
              <h2 id="historial-titulo" className="text-sm font-semibold">
                Historial
              </h2>
              <div className="mt-3">
                <Historial entityType="form_submission" entityId={submission.id} names={{ users: names }} timeZone={timeZone} />
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
