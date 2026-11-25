-- 00530 · Conector MCP (25/11/2026, traído de RER-BAIOS 00503). Aditiva: puede ir antes o después del deploy; se
-- aplica ANTES para poder probar el conector de punta a punta.
--
-- QUÉ: cada persona conecta Claude (u otra app) por MCP con el servidor OAuth de Supabase; el access token es SU JWT,
-- así que la RLS de siempre decide qué ve. Esta migración suma:
--   1. `public.mcp_connections`: el negocio de cada conexión (persona + app conectada), elegido en el consentimiento.
--      La lee cada persona (las suyas); la escribe SOLO el servidor (sin políticas de escritura).
--   2. `public.mcp_readonly_sql(p_workspace_id, p_query)`: SQL de SOLO LECTURA para el Owner del negocio. Es SECURITY
--      INVOKER (corre con la sesión de la persona: manda la RLS, no ve `vault`, `private` ni `auth`) y antes de correr
--      la consulta pasa la transacción a SOLO LECTURA (`SET LOCAL transaction_read_only = on`: pasar a solo lectura se
--      puede en cualquier momento, volver atrás no). Nada que escriba puede correr: ni un DELETE en un WITH, ni una
--      función que escriba, ni un nextval. Es VOLATILE porque una función STABLE no puede hacer SET.
--   3. `public.mcp_used_confirmations`: la confirmación de una acción delicada se usa UNA sola vez (la firma del token
--      queda anotada; un segundo uso choca con la clave). Solo el servidor.
-- No toca ninguna tabla ni función existente. Banda 00530-00534 de esta tanda.

-- ─── 1. Conexiones ────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mcp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- El `client_id` del token OAuth (la app conectada). 'session' = un token de sesión sin cliente (pruebas locales).
  client_id text NOT NULL,
  client_name text,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mcp_connections_user_client_key') THEN
    ALTER TABLE public.mcp_connections ADD CONSTRAINT mcp_connections_user_client_key UNIQUE (user_id, client_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mcp_connections_client_id_len') THEN
    ALTER TABLE public.mcp_connections ADD CONSTRAINT mcp_connections_client_id_len CHECK (char_length(client_id) BETWEEN 1 AND 200);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mcp_connections_client_name_len') THEN
    ALTER TABLE public.mcp_connections ADD CONSTRAINT mcp_connections_client_name_len CHECK (client_name IS NULL OR char_length(client_name) <= 200);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mcp_connections_workspace ON public.mcp_connections (workspace_id);

ALTER TABLE public.mcp_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mcp_connections_select_own ON public.mcp_connections;
CREATE POLICY mcp_connections_select_own ON public.mcp_connections
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.mcp_connections FROM anon, authenticated;
GRANT SELECT ON public.mcp_connections TO authenticated;
GRANT ALL ON public.mcp_connections TO service_role;

-- ─── 2. SQL de solo lectura del Owner ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mcp_readonly_sql(p_workspace_id uuid, p_query text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path TO ''
SET statement_timeout TO '15s'
AS $function$
DECLARE
  q text := btrim(coalesce(p_query, ''));
  out jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members m
     WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid() AND m.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'MCP_SQL_OWNER: solo el Owner del negocio puede usar SQL' USING ERRCODE = '42501';
  END IF;

  q := regexp_replace(q, ';\s*$', '');
  IF q = '' OR char_length(q) > 20000 THEN
    RAISE EXCEPTION 'MCP_SQL_INVALID: la consulta está vacía o es demasiado larga' USING ERRCODE = '22023';
  END IF;
  IF position(';' IN q) > 0 THEN
    RAISE EXCEPTION 'MCP_SQL_INVALID: una sola consulta, sin punto y coma en el medio' USING ERRCODE = '22023';
  END IF;
  IF q !~* '^\s*(select|with)\s' THEN
    RAISE EXCEPTION 'MCP_SQL_INVALID: solo SELECT o WITH' USING ERRCODE = '22023';
  END IF;

  -- Desde aquí, la transacción entera es de solo lectura.
  SET LOCAL transaction_read_only = on;
  EXECUTE format('SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (SELECT * FROM (%s) AS q LIMIT 1000) AS t', q) INTO out;
  RETURN out;
END;
$function$;

REVOKE ALL ON FUNCTION public.mcp_readonly_sql(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_readonly_sql(uuid, text) TO authenticated, service_role;

-- ─── 3. Confirmaciones usadas ─────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mcp_used_confirmations (
  signature text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  used_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mcp_used_confirmations_used_at ON public.mcp_used_confirmations (used_at);
ALTER TABLE public.mcp_used_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_used_confirmations FROM anon, authenticated;
GRANT ALL ON public.mcp_used_confirmations TO service_role;
