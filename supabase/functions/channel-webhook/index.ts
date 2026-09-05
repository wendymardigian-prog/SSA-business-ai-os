/**
 * Receptor publico de los webhooks de los canales.
 *
 * Existe porque la app corre en local y los proveedores necesitan una URL
 * publica a la que pegarle. Supabase ya expone una, asi que la usamos:
 *
 *   https://<project-ref>.supabase.co/functions/v1/channel-webhook/evolution
 *   https://<project-ref>.supabase.co/functions/v1/channel-webhook/zernio
 *
 * Alcance a proposito acotado: valida quien llama, evita procesar dos veces el
 * mismo evento y guarda. Nada de logica de negocio — eso vive en el Next.js.
 *
 * Deploy:  supabase functions deploy channel-webhook
 * Secrets: supabase secrets set EVOLUTION_WEBHOOK_TOKEN=...
 *          (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase)
 */

import { serviceClient } from "../_shared/db.ts";
import { handleEvolution } from "./evolution.ts";
import { handleZernio } from "./zernio.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "solo POST" }, 405);
  }

  // .../functions/v1/channel-webhook/<canal>
  const route = new URL(req.url).pathname.split("/").filter(Boolean).pop();

  let body: string;
  try {
    body = await req.text();
  } catch {
    return json({ error: "no pude leer el cuerpo" }, 400);
  }

  try {
    const supabase = serviceClient();

    switch (route) {
      case "evolution":
        return await handleEvolution(supabase, body, req.headers);
      case "zernio":
        return await handleZernio(supabase, body, req.headers);
      default:
        return json({ error: `ruta desconocida: ${route}` }, 404);
    }
  } catch (err) {
    // Nunca devolvemos el detalle: quien llama es un webhook publico.
    console.error(`[channel-webhook/${route}]`, err);
    return json({ error: "error interno" }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
