-- ============================================================
-- 00310_event_redirect_https (7/11/2026)
--
-- Auditoria de seguridad. `event_types.success_redirect_url` solo se validaba
-- en la Server Action (`isSafeRedirectUrl`, solo https). La politica
-- `event_types_update` deja que quien maneja su evento lo edite directo por
-- la API (PostgREST), y la pagina publica de reserva hace
-- `window.location.href = redirectUrl`: un `javascript:...` guardado asi
-- corria en el dominio de la app para cualquiera que reservara (y la sesion
-- de Supabase vive en cookies que el navegador puede leer).
--
-- Ahora la base exige lo mismo que la pantalla: NULL o https://. El codigo
-- ademas vuelve a validar al leer y en el navegador.
--
-- NOT VALID: frena toda escritura nueva sin fallar si un clon ya tuviera una
-- fila vieja rara; despues se intenta validar lo que hay (en produccion no
-- habia ninguna fila con redirect, comprobado el 7/11/2026). Si la
-- validacion falla, avisa y la restriccion igual queda activa para lo nuevo.
--
-- Idempotente. Puede ir antes o despues del deploy.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_types_success_redirect_https'
      AND conrelid = 'public.event_types'::regclass
  ) THEN
    ALTER TABLE public.event_types
      ADD CONSTRAINT event_types_success_redirect_https
      CHECK (success_redirect_url IS NULL OR success_redirect_url ~* '^https://[^/@\s]+') NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  ALTER TABLE public.event_types VALIDATE CONSTRAINT event_types_success_redirect_https;
EXCEPTION WHEN check_violation THEN
  RAISE WARNING '00310: hay eventos con una redireccion que no es https; la restriccion vale para lo nuevo. Revisar: SELECT id, success_redirect_url FROM public.event_types WHERE success_redirect_url !~* ''^https://'';';
END $$;
