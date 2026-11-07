-- ============================================================================
-- 00315 — Sin TRUNCATE, TRIGGER ni REFERENCES para anon y authenticated, y
--         claim_agent_reply solo para el servidor
-- ============================================================================
-- 1. Permisos de tabla de mas.
--
--    La 00000 le da `GRANT ALL ON TABLES` por defecto a anon, authenticated y
--    service_role (asi se armo la base con el comportamiento viejo de Supabase).
--    "ALL" incluye tres permisos que la app nunca usa con la sesion de una
--    persona ni con la anon key:
--
--      * TRUNCATE: vacia una tabla entera SIN pasar por la RLS (la RLS no
--        aplica a TRUNCATE). PostgREST no lo expone, pero cualquier camino que
--        ejecute SQL con esos roles podria borrar todo.
--      * TRIGGER: crear disparadores sobre la tabla.
--      * REFERENCES: crear claves foraneas que apunten a la tabla.
--
--    Lectura del catalogo de produccion (7/11/2026, solo lectura): anon los tenia
--    en 65 tablas de public y authenticated en 82-84. Se revocan en TODAS las
--    tablas (y vistas) que existen, y en los permisos por defecto, para que las
--    tablas que se creen despues no los reciban. SELECT, INSERT, UPDATE y DELETE
--    NO se tocan: los sigue decidiendo cada migracion y la RLS. service_role no
--    se toca (es el servidor).
--
--    Los permisos por defecto existen para dos duenos: el que corre las
--    migraciones (postgres o el rol de la CLI) y supabase_admin. Del de
--    supabase_admin solo se puede cambiar lo suyo si quien corre es ese rol;
--    si no, queda un NOTICE (las tablas de la app las crean las migraciones, no
--    supabase_admin).
--
-- 2. claim_agent_reply (00077) es SECURITY DEFINER y no chequea quien llama:
--    con authenticated se podia tomar el lock de cualquier conversacion y saber
--    si tiene una respuesta posterior a una fecha. La 00077 le saco PUBLIC y
--    anon, pero authenticated la seguia ejecutando por el permiso por defecto.
--    La unica que la llama es `claimAgentReply` (lib/agent/reply-check.ts),
--    desde el turno del agente, que corre en el cron con el cliente de servicio
--    (`/api/cron/agent-bursts`). Se le saca authenticated.
--
-- Idempotente: REVOKE de algo que no esta no falla.
--
-- Volver atras (no hace falta para ningun flujo de la app):
--   GRANT TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public TO anon, authenticated;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.claim_agent_reply(uuid, timestamptz, uuid) TO authenticated;
-- (Ojo: esas dos lineas de ALL vuelven a dar tambien SELECT/INSERT/UPDATE/DELETE
-- por defecto, que es lo que la 00000 daba.)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1a. Las tablas que ya existen
-- ----------------------------------------------------------------------------

REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1b. Las que se creen de aca en adelante
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  roles constant text := 'anon, authenticated';
BEGIN
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM ' || roles;

  IF current_user <> 'postgres' THEN
    BEGIN
      EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM ' || roles;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'No se pudo cambiar el acceso por defecto del rol postgres: se cambio solo el del rol actual (%).', current_user;
    END;
  END IF;

  IF current_user <> 'supabase_admin' AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    BEGIN
      EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM ' || roles;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'El acceso por defecto de supabase_admin no se puede cambiar desde %: queda como esta.', current_user;
    END;
  END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 2. claim_agent_reply: solo el servidor
-- ----------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.claim_agent_reply(uuid, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_agent_reply(uuid, timestamptz, uuid) TO service_role;
