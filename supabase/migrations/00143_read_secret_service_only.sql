-- ============================================================
-- MIGRACION 00143 — read_secret SOLO PARA EL SERVIDOR
-- ============================================================
-- *** Se aplica DESPUES de desplegar el codigo que lee las claves con el
-- cliente de servicio, y de comprobar en produccion que la bandeja, WhatsApp,
-- Ads y "Actualizar cuentas" de Meta siguen andando. Con el codigo viejo,
-- esta migracion deja esas pantallas sin poder leer sus claves. ***
--
-- El problema: `read_secret` (00017) estaba concedida a `authenticated` y
-- adentro solo pedia Owner/Admin (`assert_can_manage_secrets`). Como algunas
-- rutas del servidor la llamaban con la sesion del usuario, la base no podia
-- distinguir "el servidor leyendo para operar" de "un Admin con la consola
-- del navegador": cualquier Admin podia leer en texto plano TODAS las claves
-- del workspace, incluidos los tokens de Google Calendar de otra persona
-- (`oauth_google_calendar_<connectionId>_*`).
--
-- El arreglo: solo `service_role` ejecuta `read_secret`. El servidor lee con
-- el cliente de servicio (`createServiceClient`), que nunca llega al
-- navegador. QUIEN puede usar una clave lo sigue decidiendo el que llama: el
-- guard de Admin de cada ruta, o la RLS de la conversacion en la bandeja.
--
-- Esto revierte a proposito lo que decia la cabecera de la 00045 ("sus
-- llamadores usan el cliente del usuario a proposito"): esa decision dejaba
-- la puerta abierta para el navegador, y para LEER no hay forma de cerrarla
-- sin sacar el permiso. `store_secret`, `delete_secret` y `list_secret_names`
-- NO cambian: ninguna devuelve un valor, y la pantalla de Integraciones las
-- sigue usando con la sesion (guardar y borrar siguen pidiendo Owner/Admin).
--
-- Desde aca nadie lee una clave desde el navegador, tampoco el Owner.
--
-- PARA VOLVER ATRAS (los permisos de la 00017, letra por letra):
--
--   GRANT EXECUTE ON FUNCTION public.read_secret(text, uuid) TO authenticated, service_role;
--
-- Idempotente.
-- ============================================================

DO $$
BEGIN
  REVOKE ALL ON FUNCTION public.read_secret(text, uuid) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.read_secret(text, uuid) TO service_role;

  -- Guarda: si `authenticated` la siguiera pudiendo ejecutar por otro camino
  -- (un GRANT a PUBLIC o a un rol del que herede), la migracion no sirvio.
  IF has_function_privilege('authenticated', 'public.read_secret(text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated sigue pudiendo ejecutar read_secret despues del REVOKE';
  END IF;
  IF has_function_privilege('anon', 'public.read_secret(text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon sigue pudiendo ejecutar read_secret despues del REVOKE';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.read_secret(text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role perdio el permiso de ejecutar read_secret';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.read_secret(text, uuid) IS
  'Devuelve el valor desencriptado de un secret del workspace. Solo service_role (00143): '
  'el servidor lee con createServiceClient(); ningun usuario, tampoco el Owner, puede leer una clave desde el navegador.';
