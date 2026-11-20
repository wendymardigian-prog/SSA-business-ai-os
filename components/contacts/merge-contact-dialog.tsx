"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Loader2, Search, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ContentDialog } from "@/components/content/dialog";
import { PlatformIcon } from "@/components/platform-icon";
import { MarkBadge } from "@/components/contacts/mark-badge";
import { getMergeCandidate, linkContacts, searchContactsForMerge } from "@/lib/actions/contacts";
import { defaultMainContactId, mergedPreview, type MergeCandidate } from "@/lib/contacts/merge-pick";

/**
 * «Unir con otro contacto» (20/11/2026).
 *
 * Cuando la misma persona entro por dos canales que no comparten un dato (un
 * Instagram sin telefono y un WhatsApp, por ejemplo), el sistema la tiene como
 * dos contactos y una marca (Conocido, Cliente) queda en uno solo. Aca una
 * persona con `contacts.merge` busca el otro, los ve lado a lado, elige cual
 * queda y los une con `linkContacts` (`merge_contacts`): un solo contacto con
 * todas las conversaciones y las marcas de los dos. No se puede deshacer.
 */
export function MergeContactDialog({
  contactId,
  onClose,
  onMerged,
}: {
  contactId: string;
  onClose: () => void;
  /** Despues de unir: el contacto que quedo y lo que se movio. */
  onMerged: (mainId: string, moved: Record<string, number>) => void;
}) {
  // `ContentDialog` vuelve a enfocar el primer campo si cambia `onClose`: se lo pasa estable.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  const close = useCallback(() => closeRef.current(), []);

  const [current, setCurrent] = useState<MergeCandidate | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MergeCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [other, setOther] = useState<MergeCandidate | null>(null);
  const [mainId, setMainId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    getMergeCandidate(contactId).then((r) => {
      if (!alive) return;
      if (r.ok) setCurrent(r.contact);
      else setError(r.error);
    });
    return () => {
      alive = false;
    };
  }, [contactId]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let alive = true;
    const timer = setTimeout(() => {
      searchContactsForMerge(contactId, q).then((r) => {
        if (!alive) return;
        setSearching(false);
        if (r.ok) {
          setResults(r.contacts);
          setError(null);
        } else setError(r.error);
      });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, contactId]);

  function choose(candidate: MergeCandidate) {
    setOther(candidate);
    setMainId(current ? defaultMainContactId(current, candidate) : contactId);
    setError(null);
  }

  function merge() {
    if (!current || !other || !mainId) return;
    const duplicateId = mainId === current.id ? other.id : current.id;
    start(async () => {
      const result = await linkContacts(duplicateId, mainId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onMerged(mainId, result.moved ?? {});
    });
  }

  const main = current && other ? (mainId === other.id ? other : current) : null;
  const duplicate = current && other ? (mainId === other.id ? current : other) : null;
  const preview = main && duplicate ? mergedPreview(main, duplicate) : null;

  const footer = other ? (
    <>
      <button
        type="button"
        onClick={() => setOther(null)}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Elegir otro
      </button>
      <span className="flex-1" />
      <button
        type="button"
        onClick={merge}
        disabled={pending || !current}
        className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
      >
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
        Unir contactos
      </button>
    </>
  ) : (
    <>
      <span className="flex-1" />
      <button
        type="button"
        onClick={close}
        className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
      >
        Cancelar
      </button>
    </>
  );

  const body = (
    <ContentDialog title="Unir con otro contacto" label="Unir con otro contacto" onClose={close} footer={footer}>
      {!other ? (
        <>
          <p className="text-sm text-muted-foreground">
            Si esta persona también te escribe por otro canal y el sistema la tiene como otro contacto, buscalo y
            unilos: quedan las conversaciones de los dos en un solo contacto, con sus marcas.
          </p>
          <label className="relative block">
            <span className="sr-only">Buscar el otro contacto</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => {
                const value = e.target.value;
                setQuery(value);
                // Con menos de 2 letras no se busca: la lista queda vacía.
                const searchable = value.trim().length >= 2;
                setSearching(searchable);
                if (!searchable) setResults([]);
              }}
              placeholder="Nombre, teléfono, email o @usuario"
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm"
            />
          </label>
          {searching ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Buscando…
            </p>
          ) : query.trim().length >= 2 && results.length === 0 && !error ? (
            <p className="text-sm text-muted-foreground">No encontré otro contacto con eso.</p>
          ) : (
            <ul className="space-y-1.5">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => choose(c)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-left hover:bg-accent"
                  >
                    <CandidateSummary candidate={c} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : current && main && duplicate && preview ? (
        <>
          <p className="text-sm font-medium">¿Cuál queda como principal?</p>
          <p className="text-xs text-muted-foreground">
            El principal conserva su nombre y sus datos; lo que le falte se completa con el otro.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {[current, other].map((c) => (
              <label
                key={c.id}
                className={cn(
                  "flex cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2",
                  mainId === c.id ? "border-primary-edge bg-primary/5" : "border-border hover:bg-accent",
                )}
              >
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="radio"
                    name="merge-main"
                    checked={mainId === c.id}
                    onChange={() => setMainId(c.id)}
                  />
                  <span className="whitespace-nowrap">
                    {mainId === c.id ? "Queda como principal" : "Se une al principal"}
                  </span>
                </span>
                {c.id === contactId && <span className="text-[11px] text-muted-foreground">El que estás mirando</span>}
                <CandidateSummary candidate={c} />
              </label>
            ))}
          </div>
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Así queda</p>
            <CandidateSummary candidate={preview} />
          </div>
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            Unir no se puede deshacer. Las conversaciones, notas, tareas, agendas y ventas de «{duplicate.name}» pasan a «
            {main.name}».
          </p>
        </>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Cargando…
        </p>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </ContentDialog>
  );

  // Al body: el panel de la bandeja tiene su propio scroll y no tiene que recortar el modal.
  // Solo se monta después de un clic, así que `document` ya existe.
  return typeof document === "undefined" ? null : createPortal(body, document.body);
}

function CandidateSummary({ candidate }: { candidate: MergeCandidate }) {
  const details = [candidate.phone, candidate.email, candidate.instagram ? `@${candidate.instagram}` : null].filter(
    (v): v is string => !!v,
  );
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="truncate text-sm font-medium">{candidate.name}</span>
        {candidate.platforms.map((p) => (
          <PlatformIcon key={p} platform={p} className="h-3.5 w-3.5" size={14} />
        ))}
        {candidate.isCustomer && <MarkBadge mark="customer" />}
        {candidate.isKnown && <MarkBadge mark="known" />}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {details.length > 0 ? details.join(" · ") : "Sin teléfono, email ni @"}
      </span>
    </span>
  );
}
