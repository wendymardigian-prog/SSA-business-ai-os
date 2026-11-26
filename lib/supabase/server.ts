import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/types/database";
import { currentIdentity } from "@/lib/request-identity";
import { retryingFetch } from "@/lib/supabase/fetch-retry";

export async function createClient() {
  // Un pedido del conector MCP: la sesión es el token de la persona, no una cookie (`lib/request-identity.ts`).
  const identity = currentIdentity();
  if (identity) {
    const client = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${identity.jwt}` }, fetch: retryingFetch },
        cookies: {
          getAll() {
            return [];
          },
          setAll() {},
        },
      }
    );
    // Sin sesión guardada, `auth.getUser()` / `auth.getClaims()` sin argumento no saben de quién se trata: el código
    // de siempre los llama así (rutas de /api/v1, acciones). Se les pasa el token de la persona por defecto.
    const auth = client.auth;
    const getUser = auth.getUser.bind(auth);
    const getClaims = auth.getClaims.bind(auth);
    auth.getUser = ((jwt?: string) => getUser(jwt ?? identity.jwt)) as typeof auth.getUser;
    auth.getClaims = ((jwt?: string, options?: Parameters<typeof getClaims>[1]) => getClaims(jwt ?? identity.jwt, options)) as typeof auth.getClaims;
    return client;
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: retryingFetch },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component. Can be ignored if middleware refreshes sessions.
          }
        },
      },
    }
  );
}

export async function createServiceClient() {
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      global: { fetch: retryingFetch },
      cookies: {
        getAll() {
          return [];
        },
        setAll() {},
      },
    }
  );
}
