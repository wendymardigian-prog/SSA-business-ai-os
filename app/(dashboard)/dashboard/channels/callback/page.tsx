"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { CHANNELS_RETURN_KEY, returnTargetOrDefault } from "@/lib/channels/return-to";

export default function ChannelCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"syncing" | "success" | "error">("syncing");
  const [message, setMessage] = useState("Sincronizando tu nuevo canal...");

  useEffect(() => {
    // A donde volver: el lugar desde donde se salio a conectar (la pestaña
    // Cuentas de Zernio, por ejemplo), o la pagina de canales.
    let target = returnTargetOrDefault(null);
    try {
      target = returnTargetOrDefault(window.sessionStorage.getItem(CHANNELS_RETURN_KEY));
      window.sessionStorage.removeItem(CHANNELS_RETURN_KEY);
    } catch {
      // Sin sessionStorage: la pagina de canales.
    }

    async function syncAndRedirect() {
      const connected = searchParams.get("connected");

      if (!connected) {
        setStatus("error");
        setMessage("La conexión se canceló o falló.");
        setTimeout(() => router.push(target), 2000);
        return;
      }

      try {
        const res = await fetch("/api/v1/channels/sync", { method: "POST" });
        const data = await res.json();

        if (!res.ok || data.error) {
          setStatus("error");
          setMessage(data.error || "No pude sincronizar los canales.");
          setTimeout(() => router.push(target), 2000);
          return;
        }

        const { created } = data.synced;
        setStatus("success");
        setMessage(
          created > 0
            ? `¡Cuenta de ${connected} conectada con éxito!`
            : "¡Cuenta conectada! El canal ya estaba sincronizado."
        );
        setTimeout(() => router.push(target), 1500);
      } catch {
        setStatus("error");
        setMessage("No pude sincronizar. Podés intentarlo a mano.");
        setTimeout(() => router.push(target), 2000);
      }
    }

    syncAndRedirect();
  }, [router, searchParams]);

  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center">
        {status === "syncing" && (
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        )}
        {status === "success" && (
          <CheckCircle2 className="h-8 w-8 text-green-500" />
        )}
        {status === "error" && (
          <XCircle className="h-8 w-8 text-red-500" />
        )}
        <p className="text-sm font-medium text-foreground">{message}</p>
        <p className="text-xs text-muted-foreground">Volviendo a canales...</p>
      </div>
    </div>
  );
}
