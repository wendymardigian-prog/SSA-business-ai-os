"use client";

import { useState } from "react";
import { sendMyTestWhatsApp } from "@/lib/actions/account";
import { secondaryButtonClass } from "./account-card";

/** "Mandarme un WhatsApp de prueba", al lado del guardado del teléfono. */
export function WhatsAppTestButton() {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setError(null);
    setState("sending");
    const result = await sendMyTestWhatsApp();
    if (!result.ok) {
      setError(result.error);
      setState("idle");
      return;
    }
    setState("sent");
  }

  return (
    <>
      <button type="button" className={secondaryButtonClass} disabled={state === "sending"} onClick={send}>
        {state === "sending" ? "Mandando…" : "Mandarme un WhatsApp de prueba"}
      </button>
      {state === "sent" && (
        <span role="status" className="text-xs text-emerald-600 dark:text-emerald-400">
          Te lo mandamos ✓
        </span>
      )}
      {error && (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </>
  );
}
