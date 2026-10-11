# Llamadas (Fathom + analizador de llamadas con IA)

Cada closer conecta su Fathom y sus llamadas de venta entran solas: se vinculan
al contacto y a la agenda, se clasifican, se analizan con la metodología del
negocio (el SPSP), se pueden corregir sin perder lo que dijo la IA, y lo
aprendido vuelve al negocio (dashboard, memoria del contacto, ideas de
Contenido, base de Conocimiento y automatizaciones).

Plano: [requerimientos-llamadas.md](requerimientos-llamadas.md). Avance:
[PROGRESS-llamadas.md](PROGRESS-llamadas.md). Decisiones y pendientes:
[PENDIENTE-llamadas.md](PENDIENTE-llamadas.md).

## Las tres etapas del módulo

| Bloque | Qué hace | Dónde vive |
|---|---|---|
| **L1** Conexión, ingesta y vinculación | Conectar Fathom por persona, traer las llamadas cada 10 minutos, vincular contacto y agenda, lista y ficha, importar a mano | `lib/fathom/*`, `lib/calls/{linking,list,detail,…}.ts`, `/dashboard/llamadas` |
| **L2** Clasificación y análisis | Tipo de llamada (reglas + IA), análisis con salida estructurada, puntajes por código, corregir (a mano y con IA), regenerar, probar el borrador, propuestas, objeciones | `lib/calls/{classify,analyze,correction,…}.ts`, tareas de IA en Agentes IA |
| **L3** Uso de lo analizado | Resumen, próximos pasos e ideas de contenido, memoria del contacto, Conocimiento, triggers de flujos, dashboard, llamadas en la ficha del contacto y de la agenda | `lib/calls/{summary,memory,…}.ts`, `lib/dashboards/calls.ts` |

## Datos

Una sola tabla nueva: **`calls`**. Todo lo demás son columnas y funciones.

- `calls` (00145): la llamada, su transcripción, el vínculo (`contact_id`,
  `booking_id`, `link_method`), el tipo y quién lo decidió (`call_type_source`:
  `rule` | `ai` | `human`), el estado del análisis (`analysis_status`), las dos
  copias del análisis, los puntajes, la rúbrica con la que se analizó
  (`rubric_snapshot`), el resumen y su estado, la memoria, las ideas y las
  objeciones del closer.
- **Dos copias del análisis.** `analysis_ai` es lo que dijo la IA y NO cambia
  salvo con una corrida nueva (un `analysis_run_id` distinto: lo exige el
  trigger `calls_protect_analysis_ai`). `analysis` es lo que se muestra y se
  corrige. Una corrección recalcula los puntajes con `rubric_snapshot`, no con
  la rúbrica vigente.
- Quién la ve (`can_see_call`): Owner y Admin, quien la grabó, quien ve su
  contacto, y un rol con `calls.view` de alcance `all`. Los usuarios solo leen;
  escribe el servidor.
- `oauth_connections` suma `fathom` y las columnas de sincronización
  (`last_synced_at`, `sync_watermark`, `sync_cursor`, `sync_last_error`) y el
  candado del refresh token (`claim_oauth_refresh`, `release_oauth_refresh`: el
  refresh token de Fathom es de UN SOLO USO).
- `workspace_members` suma `is_closer` y `closer_emails`.
- `audit_log` suma `actor_type` y `actor_label` (00144): quién hizo cada cosa,
  incluidos los procesos del sistema ("Análisis automático", "Fathom").
  `<Historial/>` (`components/historial/`) lo muestra y lo usan otros módulos.
- `content_ideas.source = 'call'` y `content_ideas.call_id` (00149).
- `triggers.type` suma `call_analyzed` y `call_linked` (00149).

Migraciones: **00144 a 00149**. Cada una tiene en su cabecera cómo volver atrás.

## Permisos

`calls.view`, `calls.edit` y `calls.configure`, más el alcance `calls`
(`own` | `all`). El Member de sistema tiene `calls.view` con alcance `own`.

- **Ver**: la lista, la ficha, el dashboard y la sección del contacto, según el
  alcance.
- **Editar**: cambiar el tipo, vincular, analizar, corregir, regenerar, resumir,
  mandar a Conocimiento, importar.
- **Configurar**: reglas, tipos, rúbrica, categorías y contexto del negocio de
  las dos tareas con configuración propia.
- Mandar a Conocimiento pide además `knowledge.edit`.
- El closer de una llamada (quien la grabó) puede objetar su análisis sin
  necesitar `calls.edit`.

## La ingesta (L1)

- El cron SQL `fathom-sync` (`private.enqueue_fathom_sync()`, 00146) encola un
  job `fathom_sync` por conexión activa, cada 10 minutos. NO toca
  `private.call_app_cron`.
- La ingesta es paginada (cursor), con solape de 2 horas sobre la marca de agua,
  un presupuesto de 9 pedidos por corrida y reencola a +70 s. Un 429 respeta el
  `Retry-After`; un 429 o un 5xx NUNCA marcan la conexión como `error`.
- El job no lanza por un problema de Fathom (la cola reintentaría a los 10 s
  encima de la espera propia).
- Un `analyzing` de más de 15 minutos vuelve a `pending` (lo barre el mismo
  cron).
- Detalle y límites no verificados (el límite real de Fathom, el endpoint de la
  transcripción, `recorded_by[]` con OAuth): ver PENDIENTE-llamadas.

## Clasificación y análisis (L2)

Tres tareas de IA en **Agentes IA** (`call_classification`, `call_analysis`,
`call_summary`). Las dos primeras tienen **configuración propia** en la pestaña
Configuración; todas tienen las mismas cinco pestañas que el resto de las tareas.

- **Dónde vive la configuración**: `workspaces.ai_background_settings`, claves
  `call_classification` y `call_analysis`, con su esquema Zod en
  `lib/calls/task-settings.ts`. Se escribe SOLO con la función de la base
  `set_ai_background_task_settings` (cambia UNA clave) a través de
  `saveCallTaskSettings`. Guardar una tarea en segundo plano no borra estas
  claves (`mergeBackgroundSettings`).
- **Clasificar**: primero las reglas (sin IA), después la IA si está prendida.
  Un tipo elegido por una persona NUNCA lo pisa una regla ni la IA. Bajo el
  umbral de confianza queda "Por revisar".
- **Analizar**: una sola función (`runCallAnalysis`) para producción,
  "regenerar" y "probar el borrador". Salida estructurada (Zod), 32.000 tokens
  de salida. Los puntajes los calcula el código con la rúbrica; la IA no da
  totales. Las citas se verifican contra la transcripción.
- **Automático o a mano**: `call_analysis.mode` (`off` por defecto: el primer
  gasto lo decide una persona). Respeta el tope de gasto del workspace; si lo
  alcanzó, la llamada queda `pending` con motivo `budget` y se avisa a quienes
  tienen `calls.configure` una vez por día.
- **Corregir a mano / con IA / regenerar con motivo / probar el borrador /
  propuestas de categoría / objeción del closer**: ver los criterios de F23 a
  F28 del plano. Lo que escribe una persona como pedido viaja SIEMPRE como dato
  en el mensaje del usuario, nunca en el system prompt.
- **Reintentos de la IA**: los handlers no lanzan por un fallo del modelo;
  reagendan a 1, 5 y 15 minutos. Una key inválida (401/403/400) no se
  reintenta.
- El SPSP del negocio se carga como la versión 1 de las instrucciones de
  `call_analysis` y su rúbrica como la rúbrica vigente. No está en el repo.

## Lo que se hace con lo analizado (L3)

- **Resumen** (`call_summary`): resumen, próximos pasos, puntos clave,
  sentimiento y hasta cinco ideas de contenido. Solo con transcripción y tipo
  distinto de `equipo`, `no_show` y `clase`. Las **ideas** se crean solo la
  primera vez (`ideas_created_at`): resumir de nuevo no las duplica.
- **Memoria del contacto**: en la MISMA corrida del resumen, la memoria previa
  entra y sale la integrada. La escritura es condicional
  (`ai_summary_updated_at IS NOT DISTINCT FROM <lo leído>`): si el cierre de una
  conversación escribió en el medio, se relee y se integra otra vez (una vez);
  si vuelve a chocar, `memory_status = 'conflict'` y una persona reintenta con
  "Resumir". Queda en el historial del contacto ("Resumen de llamada").
- **Conocimiento** (`call_index_knowledge`): la transcripción por turnos, con el
  hablante y el minuto, como documento **interno** (`internal_only = true`,
  etiqueta `llamadas`). Solo `cierre`, `seguimiento` y `triaje`; nunca una
  reunión de equipo. Mandarla dos veces deja UN documento.
- **Triggers de flujos**: `call_analyzed` (una llamada CON contacto queda
  analizada: análisis nuevo o regenerado, no una corrección) y `call_linked` (se
  vincula un contacto a una llamada). Filtros y variables `{{call.*}}` en
  [flow-registry.md](flow-registry.md). Una llamada sin contacto no emite nada.
- **Dashboard** (`/dashboard/dashboards/llamadas`): promedio por criterio, foco
  de cada closer, objeciones y cuántas terminaron en venta, calificación ×
  resultado y evolución por semana. Lee con el cliente del usuario: la RLS decide
  qué números ve cada quien.
- **Ficha del contacto y detalle de la agenda**: sus llamadas, con link a la
  ficha; "Ver todas" lleva a la lista filtrada por ese contacto.

## Lo que no se puede romper

- **`audit_log_select` no se reescribe.** El acceso al historial de las llamadas
  es una política ADICIONAL (`audit_log_select_calls`, 00147): las políticas de
  SELECT se suman. Convención para los módulos que sigan:
  `audit_log_select_<módulo>`. `scripts/verify-audit-visibility.mjs` compara la
  visibilidad completa antes y después de tocar políticas.
- **`private.call_app_cron` no se toca.** Los crons de este módulo son de SQL
  directo (`enqueue_fathom_sync`).
- **`readSecret` solo con el cliente de servicio** (00143); la app de Fathom
  (Client ID y Secret) y los tokens viven en Vault, nunca en el `.env`.
- **Nunca se confía en el horario ni en el id del cliente**: el workspace sale
  siempre de la sesión.
- **Los jobs de Llamadas no lanzan por un fallo de un proveedor externo**; se
  reagendan solos o dejan la llamada en un estado que una persona ve.
- **Una cita de la IA que no está en la transcripción no cuenta**, y una
  corrección con IA que la usa se descarta.
- **Los puntajes salen del código**, nunca del modelo.

## Verificación

```
node scripts/verify-calls.mjs                      # RLS, únicos, trigger de analysis_ai, candado, cron, configuración, claim, L3
node scripts/verify-audit-visibility.mjs --despues-de-00147
```

Valen las mismas reglas que los demás `verify-*`: crean y limpian lo suyo
(prefijo `zz-test-`) y no se corren dos a la vez. Ninguno llama a Fathom ni a un
proveedor de IA; los tests de Vitest usan dobles (`generate`, `fetchImpl`).
