"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { AssigneeAvatar } from "@/components/content/assignee-avatar";
import { setSocialPostAssignee } from "@/lib/actions/social-assignee";
import { drawerHref } from "@/lib/content/drawer-url";
import type { PostResponsible as Responsible } from "@/lib/social/responsible";

/**
 * El responsable de una publicacion (Extra I, F43).
 *
 * - Con pieza: el responsable de la pieza, solo lectura, con link a la pieza (se cambia desde la pieza).
 * - Sin pieza: un selector con el equipo. Quien no puede publicar ve quien es, sin selector.
 */
export function PostResponsible({ socialPostId, responsible }: { socialPostId: string; responsible: Responsible }) {
  const [assigneeId, setAssigneeId] = useState(responsible.assignee?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (responsible.mode === "piece") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs font-medium text-muted-foreground">Responsable</span>
        <AssigneeAvatar assignee={responsible.assignee} size="md" />
        <span>{responsible.assignee?.name ?? "Sin responsable"}</span>
        <Link
          href={drawerHref(new URLSearchParams(), { kind: "piece", id: responsible.pieceId })}
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {responsible.pieceTitle ? `Pieza: ${responsible.pieceTitle}` : "Abrir la pieza"}
        </Link>
      </div>
    );
  }

  if (!responsible.canAssign) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-xs font-medium text-muted-foreground">Responsable</span>
        <AssigneeAvatar assignee={responsible.assignee} size="md" />
        <span>{responsible.assignee?.name ?? "Sin responsable"}</span>
      </div>
    );
  }

  // Una persona que ya no esta en el equipo sigue viéndose como responsable actual.
  const known = responsible.team.some((m) => m.id === assigneeId);
  const options = assigneeId && !known ? [...responsible.team, { id: assigneeId, name: "Alguien que ya no está en el equipo" }] : responsible.team;
  const current = responsible.team.find((m) => m.id === assigneeId) ?? null;

  const change = (next: string) => {
    const previous = assigneeId;
    setAssigneeId(next);
    setError(null);
    start(async () => {
      const result = await setSocialPostAssignee(socialPostId, next || null);
      if (!result.ok) {
        setAssigneeId(previous);
        setError(result.error);
      }
    });
  };

  return (
    <div>
      <label className="inline-flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Responsable</span>
        <AssigneeAvatar assignee={current} size="md" />
        <select
          value={assigneeId}
          disabled={pending}
          onChange={(e) => change(e.target.value)}
          aria-label="Responsable de la publicación"
          className="h-8 max-w-[12rem] rounded-md border border-border bg-background px-2 text-xs disabled:opacity-70"
        >
          <option value="">Sin responsable</option>
          {options.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
