"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { probeAssignment, searchContactsForRules, simulateAssignments, type SimulationRow } from "@/lib/actions/assignment-rules";
import type { DryRunRow } from "@/lib/sales/assignment/dry-run";
import { KIND_LABELS } from "@/lib/sales/assignment/types";
import { MEDIUMS, MEDIUM_LABELS, SOURCES, SOURCE_LABELS } from "@/lib/contacts/taxonomy";
import { ActionError } from "@/components/contacts/ui";
import { fieldInput } from "@/components/content/dialog";
import { cn } from "@/lib/utils";
import { useContactSearchWith } from "../use-contact-search";
import type { MemberOption } from "./assignment-rules-view";

/**
 * Probador y simulación en seco (plano F16). Usan la misma función que el job de
 * asignación, así que muestran exactamente lo que el job haría. NO escriben nada.
 */
export function AssignmentTester({ members, contactNames }: { members: MemberOption[]; contactNames: Record<string, string> }) {
  const names = (id: string | null | undefined) => (id ? (members.find((m) => m.userId === id)?.label ?? contactNames[id] ?? "(ya no existe)") : "—");

  return (
    <div className="space-y-5">
      <Prober names={names} />
      <Simulation names={names} />
    </div>
  );
}

function ResultTable({ rows, names }: { rows: DryRunRow[]; names: (id: string | null | undefined) => string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[32rem] text-left text-xs">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Tipo</th>
            <th className="px-3 py-2 font-medium">Hoy tiene</th>
            <th className="px-3 py-2 font-medium">Asignaría a</th>
            <th className="px-3 py-2 font-medium">Por la regla</th>
            <th className="px-3 py-2 font-medium">¿Se aplicaría?</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.kind}>
              <td className="px-3 py-2 font-medium">{KIND_LABELS[r.kind]}</td>
              <td className="px-3 py-2">{names(r.current)}</td>
              <td className="px-3 py-2">{r.wouldAssign ? names(r.wouldAssign.id) : "—"}</td>
              <td className="px-3 py-2">{r.ruleName ?? "—"}</td>
              <td className={cn("px-3 py-2", r.applies ? "text-green-600" : "text-muted-foreground")}>{r.applies ? "Sí" : r.reasonText}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Prober({ names }: { names: (id: string | null | undefined) => string }) {
  const [source, setSource] = useState<"touch" | "contact">("touch");
  const [touch, setTouch] = useState({ source: "", medium: "", campaign: "", content: "", term: "" });
  const [country, setCountry] = useState("");
  const [contact, setContact] = useState<{ id: string; name: string } | null>(null);
  const [rows, setRows] = useState<DryRunRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const search = useContactSearchWith(searchContactsForRules);

  function run() {
    setError(null);
    start(async () => {
      const result = await probeAssignment(
        source === "contact"
          ? { contactId: contact?.id }
          : { touch: { source: touch.source, medium: touch.medium || undefined, campaign: touch.campaign, content: touch.content, term: touch.term }, country },
      );
      if (!result.ok) {
        setError(result.error);
        setRows(null);
        return;
      }
      setRows(result.data);
    });
  }

  const ready = source === "contact" ? !!contact : !!touch.source;

  return (
    <section aria-labelledby="probador-title" className="rounded-xl border border-border p-4">
      <h3 id="probador-title" className="text-sm font-semibold">
        Probador
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">Cargá un toque o elegí un contacto y mirá a quién se asignaría. No guarda nada.</p>

      <div role="radiogroup" aria-label="Qué probar" className="mt-3 inline-flex overflow-hidden rounded-lg border border-border">
        {(["touch", "contact"] as const).map((v) => (
          <button key={v} type="button" role="radio" aria-checked={source === v} onClick={() => setSource(v)} className={cn("px-3 py-1.5 text-xs font-medium", source === v ? "bg-primary text-primary-foreground" : "hover:bg-accent")}>
            {v === "touch" ? "Un toque a mano" : "Un contacto"}
          </button>
        ))}
      </div>

      {source === "touch" ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium">Fuente</span>
            <select value={touch.source} onChange={(e) => setTouch({ ...touch, source: e.target.value })} className={fieldInput}>
              <option value="">Elegí…</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">Medio</span>
            <select value={touch.medium} onChange={(e) => setTouch({ ...touch, medium: e.target.value })} className={fieldInput}>
              <option value="">Sin medio</option>
              {MEDIUMS.map((m) => (
                <option key={m} value={m}>
                  {MEDIUM_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          {(["campaign", "content", "term"] as const).map((key) => (
            <label key={key} className="block space-y-1">
              <span className="text-xs font-medium">{key === "campaign" ? "Campaña" : key === "content" ? "Contenido" : "Término"}</span>
              <input value={touch[key]} maxLength={200} onChange={(e) => setTouch({ ...touch, [key]: e.target.value })} className={fieldInput} />
            </label>
          ))}
          <label className="block space-y-1">
            <span className="text-xs font-medium">País (opcional)</span>
            <input value={country} maxLength={60} onChange={(e) => setCountry(e.target.value)} className={fieldInput} />
          </label>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">{contact ? `Contacto elegido: ${contact.name}` : "Buscá al contacto por nombre o email."}</p>
          <input value={search.query} onChange={(e) => search.setQuery(e.target.value)} placeholder="Buscar contacto…" aria-label="Buscar contacto" className={cn(fieldInput, "sm:max-w-xs")} />
          {search.options.length > 0 && (
            <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded-lg border border-border sm:max-w-xs">
              {search.options.map((o) => (
                <li key={o.id}>
                  <button type="button" onClick={() => { setContact({ id: o.id, name: o.name }); search.reset(); }} className="w-full px-3 py-1.5 text-left text-xs hover:bg-accent">
                    {o.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <button type="button" onClick={run} disabled={pending || !ready} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
        {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        Probar
      </button>
      {error && (
        <div className="mt-3">
          <ActionError message={error} />
        </div>
      )}
      {rows && (
        <div className="mt-4">
          <ResultTable rows={rows} names={names} />
        </div>
      )}
    </section>
  );
}

function Simulation({ names }: { names: (id: string | null | undefined) => string }) {
  const [rows, setRows] = useState<SimulationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run() {
    setError(null);
    start(async () => {
      const result = await simulateAssignments();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRows(result.data);
    });
  }

  return (
    <section aria-labelledby="simulacion-title" className="rounded-xl border border-border p-4">
      <h3 id="simulacion-title" className="text-sm font-semibold">
        Simulación en seco
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">Mirá qué haría la regla con los últimos 50 contactos antes de activarla. No guarda nada.</p>
      <button type="button" onClick={run} disabled={pending} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-4 text-sm font-medium hover:bg-accent disabled:opacity-50">
        {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        Probar sobre los últimos 50 contactos
      </button>
      {error && (
        <div className="mt-3">
          <ActionError message={error} />
        </div>
      )}
      {rows && rows.length === 0 && <p className="mt-3 text-xs text-muted-foreground">Todavía no hay contactos para probar.</p>}
      {rows && rows.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[40rem] text-left text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Contacto</th>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Hoy tiene</th>
                <th className="px-3 py-2 font-medium">Asignaría a</th>
                <th className="px-3 py-2 font-medium">¿Se aplicaría?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.flatMap((row) =>
                row.rows
                  .filter((r) => r.wouldAssign || r.reasonText !== "ninguna regla coincide")
                  .map((r, i) => (
                    <tr key={`${row.contactId}-${r.kind}`}>
                      <td className="px-3 py-2 font-medium">{i === 0 ? row.name : ""}</td>
                      <td className="px-3 py-2">{KIND_LABELS[r.kind]}</td>
                      <td className="px-3 py-2">{names(r.current)}</td>
                      <td className="px-3 py-2">{r.wouldAssign ? `${names(r.wouldAssign.id)}${r.ruleName ? ` (${r.ruleName})` : ""}` : "—"}</td>
                      <td className={cn("px-3 py-2", r.applies ? "text-green-600" : "text-muted-foreground")}>{r.applies ? "Sí" : r.reasonText}</td>
                    </tr>
                  )),
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

