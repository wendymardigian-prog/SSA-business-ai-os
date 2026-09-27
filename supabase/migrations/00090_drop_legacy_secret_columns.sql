-- ============================================================
-- 00090: borrar las columnas de secretos viejas
-- ============================================================
--
-- ⛔ ESTA MIGRACION NO ESTA APLICADA, Y NO HAY QUE APLICARLA TODAVIA.
--
-- Borra las tres columnas donde vivian los secretos antes de Vault:
--
--   - workspaces.late_api_key_encrypted  (la API key de Zernio)
--   - workspaces.webhook_secret          (el secreto del webhook de Zernio)
--   - channels.webhook_secret            (idem, por canal)
--
-- Por que no se aplica: **la clave de Zernio de este negocio todavia vive
-- en `late_api_key_encrypted`**. Es de donde la lee el fallback de
-- `getZernioApiKey`, y por lo tanto de donde la lee el sistema cada vez que
-- manda un mensaje por Instagram. Aplicar esto hoy deja la bandeja sin
-- poder responder y el agente sin poder contestar, en el momento.
--
-- ── Como aplicarla, cuando corresponda ───────────────────────────────────
--
-- 1. En Ajustes → Integraciones, abrir la card de Zernio y apretar
--    "Migrar a Vault". Copia la API key y el secreto del webhook desde las
--    columnas viejas a Vault, sin mostrarlos ni loguearlos.
-- 2. Comprobar que la card de Zernio deja de mostrar el aviso "La clave
--    todavia no esta en Vault".
-- 3. Mandar un mensaje de prueba desde la bandeja y ver que sale. Eso
--    prueba que el sistema esta leyendo de Vault y no de la columna.
-- 4. Recien ahi aplicar esta migracion.
-- 5. Volver a mandar un mensaje. Si sale, listo.
--
-- Hay dos scripts que tambien leen estas columnas como fallback y dejan de
-- necesitarlo despues del paso 1:
--   - scripts/backfill-zernio-messages.mjs
--   - scripts/enrich-instagram-contacts.mjs
--
-- ── Por que se escribe igual ─────────────────────────────────────────────
--
-- Porque el trabajo de decidir QUE borrar y en QUE orden ya esta hecho, y
-- escribirlo seis meses despues significa volver a averiguar quien leia
-- cada columna. Asi el dia que se migre, es una linea de comando.

-- Se comprueba primero que no quede nada adentro: aplicar esto con una
-- clave todavia en la columna es perder la clave.
DO $$
DECLARE v_pendientes integer;
BEGIN
  SELECT count(*) INTO v_pendientes
  FROM public.workspaces
  WHERE late_api_key_encrypted IS NOT NULL OR webhook_secret IS NOT NULL;

  IF v_pendientes > 0 THEN
    RAISE EXCEPTION
      'Hay % workspace(s) con secretos todavia en las columnas viejas. Apreta "Migrar a Vault" en Integraciones antes de aplicar esta migracion.',
      v_pendientes;
  END IF;

  SELECT count(*) INTO v_pendientes
  FROM public.channels
  WHERE webhook_secret IS NOT NULL;

  IF v_pendientes > 0 THEN
    RAISE EXCEPTION
      'Hay % canal(es) con el secreto del webhook todavia en la columna vieja.',
      v_pendientes;
  END IF;
END $$;

ALTER TABLE public.workspaces DROP COLUMN IF EXISTS late_api_key_encrypted;
ALTER TABLE public.workspaces DROP COLUMN IF EXISTS webhook_secret;
ALTER TABLE public.channels   DROP COLUMN IF EXISTS webhook_secret;
