-- ============================================================
-- 00000_default_privileges.sql
--
-- Corre PRIMERO, antes de que exista ninguna tabla.
--
-- Hasta mayo de 2026, Supabase le daba acceso automatico a cada tabla,
-- secuencia y funcion nueva del esquema `public` a los tres roles que usa la
-- app: `anon`, `authenticated` y `service_role`. Desde el 30/5/2026 los
-- proyectos NUEVOS ya no lo hacen (y el 30/10/2026 el cambio llega a los
-- proyectos existentes, solo para objetos nuevos):
-- https://supabase.com/changelog/45329
--
-- Estas migraciones se escribieron con el comportamiento viejo: casi no
-- tienen GRANT y tienen ~230 `REVOKE ALL` que QUITAN permisos a tablas que
-- solo debe tocar el servidor (scheduled_jobs, costos de agent_runs, ...).
-- En un proyecto nuevo, sin esto, las tablas nacen sin acceso para nadie:
-- los cron dan 500 y el login falla.
--
-- Restaurar el acceso automatico ANTES de crear las tablas deja los permisos
-- exactamente como en una base armada con el comportamiento viejo: primero
-- se da todo, y despues cada migracion quita lo que debe quitar.
--
-- Idempotente. En una base que ya existe (por ejemplo, la de produccion) no
-- cambia ningun permiso ya dado: solo afecta a las tablas que se creen de
-- ahora en adelante. Si esa base ya tenia aplicadas migraciones posteriores,
-- la CLI protesta por este numero: marcarla como aplicada con
--   supabase migration repair --status applied 00000
--
-- Corre como `postgres` o como el rol temporal de la CLI. Se cubren los dos:
-- el rol que ejecuta y, si es otro, `postgres`.
-- ============================================================

DO $$
DECLARE
  roles constant text := 'anon, authenticated, service_role';
BEGIN
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ' || roles;
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ' || roles;
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO ' || roles;

  IF current_user <> 'postgres' THEN
    BEGIN
      EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO ' || roles;
      EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO ' || roles;
      EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO ' || roles;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'No se pudo fijar el acceso por defecto para el rol postgres: se uso solo el del rol actual (%).', current_user;
    END;
  END IF;
END
$$;
