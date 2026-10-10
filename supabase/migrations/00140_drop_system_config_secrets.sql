-- ============================================================
-- MIGRACION 00140 — BORRAR app_url Y cron_secret DE system_config
-- ============================================================
-- *** BORRA. Se aplica DESPUES de la 00139 y de comprobar en produccion que
-- los cron siguen respondiendo 200 leyendo de Vault. ***
--
-- Desde la 00139, `private.call_app_cron` lee `system:app_url` y
-- `system:cron_secret` de Vault. Las filas viejas de `private.system_config`
-- quedaron como respaldo, con el secreto en texto plano. Esta migracion las
-- borra. La fila `draft_alerts_since` (00072) no es un secreto y se queda.
--
-- GUARDA: si una fila vieja existe y Vault no tiene ese nombre, aborta: borrar
-- seria perder el unico lugar donde esta el valor. En un clon nuevo no hay
-- filas viejas, asi que pasa sin hacer nada.
--
-- Antes de aplicarla, comprobar que Vault tiene el mismo valor que la fila
-- vieja (devuelve solo true/false, nunca el valor):
--
--   SELECT c.key, s.decrypted_secret = c.value AS coincide
--   FROM private.system_config c
--   JOIN vault.decrypted_secrets s ON s.name = 'system:' || c.key
--   WHERE c.key IN ('app_url', 'cron_secret');
--
-- PARA VOLVER ATRAS (si hiciera falta restaurar la 00092): recrear las filas
-- desde Vault, sin que el valor pase por ningun lado:
--
--   INSERT INTO private.system_config (key, value)
--   SELECT replace(s.name, 'system:', ''), s.decrypted_secret
--   FROM vault.decrypted_secrets s
--   WHERE s.name IN ('system:app_url', 'system:cron_secret')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
-- ============================================================

DO $$
DECLARE
  v_faltan text;
BEGIN
  SELECT string_agg(c.key, ', ') INTO v_faltan
  FROM private.system_config c
  WHERE c.key IN ('app_url', 'cron_secret')
    AND NOT EXISTS (SELECT 1 FROM vault.secrets s WHERE s.name = 'system:' || c.key);

  IF v_faltan IS NOT NULL THEN
    RAISE EXCEPTION 'No se borra nada: % sigue solo en private.system_config y no esta en Vault. Aplica la 00139 (o carga el valor con private.set_system_secret) antes de esta migracion.', v_faltan;
  END IF;

  DELETE FROM private.system_config WHERE key IN ('app_url', 'cron_secret');
END $$;
