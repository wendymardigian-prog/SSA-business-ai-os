"use client";

import { PhoneIncoming, PhoneMissed, Video } from "lucide-react";
import { callLabel, isUnansweredCall, type CallRow } from "@/lib/whatsapp-calls/event";
import { cn } from "@/lib/utils";

/**
 * Una llamada de WhatsApp en el hilo (00258): una linea centrada, no una
 * burbuja. No es un mensaje: no la ve el agente ni dispara flujos.
 */
export function CallLine({ call }: { call: CallRow }) {
  const unanswered = isUnansweredCall(call.status);
  const Icon = call.isVideo ? Video : unanswered ? PhoneMissed : PhoneIncoming;
  const time = new Date(call.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="flex justify-center" role="note">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium",
          unanswered ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {callLabel(call)} · <span suppressHydrationWarning>{time}</span>
      </span>
    </div>
  );
}
