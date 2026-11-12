-- ============================================================================
-- Permisos por defecto
--
-- Corre primero, antes de que exista ninguna tabla.
--
-- Le da a los tres roles que usa la app (anon, authenticated y service_role) acceso
-- automatico a cada tabla, secuencia y funcion nueva del esquema public. Supabase ya
-- no lo hace solo en los proyectos nuevos: sin esto, las tablas nacerian sin acceso
-- para nadie.
--
-- Despues, cada archivo le quita a cada tabla y a cada funcion lo que no le corresponde
-- (por ejemplo, las tablas que solo toca el servidor).
-- ============================================================================

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

-- Despues: a las tablas nuevas no se les da TRUNCATE, TRIGGER ni REFERENCES para anon y authenticated.
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
