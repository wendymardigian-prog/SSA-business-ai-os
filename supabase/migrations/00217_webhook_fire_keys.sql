-- ============================================================================
-- 00217 — Claves de disparo de webhooks por (envío, flujo)  (Tirón 2, C2)
-- ============================================================================
-- Hasta ahora la clave que reclama un flujo en `trigger_fires` era `webhook:<envío>:<flujo>:<reproceso>`:
-- al reprocesar cambiaba el número y TODOS los flujos volvían a correr (otra bienvenida). Desde este cambio
-- la clave es `webhook:<envío>:<flujo>` (sin el contador): un envío nunca dispara dos veces el mismo flujo.
--
-- Esta migración traslada lo que ya corrió al formato nuevo, para que desplegar el código NO vuelva a correr
-- ningún flujo de un envío que ya pasó: por cada clave vieja inserta la nueva. Una excepción: si el último
-- resultado guardado de ese flujo para ese envío fue `failed`, NO se reclama (con el código nuevo un flujo que
-- falla libera su clave, y reprocesar lo reintenta). Es solo INSERT: no borra ni cambia ninguna fila.
--
-- Orden: se aplica ANTES de desplegar el código nuevo (la clave vieja y la nueva conviven sin problema: el
-- código viejo ignora las nuevas, y el nuevo respeta las viejas porque ya están copiadas).
--
-- Como volver atras (borra solo las claves nuevas, sin `:<n>` al final):
--   DELETE FROM public.trigger_fires
--    WHERE dedupe_key ~ '^webhook:[0-9a-f-]{36}:[0-9a-f-]{36}$';
-- Riesgo: bajo (aditiva e idempotente: ON CONFLICT DO NOTHING).
-- ============================================================================

SET search_path = '';

INSERT INTO public.trigger_fires (trigger_id, workspace_id, dedupe_key, contact_id)
SELECT DISTINCT old.trigger_id,
       old.workspace_id,
       regexp_replace(old.dedupe_key, ':[0-9]+$', ''),
       NULL::uuid
  FROM public.trigger_fires old
 WHERE old.dedupe_key ~ '^webhook:[0-9a-f-]{36}:[0-9a-f-]{36}:[0-9]+$'
   AND NOT EXISTS (
         SELECT 1
           FROM public.inbound_webhooks w
          WHERE w.id::text = split_part(old.dedupe_key, ':', 2)
            AND w.result -> 'flows' -> split_part(old.dedupe_key, ':', 3) ->> 'status' = 'failed'
       )
ON CONFLICT (trigger_id, dedupe_key) DO NOTHING;
