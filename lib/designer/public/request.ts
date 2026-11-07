/**
 * La lectura del link público compartida por la página y sus metadatos (una sola consulta por pedido).
 * Solo servidor.
 */

import { cache } from "react";
import { createServiceClient } from "@/lib/supabase/server";
import { loadPublicDesign, type PublicRecord } from "./load";

export const getPublicRecord = cache(async (rawCode: string): Promise<PublicRecord | null> => {
  const service = await createServiceClient();
  return loadPublicDesign(service, rawCode);
});
