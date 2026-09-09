"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, UserPlus } from "lucide-react";
import {
  enrollContact,
  searchContactsForEnrollment,
  type CollisionInfo,
} from "@/lib/actions/sequences";
import { ActionError } from "@/components/contacts/ui";
import { platformLabel } from "@/lib/platforms";

interface ContactOption {
  id: string;
  name: string;
  channels: Array<{ id: string; label: string }>;
}

export interface SequenceOption {
  id: string;
  name: string;
}

/**
 * Inscribir un contacto a mano.
 *
 * Se abre desde la pantalla de la secuencia (elegís el contacto) y desde la
 * ficha del contacto (elegís la secuencia). En los dos casos hace falta un
 * canal: sin una conversación abierta no hay por dónde mandar el primer paso.
 */
export function EnrollContactDialog({
  sequence,
  contact,
  sequences,
  onClose,
}: {
  /** Fijada cuando se abre desde la pantalla de la secuencia. */
  sequence?: SequenceOption;
  /** Fijado cuando se abre desde la ficha del contacto. */
  contact?: ContactOption;
  /** Secuencias activas, cuando hay que elegir una. */
  sequences?: SequenceOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContactOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedContact, setSelectedContact] = useState<ContactOption | null>(contact ?? null);
  const [sequenceId, setSequenceId] = useState(sequence?.id ?? "");
  const [channelId, setChannelId] = useState(contact?.channels[0]?.id ?? "");
  const [collision, setCollision] = useState<CollisionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Búsqueda con freno: no se consulta en cada tecla.
  useEffect(() => {
    if (contact || query.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      const found = await searchContactsForEnrollment(query);
      setResults(found);
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, contact]);

  function submit(confirmCollision: boolean) {
    if (!selectedContact || !sequenceId || !channelId) return;
    setError(null);
    startTransition(async () => {
      const result = await enrollContact(sequenceId, selectedContact.id, channelId, {
        confirmCollision,
      });

      if (!result.ok) {
        setError(result.error);
        setCollision(result.collision ?? null);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  const channels = selectedContact?.channels ?? [];
  const ready = Boolean(selectedContact && sequenceId && channelId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-lg border border-border bg-background p-5 shadow-lg">
        <h2 className="text-base font-semibold">Inscribir en una secuencia</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          El primer paso sale según el cronograma de la secuencia. Si el contacto responde,
          se pausa sola.
        </p>

        {!contact && (
          <div className="mt-4">
            <label htmlFor="enroll-search" className="mb-1 block text-xs font-medium text-muted-foreground">
              Contacto
            </label>
            {selectedContact ? (
              <div className="flex items-center justify-between rounded-lg border border-input px-3 py-2 text-sm">
                <span>{selectedContact.name}</span>
                <button
                  onClick={() => {
                    setSelectedContact(null);
                    setChannelId("");
                    setCollision(null);
                    setError(null);
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Cambiar
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="enroll-search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Buscá por nombre o email"
                    className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                {searching && (
                  <p className="mt-2 text-xs text-muted-foreground">Buscando...</p>
                )}

                {!searching && query.trim().length >= 2 && results.length === 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    No encontré a nadie. Ojo que los contactos marcados «no contactar» no
                    aparecen acá.
                  </p>
                )}

                {results.length > 0 && (
                  <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                    {results.map((option) => (
                      <li key={option.id}>
                        <button
                          onClick={() => {
                            setSelectedContact(option);
                            setChannelId(option.channels[0]?.id ?? "");
                          }}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                        >
                          {option.name}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {option.channels.length === 0
                              ? "sin conversación abierta"
                              : option.channels.map((c) => platformLabel(c.label)).join(", ")}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        {!sequence && sequences && (
          <div className="mt-4">
            <label htmlFor="enroll-sequence" className="mb-1 block text-xs font-medium text-muted-foreground">
              Secuencia
            </label>
            <select
              id="enroll-sequence"
              value={sequenceId}
              onChange={(e) => {
                setSequenceId(e.target.value);
                setCollision(null);
                setError(null);
              }}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Elegí una secuencia</option>
              {sequences.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {sequences.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                No hay secuencias activas. Activá una para poder inscribir a alguien.
              </p>
            )}
          </div>
        )}

        {selectedContact && (
          <div className="mt-4">
            <label htmlFor="enroll-channel" className="mb-1 block text-xs font-medium text-muted-foreground">
              Canal
            </label>
            {channels.length === 0 ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-400">
                Este contacto todavía no tiene ninguna conversación abierta, así que no hay
                por dónde escribirle. Instagram solo permite hablarle a quien escribió primero.
              </p>
            ) : (
              <select
                id="enroll-channel"
                value={channelId}
                onChange={(e) => {
                  setChannelId(e.target.value);
                  setCollision(null);
                  setError(null);
                }}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {platformLabel(c.label)}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <ActionError message={error} />

        {collision && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-900/50 dark:bg-amber-900/20">
            <p className="font-medium text-amber-900 dark:text-amber-300">
              Ya está en {collision.with.map((w) => w.sequenceName).join(", ")} por este mismo canal.
            </p>
            <p className="mt-1 text-amber-800/80 dark:text-amber-400/80">
              Si lo inscribís igual va a recibir mensajes de las dos. Después vas a poder
              decidir qué hacer desde la pantalla de la secuencia.
            </p>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-input px-3 py-2 text-sm hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            onClick={() => submit(Boolean(collision))}
            disabled={!ready || pending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            {collision ? "Inscribir igual" : "Inscribir"}
          </button>
        </div>
      </div>
    </div>
  );
}
