"use client";
// @plantilla-quitar(servicios)

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProgramSettings } from "@/lib/actions/services";
import { PortalFormEditor, type PortalFormInitial } from "./portal-form-editor";

/**
 * Términos al entrar (F113): son del producto (un texto y los compromisos para tildar) y cada variante dice si los
 * pide (por defecto, sí). Prenderlos sin el formulario no pide nada: primero se escriben y se publican.
 */
export function ProgramTermsPanel({
  productId,
  terms,
  rev,
  form,
  canEdit,
}: {
  productId: string;
  terms: { enabled?: boolean; form_id?: string | null; ask_again_on_change?: boolean };
  rev: number;
  form: PortalFormInitial | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = (patch: Record<string, unknown>) =>
    start(async () => {
      setMsg(null);
      const res = await saveProgramSettings(productId, { terms: { enabled: false, ask_again_on_change: true, ...terms, ...patch } }, rev);
      if (!res.ok) return setMsg(res.error.message);
      const d = res.data as { status: string; problems?: string[] };
      if (d.status !== "ok") return setMsg(d.status === "conflict" ? "Alguien cambió el programa mientras lo editabas. Recargá la página." : (d.problems ?? []).join(". "));
      router.refresh();
    });

  return (
    <div className="max-w-2xl space-y-3">
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!terms.enabled} disabled={!canEdit || pending || !terms.form_id} onChange={(e) => save({ enabled: e.target.checked })} /> Pedir los términos al entrar por primera vez
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={terms.ask_again_on_change !== false} disabled={!canEdit || pending} onChange={(e) => save({ ask_again_on_change: e.target.checked })} /> Pedirlos de nuevo si cambian
        </label>
      </div>
      {!terms.form_id && <p className="text-xs text-muted-foreground">Escribí los términos y guardalos antes de prenderlos.</p>}
      <p className="text-xs text-muted-foreground">Cada variante los pide salvo que se lo apague en Productos › variante › Portal.</p>
      {msg && (
        <p role="alert" className="text-sm text-destructive">
          {msg}
        </p>
      )}
      <PortalFormEditor productId={productId} kind="terms" canEdit={canEdit} initial={form ?? { name: "Términos del programa", intro: "", fields: [], quiz: {}, grading: { enabled: false } }} />
    </div>
  );
}
