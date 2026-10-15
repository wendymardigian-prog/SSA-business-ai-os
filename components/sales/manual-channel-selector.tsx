"use client";

import { useState } from "react";
import { searchContactsForSale, type SaleContactOption } from "@/lib/actions/sales";
import { searchAdsForSale, searchPiecesForSale, type PieceOption } from "@/lib/actions/sales-attribution";
import { SearchPicker } from "@/components/sales/search-picker";
import type { WizardMember } from "@/components/sales/wizard/types";
import { fieldInput } from "@/components/content/dialog";
import type { AdOption } from "@/lib/sales/ad-options";
import { MEDIUMS, MEDIUM_LABELS, SOURCES, SOURCE_LABELS } from "@/lib/contacts/taxonomy";
import { draftToChoice, EMPTY_DRAFT, type DraftKind, type ManualDraft } from "@/lib/sales/manual-channel-draft";
import { MANUAL_CHANNELS, ORGANIC_NETWORKS, ORGANIC_NETWORK_LABELS, PAID_NETWORKS, type ManualChoiceInput } from "@/lib/sales/manual-channel";
import { cn } from "@/lib/utils";

const NETWORK_PAID_LABELS = { facebook: "Facebook", instagram: "Instagram" } as const;

/**
 * "Cargar a mano" en dos pasos (Extra I, F47): primero el CANAL (contenido orgánico, anuncio, referido, evento o
 * llamada en frío, otro) y después el detalle de ese canal. "Avanzado" deja los campos UTM de siempre.
 *
 * No decide nada: el borrador y su validación viven en `lib/sales/manual-channel-draft.ts`. El servidor crea el
 * toque al guardar la venta y vuelve a comprobar que todo lo elegido es de este workspace.
 */
export function ManualChannelSelector({ members, onUse }: { members: WizardMember[]; onUse: (choice: ManualChoiceInput, label: string) => void }) {
  const [draft, setDraft] = useState<ManualDraft>(EMPTY_DRAFT);
  const result = draftToChoice(draft);
  const set = (patch: Partial<ManualDraft>) => setDraft((prev) => ({ ...prev, ...patch }));
  const pick = (kind: DraftKind) => setDraft({ ...EMPTY_DRAFT, kind });

  return (
    <div className="space-y-4">
      <div role="group" aria-label="De dónde vino" className="space-y-1.5">
        <p className="text-xs font-medium">1. ¿De dónde vino?</p>
        <div className="flex flex-wrap gap-1.5">
          {MANUAL_CHANNELS.map((c) => (
            <button
              key={c.kind}
              type="button"
              aria-pressed={draft.kind === c.kind}
              onClick={() => pick(c.kind)}
              className={cn("rounded-lg border px-3 py-1.5 text-xs font-medium", draft.kind === c.kind ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent")}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {draft.kind && draft.kind !== "utm" && <p className="text-xs font-medium">2. {MANUAL_CHANNELS.find((c) => c.kind === draft.kind)?.detail}</p>}

      {draft.kind === "organic" && (
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium">Red</span>
            <select className={fieldInput} value={draft.organicNetwork} onChange={(e) => set({ organicNetwork: e.target.value as ManualDraft["organicNetwork"] })}>
              <option value="">Elegí…</option>
              {ORGANIC_NETWORKS.map((n) => (
                <option key={n} value={n}>
                  {ORGANIC_NETWORK_LABELS[n]}
                </option>
              ))}
            </select>
          </label>
          {!draft.unknownPiece && (
            <SearchPicker<PieceOption>
              label="Pieza de contenido"
              placeholder="Buscá por título o por código"
              search={searchPiecesForSale}
              getKey={(p) => p.id}
              renderOption={(p) => (
                <>
                  <span className="font-medium">{p.title}</span>
                  <span className="text-xs text-muted-foreground">Código {p.code}</span>
                </>
              )}
              selectedLabel={draft.piece?.title ?? null}
              onPick={(p) => set({ piece: { contentPostId: p.id, title: p.title } })}
              onClear={() => set({ piece: null })}
            />
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.unknownPiece} onChange={(e) => set({ unknownPiece: e.target.checked, piece: e.target.checked ? null : draft.piece })} /> No sé qué pieza
          </label>
        </div>
      )}

      {draft.kind === "paid" && (
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium">Red</span>
            <select className={fieldInput} value={draft.paidNetwork} onChange={(e) => set({ paidNetwork: e.target.value as ManualDraft["paidNetwork"] })}>
              <option value="">Elegí…</option>
              {PAID_NETWORKS.map((n) => (
                <option key={n} value={n}>
                  {NETWORK_PAID_LABELS[n]}
                </option>
              ))}
            </select>
          </label>
          {!draft.unknownAd && (
            <SearchPicker<AdOption>
              label="Anuncio del catálogo de Meta"
              placeholder="Buscá por nombre o id de campaña, conjunto o anuncio"
              search={searchAdsForSale}
              getKey={(a) => a.key}
              renderOption={(a) => (
                <>
                  <span className="font-medium">{a.label}</span>
                  <span className="text-xs text-muted-foreground">{a.level === "ad" ? "Anuncio" : a.level === "adset" ? "Conjunto" : "Campaña"}</span>
                </>
              )}
              selectedLabel={draft.ad?.label ?? null}
              onPick={(a) => set({ ad: { adId: a.adId, adsetId: a.adsetId, campaignId: a.campaignId, label: a.label } })}
              onClear={() => set({ ad: null })}
              emptyText="No encontré nada en el catálogo. Si no tenés acceso al catálogo de Meta, marcá «No sé qué anuncio»."
            />
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.unknownAd} onChange={(e) => set({ unknownAd: e.target.checked, ad: e.target.checked ? null : draft.ad })} /> No sé qué anuncio
          </label>
        </div>
      )}

      {draft.kind === "referral" && (
        <div className="space-y-3">
          <div role="group" aria-label="Quién lo recomendó" className="flex gap-1.5">
            {(["contact", "member"] as const).map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={draft.referrerMode === type}
                onClick={() => set({ referrer: null, referrerMode: type })}
                className={cn("rounded-lg border px-3 py-1.5 text-xs font-medium", draft.referrerMode === type ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent")}
              >
                {type === "contact" ? "Un contacto" : "Alguien del equipo"}
              </button>
            ))}
          </div>
          {draft.referrerMode === "contact" ? (
            <SearchPicker<SaleContactOption>
              label="Contacto que lo recomendó"
              placeholder="Buscar por nombre, email o teléfono"
              search={searchContactsForSale}
              getKey={(c) => c.id}
              renderOption={(c) => (
                <>
                  <span className="font-medium">{c.name}</span>
                  {(c.email ?? c.phone) && <span className="text-xs text-muted-foreground">{c.email ?? c.phone}</span>}
                </>
              )}
              selectedLabel={draft.referrer?.type === "contact" ? draft.referrer.name : null}
              onPick={(c) => set({ referrer: { type: "contact", id: c.id, name: c.name } })}
              onClear={() => set({ referrer: null })}
            />
          ) : (
            <label className="block space-y-1">
              <span className="text-xs font-medium">Persona del equipo</span>
              <select
                className={fieldInput}
                value={draft.referrer?.type === "member" ? draft.referrer.id : ""}
                onChange={(e) => {
                  const member = members.find((m) => m.id === e.target.value);
                  set({ referrer: member ? { type: "member", id: member.id, name: member.name } : null });
                }}
              >
                <option value="">Elegí…</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {draft.kind === "event" && (
        <label className="block space-y-1">
          <span className="text-xs font-medium">Nombre del evento</span>
          <input className={fieldInput} maxLength={120} value={draft.eventName} onChange={(e) => set({ eventName: e.target.value })} placeholder="Ej.: Expo Marketing 2026" />
        </label>
      )}

      {draft.kind === "other" && (
        <label className="block space-y-1">
          <span className="text-xs font-medium">Detalle (opcional)</span>
          <input className={fieldInput} maxLength={200} value={draft.otherNote} onChange={(e) => set({ otherNote: e.target.value })} placeholder="Ej.: Lo conoció en un cumpleaños" />
        </label>
      )}

      <div className="border-t border-border pt-3">
        <button
          type="button"
          aria-expanded={draft.kind === "utm"}
          onClick={() => (draft.kind === "utm" ? setDraft(EMPTY_DRAFT) : pick("utm"))}
          className="text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          {draft.kind === "utm" ? "Cerrar «Avanzado»" : "Avanzado: cargar los campos UTM"}
        </button>
        {draft.kind === "utm" && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium">Fuente</span>
              <select className={fieldInput} value={draft.utm.source} onChange={(e) => set({ utm: { ...draft.utm, source: e.target.value } })}>
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
              <select className={fieldInput} value={draft.utm.medium} onChange={(e) => set({ utm: { ...draft.utm, medium: e.target.value } })}>
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
                <input value={draft.utm[key]} maxLength={200} onChange={(e) => set({ utm: { ...draft.utm, [key]: e.target.value } })} className={fieldInput} />
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!result.ready}
          onClick={() => result.ready && onUse(result.choice, result.label)}
          className="h-8 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Usar esta atribución
        </button>
        {!result.ready && draft.kind && <span className="text-xs text-muted-foreground">{result.hint}</span>}
        {result.ready && <span className="text-xs text-muted-foreground">{result.label}</span>}
      </div>
    </div>
  );
}
