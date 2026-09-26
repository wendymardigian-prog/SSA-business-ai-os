# Pendientes

Lo que quedó sin cerrar, para retomar con Wendy. Formato de cada entrada:

- **Qué quedó:** …
- **Por qué:** …
- **Qué se decidió en su lugar:** …

---

## Etapa 2

### Migración destructiva escrita y sin aplicar (§9.10)
- **Qué quedó:** `drop_legacy_secret_columns` (`workspaces.late_api_key_encrypted`, `workspaces.webhook_secret`,
  `channels.webhook_secret`) se escribe como archivo y **no se aplica**.
- **Por qué:** borra columnas que hoy tienen los secretos en uso. Aplicarla antes de que todo lea de Vault
  dejaría a Instagram sin API key y al webhook sin secreto.
- **Qué se decidió en su lugar:** se aplica en la verificación en vivo (§18 del plano), después de confirmar con
  cuentas reales que Vault responde, y junto con el borrado de las variables `EVOLUTION_*` de Railway.

### "Migrar a Vault" se construye pero no se aprieta
- **Qué quedó:** el botón de la card de Zernio (F5) queda funcionando, pero durante la corrida no se usa.
- **Por qué:** copiar un secreto es cambiar configuración real, y la regla de la corrida (§0) lo prohíbe.
- **Qué se decidió en su lugar:** mientras Vault esté vacío, `resolveWebhookSecret` y `getZernioApiKey` siguen
  leyendo las columnas de hoy, así que nada cambia de comportamiento. El botón se usa en §18.

---

## Heredado de la Fase 3

Sigue pendiente todo esto, salvo la barra superior de 56 px, que esta etapa resuelve en F7.

### Barra superior global de 56 px en todas las páginas (F13 de la Fase 3)
- **Qué quedó:** el `PageHeader` existía y lo usaba solo el dashboard de Chat; las otras ~21 páginas tenían su
  encabezado propio y en el celular convivían dos barras.
- **Por qué:** reemplazar el encabezado en 21 pantallas es un cambio cosmético grande.
- **Qué se decidió en su lugar:** **lo resuelve F7 de esta etapa.** Se saca de la lista al cerrar el Bloque 1.

### API por lote (Bloque 5 de la Fase 3, §21.2)
- **Qué quedó:** el proveedor de IA se llama con pedidos agrupados, no con la API por lote (batch) real.
- **Por qué:** el AI SDK v6 no expone modo batch para ningún proveedor, y los SDK crudos no están instalados.
- **Qué se decidió en su lugar:** interfaz `BatchProvider` lista para sumar el lote real por `fetch`.

### Handler de `bg_task` y recolección (F24/F25 de la Fase 3)
- **Qué quedó:** falta el handler de `scheduled_jobs` tipo `bg_task` que ejecuta el clasificador, y la
  recolección de resultados en `bg-collect` (hoy la ruta es un stub con un TODO).
- **Por qué:** el lote real no existe en el SDK y el pipeline completo era grande.
- **Qué se decidió en su lugar:** quedaron la lógica de ventanas (`planDispatch`), las rutas cron y el
  clasificador. **Hallazgo nuevo de esta corrida:** como el dedupe de `scheduled_jobs` solo cubre las filas
  `pending`, cada `bg_task` que el runner completa se vuelve a encolar 15 minutos después. Al 26/9/2026 hay 9 así,
  y crecen ~96 por día. No se rompe nada (el job no hace nada), pero conviene cerrarlo al construir el handler.
  El registro de jobs del Bloque 4b le deja un handler explícito que conserva ese comportamiento.

### UI de calidad, revisión rápida y versiones del clasificador (F25 de la Fase 3)
- **Qué quedó:** las fórmulas de calidad (`lib/patterns/quality.ts`) están testeadas, falta la pantalla: 4
  indicadores, calibración, revisión rápida de 20 y versiones del clasificador con "volver a esta".
- **Por qué:** volumen del bloque.
- **Qué se decidió en su lugar:** la lógica quedó testeada; la pantalla se hace con Wendy mirando.

### Detalle de tendencias con 4 pestañas (F16 de la Fase 3)
- **Qué quedó:** el dashboard de Chat muestra una serie; la función SQL ya devuelve las tres.
- **Por qué:** las 4 pestañas con leyenda y paso a semanal son presentación; el dato está.
- **Qué se decidió en su lugar:** se completan en la pasada de pantallas con Wendy.

### "Qué le responden" (§11.7) y drilldown de correcciones (F22 de la Fase 3)
- **Qué quedó:** falta la sección "qué le responden" y los controles de corrección enganchados en la UI (las
  Server Actions ya existen en `lib/actions/patterns.ts`).
- **Por qué:** volumen del bloque.
- **Qué se decidió en su lugar:** se completa en la pasada de pantallas con Wendy.

### `declarar_intencion` es opt-in (F26 de la Fase 3)
- **Qué quedó:** la herramienta existe pero no es `required`: se habilita por agente.
- **Por qué:** marcarla `required` cambiaba el set por defecto y rompía los tests de caracterización del runner.
- **Qué se decidió en su lugar:** queda opt-in; al prender el agente, activarla en Herramientas.

### Migración 00072 (avisos de ventana) escrita y sin aplicar
- **Qué quedó:** `00072_draft_window_alerts` está escrita y probada, y **no está aplicada**. Verificado contra la
  base el 26/9/2026: no existen `private.alert_draft_windows` ni el cron `ssa-cron-draft-window-alerts`.
  (La bitácora del Bloque 2c dice en un lugar que se aplicó: es un error, la base manda.)
- **Por qué:** es lo único que notifica a una persona; conviene enchufarlo sabiendo el volumen de la cola.
- **Qué se decidió en su lugar:** se aplica cuando la cola de borradores tenga un par de días.

### Recorrida de pantallas en vivo
- **Qué quedó:** las pantallas no se recorrieron a ojo en las corridas autónomas.
- **Por qué:** la app pide login y no se ingresan credenciales.
- **Qué se decidió en su lugar:** la lógica va en funciones puras con tests y en scripts `verify-*`; la recorrida
  a 1440 y 390 px se hace con Wendy.

### Deuda del agente que sigue abierta
- **Qué quedó:** `approveDraft` no mira `agent_enabled`; un Member no ve en Acciones los `tag_effect` del agente;
  las respuestas desde la app de Instagram no llegan por webhook; el eco `fromMe` de WhatsApp no apaga el agente;
  la zona horaria está partida entre la de la app y la del negocio; el backlog de 578 conversaciones sigue abierto;
  la regla de pertenencia de un borrador (setter → vendedor → sin asignar) espera confirmación de Wendy;
  falta la segunda pasada del backfill de Zernio (semana del 1/10/2026); y el Bloque 2d-B completo.
- **Por qué:** son decisiones de producto o necesitan al agente corriendo con datos reales.
- **Qué se decidió en su lugar:** todo documentado en [agente-ia.md](agente-ia.md); no se toca en la Etapa 2.

### Hallazgos de la exploración de la Etapa 2 que no son de su alcance
- **Qué quedó:** (a) `lib/ai/generate-reply.ts` (nodo AI Response y pasos de secuencia) **no chequea los topes de
  gasto**: solo el runner del agente llama a `checkSpendLimits`. (b) `next.config.ts` no configura
  `serverActions.bodySizeLimit`, así que la subida de documentos de la base de conocimiento (que pasa por una
  Server Action) topea en 1 MB por defecto, muy por debajo del límite de 25 MB del bucket. (c) Los broadcasts
  envían solo por Zernio: un destinatario de WhatsApp se saltea en silencio.
- **Por qué:** son zonas declaradas intocables por §4.2 del plano de la Etapa 2.
- **Qué se decidió en su lugar:** quedan anotados. (a) y (c) son arreglos chicos y acotados; (b) es una línea de
  configuración, pero cambiarla toca el límite de todas las Server Actions.
