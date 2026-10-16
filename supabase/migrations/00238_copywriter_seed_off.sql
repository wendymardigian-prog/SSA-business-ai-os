-- ============================================================
-- 00238 — El copywriter nace APAGADO (E1)
-- ============================================================
-- La 00094 crea un "Copywriter de contenido" por workspace, y el trigger lo
-- creaba ENCENDIDO (`is_enabled = true`) aunque su propio comentario dijera
-- "apagado". Resultado: una instalacion nueva, sin ninguna IA conectada,
-- mostraba un agente "Encendido" en Agentes IA, y la pantalla de "todavia no
-- hay un agente" (con su boton para crear el agente de chat) quedaba
-- inalcanzable porque ese agente ya contaba como agente.
--
-- Desde esta migracion, el workspace nuevo arranca con el copywriter apagado:
-- una instalacion nueva no tiene nada encendido por accidente. El copywriter
-- no depende de este interruptor para generar a mano (no lo lee); es solo lo
-- que ve la pantalla.
--
-- NO toca los workspaces que ya existen: sus copywriters siguen como estan
-- (en produccion hay una IA conectada y se usa).
--
-- Para volver atras (solo cambia lo que nace de ahora en adelante): reponer
-- `true` en el INSERT de `seed_copywriter_agent()` (ver la 00094).

CREATE OR REPLACE FUNCTION public.seed_copywriter_agent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Apagado y sin prompt propio: la voz de marca se carga desde la pantalla.
  INSERT INTO public.agents (workspace_id, name, type, is_enabled, system_prompt)
  VALUES (
    NEW.id,
    'Copywriter de contenido',
    'copywriter',
    false,
    ''
  )
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
