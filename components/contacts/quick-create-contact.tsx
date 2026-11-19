"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { DialogField, fieldInput } from "@/components/content/dialog";
import { PhoneInput } from "@/components/ui/phone-input";
import type { ManualContactInput, QuickContactResult } from "@/lib/contacts/manual-contact";

/**
 * El alta rápida de un contacto (nombre, email, teléfono) dentro de un modal: el asistente de venta y
 * «Nuevo servicio». Cada módulo pasa su Server Action (`create`), que chequea su permiso y usa la regla
 * única: si ya existía, devuelve ese contacto con un aviso.
 */
export function QuickCreateContact({
  create,
  onCancel,
  onCreated,
}: {
  create: (input: ManualContactInput) => Promise<QuickContactResult>;
  onCancel: () => void;
  onCreated: (c: { id: string; name: string; notice: string | null }) => void;
}) {
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const r = await create({ name: form.name, email: form.email || undefined, phone: form.phone || undefined });
      if (!r.ok) return setError(r.error);
      onCreated({ id: r.contactId, name: form.name.trim() || "Contacto", notice: r.notice });
    });
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <DialogField label="Nombre"><input className={fieldInput} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="off" /></DialogField>
        <DialogField label="Email"><input type="email" className={fieldInput} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="off" /></DialogField>
        <DialogField label="Teléfono"><PhoneInput label="Teléfono" value={form.phone} onChange={(next) => setForm({ ...form, phone: next })} /></DialogField>
      </div>
      <p className="text-[11px] text-muted-foreground">Hace falta el nombre y al menos un email o un teléfono. Si ya existía, uso ese contacto.</p>
      {error && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={pending} onClick={submit} className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50">
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Crear y usar
        </button>
        <button type="button" onClick={onCancel} className="h-8 rounded-lg border border-border px-3 text-xs hover:bg-accent">Cancelar</button>
      </div>
    </div>
  );
}
