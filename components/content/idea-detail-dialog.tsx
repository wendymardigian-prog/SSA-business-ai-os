"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { approveIdea, discardIdea } from "@/lib/actions/content";
import { ideaActions } from "@/lib/content/ideas";
import type { BoardIdea } from "@/lib/content/board";
import { funnelStageInfo } from "@/lib/content/classification";
import { ContentDialog, fieldInput } from "./dialog";
import { NetworkBadges } from "./network-badge";
import { PillarDot } from "./pillar-tag";

/**
 * El detalle de una idea (C3).
 *
 * La tarjeta del tablero muestra lo justo; acá está todo lo que se anotó y,
 * sobre todo, **qué pasa al aprobar**. Es lo que faltaba: los dos botones se
 * veían iguales y nadie sabía en qué se diferenciaban ni cuánto costaba el
 * de la IA.
 */

export function IdeaDetailDialog({
  idea,
  canApprove,
  canUseAi,
  aiAvailable,
  aiReason,
  onEdit,
  onClose,
}: {
  idea: BoardIdea;
  canApprove: boolean;
  canUseAi: boolean;
  aiAvailable: boolean;
  aiReason?: string;
  onEdit: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [reason, setReason] = useState("");

  const actions = ideaActions(
    idea.status,
    { approve: canApprove, ai: canUseAi, aiAvailable },
    { withDiscard: true },
  );

  function run(action: "approve" | "approve_and_generate" | "discard") {
    setError(null);
    start(async () => {
      if (action === "discard") {
        const result = await discardIdea(idea.id, reason.trim() || undefined);
        if (!result.ok) return setError(result.error);
        onClose();
        router.refresh();
        return;
      }

      const result = await approveIdea(idea.id, {
        produceCopy: action === "approve_and_generate",
      });
      if (!result.ok) return setError(result.error);

      // Aprobar y producir abre la pieza: el copy se está escribiendo y hay
      // que revisarlo antes de aprobar nada.
      if (action === "approve_and_generate") {
        onClose();
        router.push(`/dashboard/content/${result.data.postId}/edit`);
        router.refresh();
        return;
      }

      onClose();
      router.refresh();
    });
  }

  return (
    <ContentDialog
      label={idea.title}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Idea
          </span>
          <span className="truncate">{idea.title}</span>
        </span>
      }
      footer={
        !canApprove ? (
          <>
            <span className="text-[11px] text-muted-foreground">
              Solo Owner y Admin aprueban ideas.
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent"
            >
              Cerrar
            </button>
          </>
        ) : (
          <>
            {actions.some((a) => a.action === "discard") && (
              <button
                type="button"
                onClick={() => (discarding ? run("discard") : setDiscarding(true))}
                disabled={pending}
                className="rounded-lg px-3 py-1.5 text-sm text-red-700 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
              >
                {discarding ? "Confirmar descarte" : "Descartar"}
              </button>
            )}
            <span className="flex-1" />
            {error && (
              <span role="alert" className="text-xs text-red-700 dark:text-red-400">
                {error}
              </span>
            )}
            <button
              type="button"
              onClick={onEdit}
              disabled={pending}
              className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
            >
              Editar
            </button>
            {actions
              .filter((a) => a.action !== "discard")
              .map((action) => (
                <button
                  key={action.action}
                  type="button"
                  onClick={() => run(action.action as "approve" | "approve_and_generate")}
                  disabled={pending || Boolean(action.disabledReason)}
                  title={action.disabledReason ?? aiReason}
                  className={
                    action.action === "approve_and_generate"
                      ? "inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                      : "rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
                  }
                >
                  {action.action === "approve_and_generate" && (
                    <Sparkles className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {action.label}
                </button>
              ))}
          </>
        )
      }
    >
      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-sm">
        <Row label="Idea">
          {idea.content ? <span className="whitespace-pre-wrap">{idea.content}</span> : null}
        </Row>
        <Row label="Formato">{idea.format}</Row>
        <Row label="Pilar">{idea.pillar ? <PillarDot tag={idea.pillar} className="ml-0 text-sm text-foreground" /> : null}</Row>
        <Row label="Oferta">{idea.offer?.name}</Row>
        <Row label="Etapa">
          {idea.funnelStage ? (
            <span>
              {funnelStageInfo(idea.funnelStage)?.label}
              <span className="block text-[11px] text-muted-foreground">
                {funnelStageInfo(idea.funnelStage)?.description}
              </span>
            </span>
          ) : null}
        </Row>
        <Row label="Redes">{idea.platforms.length > 0 ? <NetworkBadges platforms={idea.platforms} /> : null}</Row>
        <Row label="Referencia">
          {idea.reference ? (
            idea.reference.startsWith("http") ? (
              <a
                href={idea.reference}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-primary underline underline-offset-2"
              >
                {idea.reference}
              </a>
            ) : (
              idea.reference
            )
          ) : null}
        </Row>
        <Row label="Autoría">{idea.authorship}</Row>
      </dl>

      {canApprove && (
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <h3 className="text-xs font-semibold">Qué pasa al aprobar</h3>
          <ul className="mt-2 space-y-2 text-xs text-muted-foreground">
            <li>
              <b className="text-foreground">Aprobar:</b> se crea un post en Borrador con esta idea
              vinculada. El guion y el caption quedan vacíos.
            </li>
            <li>
              <b className="text-foreground">✦ Aprobar y producir copy:</b> además, el copywriter
              escribe el guion para grabar y el caption de cada red, y se abre el post para que lo
              revises.{" "}
              {aiAvailable
                ? "Usa el proveedor de IA del negocio, con sus topes de gasto."
                : (aiReason ?? "Hace falta conectar un proveedor de IA.")}
            </li>
          </ul>
        </div>
      )}

      {discarding && (
        <div className="space-y-1.5 rounded-lg border border-red-500/30 p-3">
          <p className="text-xs text-red-700 dark:text-red-400">
            La idea queda en el historial: no se borra, deja de estar en el tablero.
          </p>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motivo (opcional)"
            className={fieldInput}
          />
        </div>
      )}
    </ContentDialog>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children || <span className="text-muted-foreground">—</span>}</dd>
    </>
  );
}
