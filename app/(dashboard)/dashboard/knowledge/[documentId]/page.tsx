import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { requireWorkspaceAdmin } from "@/lib/auth/guards";
import { formatDateTime } from "@/components/contacts/ui";
import { StatusBadge } from "../knowledge-view";
import { DownloadOriginalButton } from "./download-button";
import { formatBytes, MIME_LABELS, type SupportedMime } from "@/lib/knowledge/validate";
import type { KnowledgeStatus } from "@/lib/types/database";

/**
 * Detalle de un documento (F17).
 *
 * El contenido se muestra como TEXTO PLANO, en un <pre>. No es una limitacion:
 * es la decision de seguridad. El markdown de aca sale de un archivo que subio
 * alguien, y renderizarlo como HTML abriria la puerta a XSS; un <pre> con el
 * texto adentro nunca interpreta nada. Ademas esta pantalla sirve para
 * verificar que el documento se convirtio bien, y para eso conviene ver el
 * texto tal cual quedo indexado, que es exactamente lo que va a leer el agente.
 */
export default async function KnowledgeDocumentPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  const { workspace, supabase } = await requireWorkspaceAdmin();

  const { data: document, error } = await supabase
    .from("knowledge_base")
    .select(
      "id, title, tags, status, error_detail, content_md, chunk_count, source_mime, source_size_bytes, source_filename, source_file_path, embedding_model, created_at, indexed_at",
    )
    .eq("id", documentId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) console.error("[kb] no pude leer el documento:", error.message);
  if (!document) notFound();

  const label = document.source_mime
    ? (MIME_LABELS[document.source_mime as SupportedMime] ?? "Documento")
    : "Documento";

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <Link
          href="/dashboard/knowledge"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Base de conocimiento
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">{document.title}</h1>
              <StatusBadge status={document.status as KnowledgeStatus} />
            </div>

            <p className="mt-1 text-sm text-muted-foreground">
              {label}
              {document.source_size_bytes ? ` · ${formatBytes(document.source_size_bytes)}` : ""}
              {document.status === "ready"
                ? ` · ${document.chunk_count} ${document.chunk_count === 1 ? "fragmento" : "fragmentos"}`
                : ""}
              {` · Subido el ${formatDateTime(document.created_at)}`}
            </p>

            {document.indexed_at && (
              <p className="mt-1 text-xs text-muted-foreground">
                Indexado el {formatDateTime(document.indexed_at)}
                {document.embedding_model ? ` con ${document.embedding_model}` : ""}
              </p>
            )}

            {document.tags?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {document.tags.map((tag: string) => (
                  <span
                    key={tag}
                    className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {document.source_file_path && (
            <DownloadOriginalButton
              documentId={document.id}
              filename={document.source_filename ?? document.title}
            />
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        {document.status === "error" && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950/40"
          >
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
              aria-hidden="true"
            />
            <div>
              <p className="font-medium text-red-900 dark:text-red-200">
                No se pudo procesar este documento
              </p>
              <p className="mt-1 text-red-800 dark:text-red-300">
                {document.error_detail ?? "Sin detalle."}
              </p>
            </div>
          </div>
        )}

        {document.status === "processing" && (
          <div className="rounded-xl border border-dashed border-border p-12 text-center">
            <h2 className="text-lg font-semibold">Procesando</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Se esta convirtiendo el archivo e indexando su contenido. Recarga en unos segundos
              para ver como quedo.
            </p>
          </div>
        )}

        {document.content_md ? (
          <>
            <h2 className="text-sm font-semibold text-muted-foreground">
              Contenido indexado (texto plano)
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Es exactamente el texto que la IA va a leer. Se muestra sin formato a proposito.
            </p>
            {/*
              Texto plano en un <pre>: el navegador nunca interpreta este
              contenido como HTML, asi que un documento con codigo adentro no
              puede ejecutar nada. El overflow-x propio evita que un documento
              con lineas largas haga scrollear la pagina entera.
            */}
            <pre className="mt-3 max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-muted/40 p-5 font-mono text-xs leading-relaxed">
              {document.content_md}
            </pre>
          </>
        ) : (
          document.status === "ready" && (
            <p className="text-sm text-muted-foreground">Este documento no tiene contenido.</p>
          )
        )}
      </div>
    </div>
  );
}
