# Requerimientos — Sistema Operativo de Negocio con IA
## Etapa 1 — Fase 3: Bloques 2e y 3 · Verificación y reglas de respuesta + Dashboards

**Versión:** 1.1 (documento único para construcción one-shot) — ajustada después de revisar el repo: salientes externos que no llegan por webhook, Bloque 2d-B diferido, descarte `auto:answered_elsewhere` ya existente
**Fecha:** 25 de septiembre de 2026
**Cliente:** Wendy Mardigian (Scaling Systems Academy)
**Reemplaza a:** `requerimientos-bloque2e-reglas-respuesta.md` y `requerimientos-bloque3-dashboards.md` (quedan como antecedente). También reemplaza la sección 4.9 y los criterios F35–F37 de `requerimientos-etapa1-fase3-v2.md`.
**Prototipo de referencia:** artefacto "Dashboards de Chat". Usalo para layout, jerarquía y textos, no como especificación de píxeles.

> **Cómo usar este documento.** Está pensado para que Claude Code lo construya de punta a punta en una corrida autónoma. Cada funcionalidad termina en criterios que se verifican con un comando (tests, build, script de verificación). Todo lo que requiere una persona mirando está separado en §19 "Verificación en vivo", y se hace **después** de la corrida. Si algo bloquea, se anota en `docs/PENDIENTE.md` y se sigue con lo demás.

---

## 1. Mapa de ruta

| Etapa | Fase | Estado |
|---|---|---|
| Etapa 1 | Fase 1: Foundation, Canales y CRM | ✅ Completa |
| Etapa 1 | Fase 2: Comunicación y Automatizaciones | ✅ Completa |
| Etapa 1 | **Fase 3: Agente IA, Analytics y Pulido** | 🔵 **En curso** |
| | Bloque 1: Persistencia de mensajes | ✅ |
| | Bloques 2a–2c: Agente, gestión, modo borrador | ✅ |
| | Bloque 2d-A: Borradores en la bandeja, versión mobile, etiquetas con efecto | ✅ (mergeado, 00073 aplicada) |
| | Bloque 2d-B: Backfill manual, reglas botón → etiqueta, propuestas de etiqueta | ⏸ Diferido: una semana después de prender el agente |
| | **Bloque 2e: Verificación antes de responder y reglas de respuesta** | ⬜ **Este documento** |
| | **Bloque 3: Dashboards** | ⬜ **Este documento** |
| | Testing integral de la Etapa 1 y cierre | ⬜ Después |
| Etapa 2 | Publicación de contenido, métricas, email bidireccional, roles custom, Meta Ads | Futuro |
| Etapa 3 | Agente integral, Fathom, conector MCP | Futuro |
| Etapa 4 | Agendamiento, ventas, pipeline (opcional) | Futuro |

**Contemplado en el diseño aunque no se construya ahora:**
- El selector de dashboards ya lista Gasto de IA (próximamente), Contenido orgánico y Meta Ads (Etapa 2). Agregar un dashboard es sumar una opción y una ruta.
- `messages.origin` ya prevé canales de Etapa 2 (email, TikTok): cualquier canal nuevo escribe su origen igual.
- Las categorías de mensajes y la intención declarada por el agente son la base del "agente integral" de la Etapa 3 (consultar patrones por lenguaje natural).
- La configuración de tareas de IA en segundo plano es genérica: las tareas de Etapa 2 (análisis de contenido, métricas) se suman como una entrada más.

---

## 2. Objetivo y mapa de bloques

**Objetivo:** que el agente pueda prenderse sin pisarle respuestas a ManyChat ni a nadie, con control fino de qué envía solo y qué deja para aprobar, y que Wendy pueda medir la operación de chat completa (volumen, quién responde, qué tan rápido, cómo rinde el agente y qué pregunta la gente).

**Por qué va en este orden:** el agente está construido pero apagado. El dato que decide prenderlo es que **el 47% de los mensajes que entran son clics en botones de ManyChat, que ManyChat responde en 2 segundos**. Sin la verificación del Bloque 2, el agente le contestaría encima. Y los dashboards necesitan saber quién mandó cada mensaje, que hoy no se registra (Bloque 1). Por eso: primero la base común, después la seguridad del agente, después medir.

| Bloque | Día | Qué se construye | Contexto compartido |
|---|---|---|---|
| **Bloque 1: Base común** | 1 | Autoría de mensajes (`messages.origin`), función de normalización de texto, zona horaria del workspace, valores nuevos en los checks de `agent_runs` y `agent_drafts` | `messages`, `workspaces`, `agent_runs`, `agent_drafts`, receptor de webhooks, todos los caminos de envío |
| **Bloque 2: Verificación y reglas de respuesta** | 1–2 | Verificación antes de responder (3 momentos), espera tras respuesta externa, descarte automático "respondida por otro medio", refresco contra Zernio, modo "Según reglas" con evaluador, editor, plantilla, simulación y registro | `agents`, `agent_runs`, `agent_drafts`, `messages`, runner del agente, cola de borradores, Agentes → Canales y Runs |
| **Bloque 3: Navegación y dashboard de Chat** | 2–3 | Renombre y orden del menú, barra superior global de 56 px, ruta nueva, filtros, período, números, tendencias, sección del agente, borradores, tabla "Quién responde" | `messages`, `conversations`, `agent_runs`, `agent_drafts`, `audit_log`, layout global, pantalla Dashboards |
| **Bloque 4: Patrones de mensajes** | 3–4 | `message_texts`, `message_categories`, trigger, clasificador en lote, reglas por botón, corrección desde el dashboard, confianza, "qué le responden" | `messages`, tablas nuevas, sección Patrones |
| **Bloque 5: Tareas en segundo plano, calidad e intención** | 4–5 | Configuración por workspace, jobs de despacho y recolección, API por lote, panel de calidad, revisión rápida, versiones del clasificador, intención declarada por el agente, condición de intención en reglas, aprobación por categoría | `workspaces.ai_background_settings`, `agent_runs`, Settings, editor de reglas, dashboard |
| Verificación en vivo | después | Pruebas con ManyChat e Instagram reales, con Wendy | — |

---

## 3. Estado real, verificado en la base (25/09/2026)

| Dato | Valor | Consecuencia |
|---|---|---|
| Entrantes guardados | 739 (665 en los últimos 30 días; 248 textos distintos normalizados) | Volumen de clasificación |
| Entrantes que son respuestas a botones de ManyChat | 347 (47%). **337 respondidos en menos de 60 s. Mediana 2 s, p90 3 s** | La verificación del Bloque 2 los cubre con la ventana de silencio actual |
| Entrantes de texto libre | 392. 41 respondidos en menos de 60 s. Mediana ~7 h | El 10% probablemente es ManyChat por palabra clave |
| Salientes últimos 30 días | 1.437 (179 textos distintos) | — |
| Salientes con autor (`sent_by_flow_id` / `sent_by_user_id` / `sent_by_agent_id`) | **0 de 1.437** | Diagnóstico obligatorio en F1 |
| Salientes con `platform_message_id` | 1.580 de 1.580 | Entraron por el **historial** (`backfillConversation`), no por webhook |
| **Webhook de Zernio** | Suscripto solo a `message.received` y `comment.received`. El SDK tiene `message.sent`, pero Zernio lo dispara **solo para envíos hechos por su propia API** (y la app de WhatsApp Business), **no** para lo que se manda desde ManyChat o la app de Instagram | **Las respuestas de ManyChat no llegan en tiempo real.** Sin un refresco contra Zernio antes de responder, la verificación no las vería (§10.1). Ya estaba anotado como deuda del 2c: "respuestas desde la app de Instagram no llegan por webhook" |
| Guarda existente "ya hubo una respuesta" | El runner arma la ráfaga como entrantes posteriores al último saliente **guardado** (sin saliente nuevo → `nothing_to_answer`). `approveDraft` descarta con `discard_reason = 'auto:answered_elsewhere'` si ya hay un saliente | Ya existen: este bloque las **alimenta** con datos frescos y las extiende, no las reescribe |
| Lista de textos de botón | **No existe todavía** (era del 2d-B, diferido) | Se crea en este trabajo (F19) y el 2d-B la reusa para botón → etiqueta |
| Conversaciones | 592 | — |
| Agente | `is_enabled = false`, Instagram en `draft`, `bundle_window_seconds = 60`, `max_wait_seconds = 300` | No se prende en esta corrida |
| `agent_runs.source` permitido | `agent`, `flow_ai_node`, `sequence_ai_step`, `kb_indexing`, `conversation_summary` | Hay que sumar valores (F4) |
| `agent_runs.status` permitido | `running`, `responded`, `escalated`, `skipped_automation`, `skipped`, `blocked_guardrail`, `completed`, `error`, `drafted` | Hay que sumar `already_answered` (F4) |
| `agent_drafts.status` permitido | `pending`, `sending`, `sent`, `failed`, `discarded`, `superseded`, `regenerated` | Sin estado nuevo: "respondida por otro medio" se registra como `discarded` + `discard_reason = 'auto:answered_elsewhere'`, como ya hace `approveDraft` |
| Última migración | `00073_tag_effects` (repo y base). La `00072` está en el repo pero su aplicación se difirió (ver bitácora) | Continuar desde **00074** |
| Mobile | El 2d-A construyó el cascarón mobile (barra superior con menú, bandeja lista → hilo) | La barra de 56 px de F13 se construye **sobre** ese cascarón, no lo reemplaza |
| `workspaces` | Sin zona horaria | F3 |
| `messages.quick_reply_payload` | Casi siempre vacío o hash opaco | Las reglas por botón van por texto |

---

## 4. Usuarios y roles

Sin roles nuevos. Se amplían permisos para las pantallas y acciones nuevas.

| Rol | Puede hacer | No puede hacer |
|---|---|---|
| **Owner** | Todo: ver dashboards del workspace completo; cambiar el modo de respuesta de cada canal; crear, editar, reordenar, pausar y simular reglas; cambiar la espera por respuesta externa; corregir, renombrar y unir categorías; configurar tareas en segundo plano; revisión rápida; versiones del clasificador | — |
| **Admin** | Igual que Owner en este alcance | Eliminar workspace, billing |
| **Member** | Ver el dashboard acotado a su scope de leads; ver en la tabla "Quién responde" solo la fila del agente y la suya; ver patrones de su scope en solo lectura; ver en Runs y en la cola qué regla decidió, en su scope | Cambiar modo o reglas; corregir categorías; ver Settings → Tareas en segundo plano; ver filas de otras personas; ver costos |

Primer usuario: Owner (sin cambios). Invitaciones: sin cambios.

---

## 5. Alcance específico

### 5.1 Autoría de mensajes
- **Qué hace:** cada saliente guarda de dónde salió: `agent`, `user`, `flow`, `sequence`, `broadcast` o `external`.
- **Hasta dónde llega:** todos los caminos de envío del sistema, el refresco contra Zernio (§10.1) y el historial. Backfill de los existentes.
- **Qué NO hace:** no identifica qué herramienta externa mandó un `external` (ManyChat vs app de Instagram). No se puede saber con los datos de la plataforma.

### 5.2 Verificación antes de responder
- **Qué hace:** el agente no responde si alguien ya respondió después del último mensaje del lead. Se verifica en tres momentos (antes de generar, antes de enviar, y con un borrador pendiente).
- **Hasta dónde llega:** vale en todos los modos (directo, borrador, según reglas). Detecta cualquier saliente, venga de donde venga.
- **Qué NO hace:** no se integra con la API de ManyChat. Como los salientes externos no llegan por webhook, **refresca los últimos mensajes de la conversación contra Zernio** antes de responder y antes de enviar, y un job refresca cada 5 minutos las conversaciones con borrador pendiente.

### 5.3 Espera tras respuesta externa
- **Qué hace:** si hubo un saliente `external` en los últimos N minutos (default 10), el agente no toma el turno.
- **Qué NO hace:** no detecta que un flow de ManyChat "terminó". Es una ventana de tiempo.

### 5.4 Modo "Según reglas"
- **Qué hace:** tercer modo por canal. Lista ordenada de reglas condición → acción (enviar directo, dejar borrador, no responder), evaluadas por código. Editor, plantilla inicial, simulación sobre 30 días y registro de qué regla decidió.
- **Hasta dónde llega:** condiciones sobre el mensaje del lead, el contacto, la conversación, el momento, la respuesta del agente, lo que hizo el agente y la intención declarada (esta última en el Bloque 5).
- **Qué NO hace:** no es un prompt. No hay "o" entre condiciones (se hacen dos reglas). No hay asistente en lenguaje natural (queda para después). No hay envío automático por tiempo (decisión del Bloque 2c: nada se autoenvía).

### 5.5 Navegación global
- **Qué hace:** "Analytics" pasa a "Dashboards" y va primero en el menú. La barra superior de **todas** las páginas mide 56 px, sin subtítulo, con tooltip ⓘ.
- **Qué NO hace:** no rediseña otras pantallas más allá de su barra superior.

### 5.6 Dashboard de Chat
- **Qué hace:** filtros de canal, "respondido por" y período; cinco números con comparación; tendencias; sección del agente; aprobación de borradores; tabla "Quién responde"; patrones de mensajes.
- **Qué NO hace:** no exporta a PDF/CSV. No se actualiza en tiempo real (se calcula al cargar y al cambiar filtros). No crea tablas de agregados precalculados.
- **Fuera:** Gasto de IA (próximamente), Contenido orgánico y Meta Ads (Etapa 2).

### 5.7 Patrones de mensajes
- **Qué hace:** agrupa mensajes por lo que significan. Capa 1 gratis (normalización). Capa 2 con un LLM chico en lote, una sola vez por texto distinto. Corrección humana que nunca se pisa.
- **Qué NO hace:** no usa embeddings (con textos cortos no separan "sí me interesa" de "no me interesa", necesitan umbral calibrado y no nombran grupos). No se corrige desde el Inbox (después).

### 5.8 Tareas de IA en segundo plano
- **Qué hace:** configuración por workspace de cada tarea de IA que no es conversación en vivo: Inmediato / Económico (por lote) / Apagado, con frecuencia y hora.
- **Qué NO hace:** las respuestas del agente no están acá: siempre son inmediatas.

### 5.9 Calidad de la clasificación
- **Qué hace:** precisión estimada por revisión rápida, corregidos, sin categoría, dudosos, calibración de la confianza, set de control, versiones del clasificador evaluadas antes de activarse.

---

## 6. Decisiones tomadas

| Decisión | Definición |
|---|---|
| Nombre y lugar | "Analytics" → **Dashboards**, primer ítem del menú |
| Barra superior | 56 px en todas las páginas, igual al encabezado del menú lateral. Sin subtítulo: tooltip en ⓘ |
| Filtros del dashboard | Canal · Respondido por · Período, en la barra superior a la derecha, guardados en la URL |
| Período | Popover con atajos (Hoy, Esta semana, Semana pasada, Este mes, Mes pasado, Últimos 7/30/60/90 días, Este año, Histórico) y calendario de dos meses. Semana lunes a domingo. Sin días futuros |
| "Conversación nueva" | Por **episodio** (§11.3), no por fila de `conversations` |
| Tiempo de una persona | Desde que la conversación le fue asignada o derivada |
| Filtro por persona | Oculta la sección del agente con un aviso |
| Verificación antes de responder | Universal, genérica (cualquier saliente), en 3 momentos |
| Espera tras respuesta externa | 10 minutos por defecto, configurable 0–120 |
| Reglas | Datos estructurados evaluados por una función pura. Gana la primera que coincide. Default: Dejar borrador |
| Guardarraíles primero | Ninguna regla saltea un guardarraíl |
| Agrupación de mensajes | Normalización + LLM chico en lote. Sin embeddings |
| Un texto se clasifica una vez | Correcciones humanas nunca se pisan |
| Lote por defecto | La clasificación corre una vez por día a las 03:00 (zona del workspace), con API por lote si el proveedor la tiene |
| Referencia de envío directo | 85% de borradores aprobados sin cambios, con al menos 20 borradores en 30 días. Es referencia visual, no regla automática |
| Mínimo de tablas | 2 tablas nuevas (`message_categories`, `message_texts`). El resto son columnas |

---

## 7. Funcionalidades y criterios de aceptación

**Convenciones de verificación para todo el documento:**
- `TEST` = `npx vitest run` (Vitest 3). Ubicá los tests nuevos siguiendo la convención que ya usa el repo; los nombres de archivo de abajo son sugeridos.
- `BUILD` = `npm run build` y `npm run lint` salen 0.
- `RLS` = `node scripts/verify-rls.mjs` sale 0 (extenderlo con los casos nuevos).
- `VERIFY-DASH` = `node scripts/verify-dashboards.mjs` (script nuevo, mismo patrón que `verify-rls.mjs` y `verify-crm.mjs`: crea un workspace de prueba con datos fijos, llama a las funciones reales y compara contra valores esperados; limpia al terminar y trata una limpieza fallida como falla).
- Todas las APIs externas (Zernio, proveedores de IA, API por lote) van **mockeadas** en los tests.
- Migraciones idempotentes, numeradas continuando la secuencia real, funciones con `SET search_path = ''`.

---

### Bloque 1: Base común

#### F1: Diagnóstico de autoría
**Descripción:** averiguar por qué ningún saliente de los últimos 30 días tiene autor.

**Criterios:**
- La hipótesis, por lo revisado en el repo, es (a): los 1.437 salientes sin autor entraron por el historial de Zernio y son envíos externos (ManyChat o la app de Instagram). CUANDO se corre el diagnóstico, EL SISTEMA DEBE producir `docs/diagnostico-autoria.md` confirmándolo o refutándolo con datos: cuántos salientes hay por combinación de `sent_by_*`, cuántos entraron por webhook y cuántos por historial, si los envíos hechos **desde la app** (respuesta manual, flows internos, agente) guardan `sent_by_*` hoy, y la conclusión: (a) envíos externos, o (b) la app no está guardando el autor.
- SI la conclusión es (b), EL SISTEMA DEBE corregir cada camino de envío afectado como parte de F2, con su test.
- Test: `tests/messages/authorship-paths.test.ts` cubre que cada camino de envío (respuesta manual, aprobación de borrador, agente directo, flow, secuencia, broadcast) llama al insert con los campos de autoría correctos. Pasa con `TEST`.

#### F2: Columna `messages.origin`
**Descripción:** origen de cada saliente (§12.2).

**Criterios:**
- CUANDO una persona envía desde la bandeja, EL SISTEMA DEBE guardar `origin = 'user'` y `sent_by_user_id`.
- CUANDO se aprueba un borrador, EL SISTEMA DEBE guardar `origin = 'agent'`, `sent_by_agent_id`, `agent_run_id` y `sent_by_user_id` de quien aprobó.
- CUANDO el agente envía directo, EL SISTEMA DEBE guardar `origin = 'agent'` y `sent_by_agent_id`.
- CUANDO envía un flow, EL SISTEMA DEBE guardar `origin = 'flow'`, `sent_by_flow_id`, `sent_by_node_id`. Secuencia → `sequence`. Broadcast → `broadcast`.
- CUANDO el historial o el refresco de §10.1 traen un saliente que no existe en `messages` (según `isAlreadyStored`), EL SISTEMA DEBE guardarlo con `origin = 'external'`.
- CUANDO el refresco trae un saliente que el sistema mismo envió y todavía no terminó de guardar, EL SISTEMA NO DEBE duplicarlo ni marcarlo `external`: debe matchear por `platform_message_id` / `platform_native_message_id` y conservar el `origin` del envío propio.
- CUANDO un mensaje es entrante, `origin` DEBE ser null (check constraint).
- DADO el backfill, CUANDO termina, ENTONCES todo saliente existente tiene `origin` no nulo: `agent`/`user`/`flow` según sus `sent_by_*`, `external` si no tiene ninguno.
- Test: `tests/messages/origin.test.ts` cubre los 8 casos anteriores (con el receptor y el cliente de Zernio mockeados). Pasa con `TEST`. La migración incluye una verificación al final (`DO $$ … RAISE EXCEPTION` si queda algún saliente con `origin` nulo).

#### F3: Zona horaria del workspace
**Criterios:**
- EL SISTEMA DEBE tener `workspaces.timezone` (texto IANA, default `America/Costa_Rica`), editable en Settings → General con un selector de zonas.
- CUANDO se guarda una zona inválida, EL SISTEMA DEBE rechazarla en el servidor con un mensaje claro.
- Test: `tests/settings/timezone.test.ts` (validación de zona y valor por defecto). Pasa con `TEST`.

#### F4: Valores nuevos en checks y función de normalización
**Criterios:**
- EL SISTEMA DEBE aceptar en `agent_runs.status` el valor `already_answered`; en `agent_runs.source` los valores `message_classification` y `message_classification_eval`; en `agents.channel_modes` el valor `rules`. (`agent_drafts.status` no cambia.)
- EL SISTEMA DEBE tener `public.normalize_message_text(text) RETURNS text`, `IMMUTABLE`, `SET search_path = ''`, que: pasa a minúsculas; saca tildes y diéresis con `translate` (no `unaccent`); elimina todo lo que no sea letra, número o espacio; colapsa dos o más caracteres iguales seguidos en uno; colapsa espacios y recorta; trunca a 300 caracteres.
- CUANDO se normaliza "Sí!!", "siii", "SI" y "sí", EL SISTEMA DEBE devolver `si` en los cuatro casos. CUANDO se normaliza "❤", DEBE devolver cadena vacía. CUANDO se normaliza "Siii quiero a clase", DEBE devolver `si quiero a clase`.
- EL SISTEMA DEBE tener una versión TypeScript equivalente (`lib/text/normalize.ts`) para usar en el evaluador de reglas y en la UI.
- Test: `tests/text/normalize.test.ts` compara la función SQL (vía RPC contra la base de prueba, en `VERIFY-DASH`) y la TS sobre los mismos 20 casos y exige igualdad. Pasa con `TEST` y `VERIFY-DASH`.

> **Bloque 1 listo cuando:** F1 a F4 cumplen sus criterios, `docs/diagnostico-autoria.md` existe, `TEST`, `BUILD` y `RLS` salen 0, y ningún test previo se rompió.

---

### Bloque 2: Verificación antes de responder y reglas de respuesta

#### F5: Verificación antes de responder (tres momentos)
**Descripción:** §10.1. Incluye el **refresco contra Zernio**: sin él, las respuestas de ManyChat y de la app de Instagram no están en la base cuando el agente mira.

**Criterios:**
- EL SISTEMA DEBE tener `refreshConversationFromPlatform(conversationId)`: trae los **últimos** mensajes de la conversación desde Zernio (orden descendente, hasta 20; el `fetchConversationHistory` actual pagina del más viejo al más nuevo, así que hace falta una variante), guarda los faltantes con la lógica de `backfillConversation` / `isAlreadyStored` y `origin = 'external'` para los salientes que no son propios, y devuelve `{ ok, inserted, error }`. Respeta el rate limit con la espera que ya maneja `rateLimitWaitMs`.
- CUANDO vence la ventana de silencio, EL SISTEMA DEBE llamar al refresco **antes** de armar la ráfaga. CUANDO el refresco falla (error o timeout de 10 s), el turno sigue, pero la acción "Enviar directo" se degrada a "Dejar borrador" y el run guarda `routing.refresh = 'failed'`.
- DADO un turno con `inbound_at = T`, CUANDO al vencer la ventana de silencio (y después del refresco) existe un saliente de la conversación con `created_at > T`, ENTONCES el turno termina **sin llamar al modelo**, el run queda `status = 'already_answered'`, `routing = {"check":"already_answered","moment":1}` y tokens = 0.
- DADO que el modelo ya generó la respuesta, CUANDO antes de enviar o guardar el borrador (con un segundo refresco) existe un saliente con `created_at > T`, ENTONCES no se envía ni se guarda nada, y el run queda `already_answered` con `status_detail = 'after_generation'`.
- La verificación del momento 2 y el envío (o el insert del borrador) DEBEN ser atómicos: misma transacción o bloqueo por conversación (`pg_advisory_xact_lock` sobre el id de la conversación, o equivalente). Documentar la elección en el código.
- CUANDO el saliente es el propio envío de ese turno (aunque vuelva en el refresco), EL SISTEMA NO DEBE considerarlo "ya respondida".
- Test: `tests/agent/reply-check.test.ts` con seis escenarios (sin saliente → sigue; saliente de ManyChat que **solo** aparece al refrescar → abstiene sin tokens; saliente durante la generación → descarta; envío propio que vuelve en el refresco → no bloquea ni se duplica; refresco fallido en modo directo → termina como borrador; refresco fallido en modo borrador → borrador normal). Zernio y el modelo mockeados; el modelo registra cuántas veces se llamó: 0 en el segundo escenario. Pasa con `TEST`.

#### F6: Borrador respondido por otro medio (extiende lo existente)
**Descripción:** hoy `approveDraft` ya descarta con `discard_reason = 'auto:answered_elsewhere'` si encuentra un saliente al aprobar. El problema es que solo mira al aprobar y solo lo que ya está en la base. Se extiende sin estado nuevo.

**Criterios:**
- `approveDraft` DEBE llamar al refresco de §10.1 antes de su chequeo actual.
- EL SISTEMA DEBE tener un job `ssa-cron-drafts-refresh` (cada 5 minutos) que refresca contra Zernio **solo** las conversaciones con borrador `pending` o `failed` (a este volumen, un puñado). CUANDO el refresco trae un saliente posterior a la ráfaga del borrador, el borrador DEBE pasar a `discarded` con `discard_reason = 'auto:answered_elsewhere'` y `decided_at`.
- CUANDO se guarda un saliente propio (respuesta manual, flow) en una conversación con borrador pendiente, el mismo punto de guardado DEBE aplicar la misma transición, sin esperar al job.
- CUANDO la cola está abierta, la fila DEBE desaparecer por realtime con el aviso "Esta conversación ya fue respondida por otro medio".
- Los borradores con `discard_reason` que empieza con `auto:` NO DEBEN contar como descartados ni como ventana perdida en ninguna métrica.
- El job DEBE ser idempotente y respetar el rate limit de Zernio (espera y reintento como `backfill-messages`).
- Test: `tests/agent/answered-elsewhere.test.ts` (transición desde `pending` y desde `failed` por el job, por el guardado de un saliente propio y por `approveDraft`; no transición desde `sent`; un borrador nuevo sigue permitido después; el job no refresca conversaciones sin borrador pendiente). Pasa con `TEST`.

#### F7: Espera tras respuesta externa
**Criterios:**
- EL SISTEMA DEBE tener `agents.external_reply_cooldown_minutes` (int, default 10, check 0–120), editable en la configuración del agente junto a la ventana de silencio con el texto: "Si otra herramienta (por ejemplo ManyChat) respondió hace menos de N minutos, el agente no se mete."
- DADO un saliente con `origin = 'external'` a las T0, CUANDO el último entrante de la ráfaga es anterior a T0 + N minutos, ENTONCES el turno no llama al modelo y el run queda `skipped` con `status_detail = 'external_cooldown'`.
- CUANDO N = 0, la espera DEBE estar desactivada.
- El cambio del parámetro DEBE quedar en `audit_log` con valor anterior y nuevo.
- Test: `tests/agent/external-cooldown.test.ts` (dentro de la ventana, fuera de la ventana, N = 0, saliente `user` no activa la espera). Pasa con `TEST`.

#### F8: Evaluador de reglas
**Descripción:** función pura `evaluateRules(rules, context, stage)` (§10.3).

**Criterios:**
- CUANDO varias reglas coinciden, EL SISTEMA DEBE devolver la primera en orden.
- CUANDO ninguna coincide, DEBE devolver la acción por defecto (`agents.response_rules_default`).
- CUANDO `stage = 'before_generation'`, DEBE recorrer en orden y cortar en la **primera regla que mira campos de la respuesta o de lo que hizo el agente**, devolviendo `pending` si no encontró coincidencia antes. CUANDO `stage = 'after_generation'`, DEBE evaluar la lista completa desde el principio.
- El resultado de evaluar en dos etapas DEBE ser idéntico al de evaluar la lista completa con el contexto completo (propiedad verificada con al menos 10 casos, incluido el corte).
- Una regla deshabilitada (`enabled = false`) NO DEBE evaluarse.
- Una regla con un `field` fuera de la lista cerrada o con un operador inválido DEBE saltearse y reportarse en `invalid_rules` del resultado, sin lanzar error.
- Las comparaciones de texto DEBEN usar `lib/text/normalize.ts` sobre ambos lados ("PRECIOO" coincide con `precio`).
- Test: `tests/agent/rules-evaluator.test.ts` cubre todos los `field` y `op` de §10.3, orden, default, corte en dos etapas, reglas pausadas e inválidas. Pasa con `TEST`.

#### F9: Integración de las reglas en el turno
**Criterios:**
- DADO un canal en modo `rules`, CUANDO la evaluación previa devuelve "No responder", ENTONCES el turno termina sin llamar al modelo, run `skipped` con `status_detail = 'rule:<id>'`, tokens = 0.
- CUANDO la evaluación final devuelve "Enviar directo" y la ventana de mensajería está abierta, EL SISTEMA DEBE enviar como en modo `send`. SI la ventana está cerrada, DEBE quedar como borrador no enviable.
- CUANDO la evaluación devuelve "Dejar borrador", EL SISTEMA DEBE guardar el borrador como en modo `draft`.
- CUANDO la acción es "No responder" después de generar, las herramientas de clasificación que el agente ejecutó DEBEN quedar aplicadas (mismo criterio que en modo borrador) y el run DEBE mostrar los tokens gastados.
- Los guardarraíles DEBEN evaluarse antes que las reglas: un guardarraíl que frena el turno gana siempre.
- Cada run DEBE guardar `agent_runs.routing` con `mode`, `rule_id`, `rule_index`, `action`, `evaluated_at` y `matched`. En modos `send` y `draft`: `{"mode":"send"}` / `{"mode":"draft"}`.
- Test: `tests/agent/rules-turn.test.ts` (no responder antes de generar con 0 llamadas al modelo; enviar directo con ventana abierta y cerrada; borrador; guardarraíl que gana sobre "enviar directo"; `routing` escrito en cada caso). Pasa con `TEST`.

#### F10: Editor de reglas, plantilla y modo del canal
**Criterios:**
- En Agentes → Canales, el selector "Cómo responde" DEBE ofrecer: Envía directo · Deja borradores para aprobar · Según reglas. Al elegir "Según reglas", aparece el editor debajo.
- El editor DEBE permitir: crear reglas con una o más condiciones ("+ y además…"), elegir acción, nombre opcional, pausar/activar, reordenar por arrastre (con alternativa por teclado: botones subir/bajar), borrar, y definir la acción por defecto al pie.
- La primera vez que se elige "Según reglas", DEBE ofrecer cargar la plantilla de §10.4.
- El servidor DEBE validar cada regla con el mismo esquema que el cliente (zod o el validador que use el repo): sin condiciones, listas vacías, campos fuera de la lista cerrada o números fuera de rango → rechazo con mensaje claro.
- El botón Guardar DEBE estar deshabilitado si la versión actual no se simuló.
- CUANDO una regla nunca puede coincidir porque una anterior cubre lo mismo (misma condición, misma o más amplia), el editor DEBE avisar sin bloquear.
- Cada cambio de reglas y de modo DEBE quedar en `audit_log` con valor anterior y nuevo.
- Un Member NO DEBE poder guardar reglas ni cambiar el modo (Server Action responde 403).
- Test: `tests/agent/rules-schema.test.ts` (validación de servidor: 6 casos inválidos y la plantilla completa válida) y `tests/agent/rules-permissions.test.ts` (Member rechazado). Pasan con `TEST`.

#### F11: Simulación
**Criterios:**
- CUANDO se simula, EL SISTEMA DEBE correr `evaluateRules` (la misma función del turno) sobre los turnos de los últimos 30 días con borrador o respuesta del agente, y sobre los entrantes sin turno (para las reglas previas a la generación), **sin llamar a ningún modelo y sin escribir nada**.
- El resultado DEBE incluir: total por acción; coincidencias por regla; hasta 10 ejemplos por acción (mensaje del lead, respuesta del agente, regla); y, para los que se habrían enviado directo, cuántos se aprobaron sin cambios, cuántos se corrigieron y cuántos se descartaron en la realidad.
- La pantalla DEBE decir sus limitaciones: temperatura y etiquetas se toman como están hoy; la intención no se simula para turnos que no la tengan guardada.
- Test: `tests/agent/rules-simulation.test.ts` con un set fijo de 12 turnos y 8 entrantes: totales y contrastes exactos esperados; el cliente de la base está en modo solo lectura en el test (cualquier escritura falla el test). Pasa con `TEST`.

#### F12: Visibilidad de la decisión
**Criterios:**
- En Agentes → Runs: filtro por regla y por resultado `already_answered`, `external_cooldown`, `rule:<id>`. El detalle del run DEBE mostrar una oración generada desde `routing` ("Se envió directo por la regla 9: mensaje corto, respuesta de un mensaje, sin link").
- En la cola de borradores, cada fila DEBE mostrar qué regla la dejó ahí.
- En Runs DEBE mostrarse la salud del refresco contra Zernio en los últimos 7 días: % de refrescos fallidos. SI supera el 5%, EL SISTEMA DEBE crear una notificación para Owner/Admin (una por día como máximo), porque sin refresco la verificación queda ciega.
- Test: `tests/agent/routing-sentence.test.ts` (oración para cada tipo de `routing`) y `tests/agent/refresh-health.test.ts` (cálculo del % y umbral de aviso). Pasan con `TEST`.

> **Bloque 2 listo cuando:** F5 a F12 cumplen sus criterios, `TEST`, `BUILD` y `RLS` salen 0, y ningún test previo se rompió. **El agente sigue apagado.**

---

### Bloque 3: Navegación y dashboard de Chat

#### F13: Navegación global
**Criterios:**
- El menú lateral DEBE mostrar "Dashboards" como primer ítem, con ícono de grilla. "Analytics" NO DEBE existir.
- `/dashboard/analytics` DEBE redirigir (308) a `/dashboard/dashboards/chat`.
- La barra superior DEBE medir 56 px en todas las páginas y ninguna página DEBE renderizar subtítulo. Cada página DEBE tener un ícono ⓘ con tooltip accesible (abre con hover y con foco, `aria-describedby`).
- En anchos menores a 860 px, la barra sigue midiendo 56 px y los filtros del dashboard pasan a una franja fija de 48 px debajo, con scroll horizontal propio.
- Test: `tests/layout/topbar.test.tsx` renderiza el componente de barra superior y verifica alto, ausencia de subtítulo y tooltip. `tests/layout/nav.test.tsx` verifica orden y nombre del menú. Test e2e (Playwright, ya disponible en el entorno) `e2e/topbar.spec.ts` recorre Dashboards, Inbox, Contacts, Agentes y Settings a 1440 px y a 390 px y mide la barra (56 px) y la ausencia de scroll horizontal. Pasan con `TEST` y `npx playwright test e2e/topbar.spec.ts`.

#### F14: Filtros y período
**Criterios:**
- El selector de dashboards DEBE mostrar Chat activo, y Gasto de IA ("Próximamente"), Contenido orgánico y Meta Ads ("Etapa 2") deshabilitados.
- Filtro Canal: Todos · Instagram · WhatsApp (con estado Conectado / Sin conectar).
- Filtro Respondido por: Todos · Agente IA · cada miembro del workspace (con rol) · Automatizaciones · Fuera del sistema.
- Período: los 11 atajos de §6, calendario de dos meses con navegación, sin días futuros, rango en cualquier orden, botón Aplicar. "Hoy" y "Esta semana" usan `workspaces.timezone`.
- Los tres filtros DEBEN vivir en la URL (`range` o `from`/`to`, `channel`, `author`). CUANDO se abre una URL con parámetros, EL SISTEMA DEBE reconstruir exactamente esa vista.
- Cada filtro activo DEBE aparecer como chip con ✕ en la franja de contexto.
- Test: `tests/dashboards/period.test.ts` (los 11 atajos para una fecha fija y zona `America/Costa_Rica`, incluido el cambio de mes y de año) y `tests/dashboards/url-state.test.ts` (ida y vuelta URL ↔ estado). Pasan con `TEST`.

#### F15: Funciones de métricas
**Descripción:** funciones SQL `SECURITY INVOKER` (así la RLS aplica el scope de leads) que calculan todo lo del dashboard a partir de §11.

**Criterios:**
- EL SISTEMA DEBE tener una función de episodios (§11.3) y funciones para: números principales, series de tendencias (por día o por semana si el período supera 62 días, cortando días en la zona del workspace), métricas del agente, borradores, tabla "Quién responde" y "Esperando respuesta ahora".
- Todas DEBEN recibir los mismos parámetros de filtro (`p_from`, `p_to`, `p_channel`, `p_author`) y devolver también los valores del período anterior de igual duración donde corresponda.
- DADO el set de datos fijo de `verify-dashboards.mjs` (definido en §11.8), CUANDO se llaman las funciones, ENTONCES cada valor coincide con el esperado de la tabla de §11.8.
- DADO un Member con scope de 2 de las 6 conversaciones del set, CUANDO llama a las funciones, ENTONCES los valores son los del subconjunto.
- Test: `VERIFY-DASH` sale 0.

#### F16: Pantalla del dashboard — números, tendencias y contexto
**Criterios:** según §15.2 (franja de contexto, aviso de borradores, 5 tarjetas, tendencias con 4 pestañas, tooltips por barra/punto, leyenda con más de una serie, colores estables por serie, barras semanales para más de 62 días).
- Cada bloque DEBE pedirse en paralelo y mostrarse apenas llega, con su skeleton.
- CUANDO una función falla, el bloque DEBE mostrar qué falló y "Reintentar". Nunca un número de relleno.
- Test: `tests/dashboards/cards.test.tsx` (comparación con período anterior, color de "Primera respuesta" cuando baja, "Esperando respuesta ahora" sin comparación) y `tests/dashboards/trends.test.tsx` (4 pestañas, paso a semanal con 63 días, leyenda). Pasan con `TEST`.

#### F17: Sección del agente y aprobación de borradores
**Criterios:** según §15.2 y las definiciones de §11.4 y §11.5.
- CUANDO "Respondido por" es una persona, Automatizaciones o Fuera del sistema, la sección DEBE reemplazarse por el aviso con "Ver todos".
- CUANDO el agente no tiene ningún run, la sección DEBE mostrar "El agente todavía no respondió ninguna conversación" y no porcentajes en 0%.
- CUANDO ningún canal está en `draft` ni en `rules`, la tarjeta de aprobación y el aviso superior NO DEBEN mostrarse como activos; la tarjeta explica cómo activarlo.
- El botón del aviso DEBE ir a `/dashboard/drafts`.
- La tarjeta de resultados de reglas (cuántos turnos se enviaron directo, quedaron en borrador o no se respondieron, por regla) DEBE mostrarse si algún canal está en `rules`.
- Test: incluido en `VERIFY-DASH` (valores) y `tests/dashboards/agent-section.test.tsx` (los tres estados de la sección). Pasan.

#### F18: Tabla "Quién responde"
**Criterios:** según §15.2.
- Tocar una fila DEBE aplicar el filtro de esa persona (y actualizar la URL); tocarla otra vez lo quita.
- Tiempos > 1 h en ámbar con ícono de reloj; > 4 h en rojo con ícono.
- Un Member DEBE ver solo la fila del agente y la suya.
- Test: `tests/dashboards/team-table.test.tsx` (colores por umbral, filtro por clic) y caso Member en `VERIFY-DASH` y `RLS`. Pasan.

> **Bloque 3 listo cuando:** F13 a F18 cumplen sus criterios, `TEST`, `BUILD`, `RLS`, `VERIFY-DASH` y `npx playwright test e2e/topbar.spec.ts` salen 0, y ningún test previo se rompió.

---

### Bloque 4: Patrones de mensajes

#### F19: Textos y categorías
**Criterios:**
- EL SISTEMA DEBE tener `message_categories` y `message_texts` (§12.1), la columna generada `messages.text_norm` y los índices de §12.2.
- CUANDO se inserta un mensaje con texto, un trigger `AFTER INSERT` DEBE crear (o reusar) su fila en `message_texts` con `ON CONFLICT DO NOTHING`. El trigger no debe hacer nada más.
- El backfill DEBE poblar `message_texts` con todos los mensajes existentes.
- EL SISTEMA DEBE crear una categoría "Otro" por dirección (`is_fallback = true`) y una "Solo emoji o adjunto" por dirección (`created_by = 'system'`). CUANDO el texto normalizado es vacío, su fila DEBE ir directo a "Solo emoji o adjunto" con `source = 'rule'`.
- **Lista de textos de botón (nueva, el 2d-B la va a reusar):** columna `message_texts.is_button boolean default false`. La migración la siembra con los textos reales de §10.6 (normalizados), con `source = 'rule'` y su categoría. En Settings → Tareas en segundo plano, una lista editable "Textos de botón conocidos" (agregar, quitar), solo Owner/Admin. Antes de sembrar, verificá contra los datos reales que no falte ninguna variante frecuente (más de 3 apariciones) y sumala.
- CUANDO se insertan "Sí!!", "siii" y "SI", EL SISTEMA DEBE tener una sola fila en `message_texts`.
- Test: incluido en `VERIFY-DASH` (trigger, backfill, una sola fila para las variantes, emoji a su categoría, reglas cargadas) y `tests/patterns/seed-rules.test.ts`. Pasan.

#### F20: Clasificador
**Criterios:**
- CUANDO corre el clasificador, EL SISTEMA DEBE tomar solo filas con `category_id IS NULL AND source IS NULL`, en lotes de hasta 200, con instrucciones, la lista de categorías de esa dirección (nombre, descripción, ejemplos) y hasta 20 correcciones humanas recientes.
- DEBE validar la respuesta del modelo contra un esquema JSON (`items[{ text_id, category_id | new_category{name, description}, confidence 0–1 }]`). Ítems inválidos quedan sin clasificar y se reportan en el run.
- DEBE crear como máximo 3 categorías nuevas por corrida (`created_by = 'model'`); las propuestas que sobren van a "Otro".
- NUNCA DEBE modificar filas con `source = 'human'` o `'rule'`.
- Cada corrida DEBE dejar un run `source = 'message_classification'` con tokens, costo y estado.
- CUANDO el tope de gasto diario o mensual del workspace está alcanzado, la corrida NO DEBE arrancar y DEBE quedar registrado por qué.
- Modelo por defecto: el más barato del proveedor BYOK configurado (configurable en Settings).
- Test: `tests/patterns/classifier.test.ts` con el proveedor mockeado: selección de pendientes, tope de 3 categorías nuevas, no toca `human`/`rule`, JSON inválido parcial, tope de gasto. Pasa con `TEST`.

#### F21: Corrección desde el dashboard
**Criterios:**
- "Mover a…" DEBE actualizar `category_id`, `source = 'human'`, `review_result = 'corrected'`, `reviewed_by`, `reviewed_at`, y registrar en `audit_log`.
- "+ Nueva categoría" DEBE crear la categoría (`created_by = 'user'`) con ese texto.
- Renombrar y Editar descripción DEBEN guardar y registrar en `audit_log`.
- "Unir con…" DEBE mover todas las filas a la categoría destino y marcar la origen con `merged_into_id` y `archived_at`.
- "Otro" NO DEBE poder renombrarse, unirse ni archivarse.
- Solo Owner/Admin: un Member recibe 403 en las Server Actions.
- Test: `tests/patterns/corrections.test.ts` (las 5 acciones, "Otro" protegido, Member rechazado, una corrección no se pisa en la corrida siguiente del clasificador mockeado). Pasa con `TEST`; caso RLS en `RLS`.

#### F22: Sección Patrones en el dashboard
**Criterios:** según §15.2 (lo que más se envía, qué le responden, ver todas las respuestas, variantes con veces y confianza, "También: …", menú ⋯, línea de calidad).
- "Qué le responden" DEBE calcularse según §11.7.
- Los porcentajes de "Qué le responden" DEBEN sumar 100% de las respuestas, y el "% no respondió" DEBE ser exacto.
- Un Member ve los patrones de su scope sin controles de edición.
- Test: valores en `VERIFY-DASH`; `tests/patterns/section.test.tsx` (despliegue de variantes, confianza en ámbar < 70%, controles ocultos para Member). Pasan.

> **Bloque 4 listo cuando:** F19 a F22 cumplen sus criterios, `TEST`, `BUILD`, `RLS` y `VERIFY-DASH` salen 0, y ningún test previo se rompió.

---

### Bloque 5: Tareas en segundo plano, calidad e intención

#### F23: Configuración de tareas en segundo plano
**Criterios:**
- EL SISTEMA DEBE tener `workspaces.ai_background_settings` (jsonb, default `'{}'`) y una pestaña Settings → Tareas en segundo plano, solo Owner/Admin, con las 4 tareas y defaults de §13.1.
- Indexación de Conocimiento NO DEBE poder apagarse.
- Al pasar Resumen de conversación o Clasificación al cierre a Económico, DEBE mostrarse su aviso.
- Arriba: ahorro estimado del mes y si el proveedor soporta API por lote.
- Un Member NO DEBE ver la pestaña ni poder guardar (403).
- Test: `tests/settings/background.test.ts` (defaults cuando no hay entrada, validación del jsonb, Indexación no apagable, Member rechazado). Pasa con `TEST`.

#### F24: Jobs de despacho y recolección
**Criterios:**
- `ssa-cron-bg-dispatch` (cada 15 min) DEBE arrancar, para cada tarea en Económico, una corrida por ventana según frecuencia y hora (zona del workspace), con `dedupe_key = bg:<workspace>:<tarea>:<ventana>`. Correrlo dos veces seguidas NO DEBE crear dos corridas.
- CUANDO el proveedor soporta API por lote, DEBE enviarse por lote; si no, en pocos pedidos normales agrupados.
- `ssa-cron-bg-collect` (cada 15 min) DEBE consultar lotes pendientes, escribir resultados y cerrar el run.
- CUANDO un lote falla, DEBE reintentarse una vez en la siguiente ventana; si vuelve a fallar o no volvió en 24 h, esos ítems DEBEN correr en modo normal y DEBE crearse una notificación para Owner/Admin.
- En Apagado no corre nada; al volver a prender, procesa solo lo pendiente.
- Las tareas Resumen, Clasificación al cierre e Indexación DEBEN leer su modo antes de ejecutarse (en Inmediato, comportamiento actual sin cambios).
- Test: `tests/background/dispatch.test.ts` (ventanas diaria/6 h/hora/semanal en zona del workspace, idempotencia, Apagado) y `tests/background/collect.test.ts` (éxito, fallo con reintento, fallo doble a modo normal, 24 h sin respuesta) con el proveedor mockeado. Pasan con `TEST`.

#### F25: Calidad, revisión rápida, set de control y versiones
**Criterios:** según §13.3.
- Precisión estimada DEBE calcularse **solo** con resultados de la revisión rápida y mostrar sobre cuántos textos.
- "Sin categoría" DEBE calcularse sobre el volumen de mensajes, no sobre textos distintos.
- La revisión rápida DEBE mostrar primero las de menor confianza y las categorías nuevas; ✓ / Cambiar a… / Saltar DEBEN funcionar y avanzar; confirmadas y corregidas pasan al set de control.
- Crear una versión nueva del clasificador DEBE evaluarla contra el set de control sin modificar ninguna fila y dejar un run `message_classification_eval`; el resultado aparece junto a la versión activa. "Volver a esta" reactiva. "Reclasificar los dudosos" no toca filas `human`.
- Test: `tests/patterns/quality.test.ts` (fórmulas de los 4 indicadores y la calibración por tramo sobre un set fijo) y `tests/patterns/versions.test.ts` (evaluación sin escrituras, activar y volver). Pasan con `TEST`.

#### F26: Intención declarada por el agente y reglas por intención
**Criterios:**
- En cada turno, la salida estructurada del agente DEBE incluir `intent: { category_id, confidence }` elegido entre las categorías `inbound` activas. Se guarda en el run (`agent_runs.intent`, jsonb).
- CUANDO el `category_id` devuelto no existe, se guarda `intent = null` y el turno sigue.
- La condición "Intención" (categoría es / no es, confianza mínima) DEBE estar disponible en el editor de reglas y en el evaluador (`stage = 'after_generation'`).
- El dashboard y el editor de reglas DEBEN mostrar el % de borradores aprobados sin cambios **por categoría de intención**, con la cantidad detrás.
- CUANDO una categoría tiene ≥ 20 borradores finales en 30 días y ≥ 85% aprobados sin cambios, el editor DEBE mostrar la sugerencia "¿Crear una regla para enviarlas directo?" con botón que arma la regla y la deja lista para simular (no la guarda).
- Test: `tests/agent/intent.test.ts` (intent válido, id inexistente → null, condición en el evaluador) y `tests/agent/graduation.test.ts` (umbral de 20 y 85%, regla generada correcta). Pasan con `TEST`.

> **Bloque 5 listo cuando:** F23 a F26 cumplen sus criterios, `TEST`, `BUILD`, `RLS` y `VERIFY-DASH` salen 0, y ningún test previo se rompió.

---

### Definición de "listo" de toda la corrida

Los bloques 1 a 5 están listos; `npx vitest run`, `npm run build`, `npm run lint`, `node scripts/verify-rls.mjs`, `node scripts/verify-dashboards.mjs` y `npx playwright test` salen 0; las migraciones se aplicaron en orden; `docs/agente-ia.md`, `docs/dashboards.md` (nuevo) y la bitácora de construcción están actualizados; **el agente sigue apagado**; y cualquier bloqueo o decisión tomada sin confirmación quedó anotado en `docs/PENDIENTE.md` con qué se hizo y por qué.

### Funcionalidades de fases siguientes (no se construyen ahora)
- Asistente para armar reglas en lenguaje natural — después de Etapa 1
- Corrección de categoría desde un mensaje del Inbox — después de Etapa 1
- Dashboard de Gasto de IA — cuando Wendy lo pida
- Dashboards de contenido orgánico y Meta Ads — Etapa 2
- Consultar patrones y métricas por lenguaje natural — Etapa 3 (agente integral)
- Tabla de agregados diarios — solo si la performance real lo exige

---

## 8. Flujos principales

### Flujo 1: Lead toca un botón de ManyChat (agente prendido en borrador)
1. El lead toca "Si envíamelo". El entrante llega y se guarda.
2. Arranca la ventana de silencio (60 s).
3. ManyChat responde a los 2 s. Zernio **no** avisa por webhook, pero el mensaje queda en su historial.
4. Vence la ventana. **Refresco:** el sistema trae los últimos mensajes desde Zernio y guarda el de ManyChat con `origin = 'external'`. **Momento 1:** hay un saliente posterior → run `already_answered`, cero tokens. Fin.

**Resultado:** el agente no pisa a ManyChat y no gasta.

### Flujo 2: Lead escribe en medio de un flow de ManyChat
1. ManyChat mandó el paso 1 de su flow a las 10:00.
2. El lead escribe "¿y cuánto sale?" a las 10:03.
3. Vence la ventana. Momento 1: no hay saliente posterior.
4. **Espera externa:** hubo un `external` hace 3 minutos (< 10) → run `skipped / external_cooldown`. Fin.
5. Si el lead vuelve a escribir a las 10:20, el turno corre normal y el agente ve en el historial lo que mandó ManyChat.

### Flujo 3: Turno con "Según reglas"
1. Entrante "hola, cuánto cuesta el programa?" de un contacto tibio.
2. Momento 1 y espera externa: nada.
3. Guardarraíles: pasan.
4. Evaluación previa: la regla 1 (texto de botón) no coincide; la regla 3 mira la respuesta del agente → corte, `pending`.
5. El agente genera: responde con el precio y declara `intent = "Pregunta el precio", 0.97`.
6. Evaluación final: regla 3 ("respuesta contiene precio") → Dejar borrador.
7. Momento 2: nada entró. Se guarda el borrador con `routing.rule_id = r_3`.
8. En la cola, la fila dice "Regla 3 · menciona precio".
9. Si Wendy responde desde la app de Instagram antes de aprobar → **momento 3:** en menos de 5 minutos el job lo trae con el refresco, el borrador pasa a descartado automático (`auto:answered_elsewhere`) y desaparece de la cola. Si Wendy intenta aprobarlo antes, `approveDraft` refresca primero y lo frena.

### Flujo 4: Wendy decide pasar una categoría a envío directo
1. En el dashboard ve: "Pregunta cuándo empieza: 95% aprobadas sin cambios (42 borradores)".
2. En el editor de reglas aparece la sugerencia con botón.
3. La regla se arma; Wendy la ubica debajo de las reglas de borrador y simula.
4. La simulación muestra: 38 se habrían enviado solos; de esos, 36 se aprobaron sin cambios y 2 se corrigieron. Ve los 2 ejemplos.
5. Guarda. Queda en `audit_log`.

### Flujo 5: Clasificación nocturna y corrección
1. Durante el día, cada mensaje nuevo crea su fila en `message_texts` (sin categoría). El dashboard lo agrupa por normalización y lo cuenta como "sin clasificar todavía".
2. A las 03:00, el despacho arma el lote con los pendientes y lo envía a la API por lote del proveedor.
3. El recolector recibe el resultado, asigna categorías (máximo 3 nuevas), cierra el run con su costo.
4. A la mañana, Wendy ve "me re copa" en "Dice que sí" con 61% (ámbar). Lo confirma en la revisión rápida → entra al set de control.
5. Ve "ok" en "Lo ve más tarde" y lo mueve a "Dice que sí" → `source = 'human'`, nunca más lo toca el modelo.

### Flujo 6: Wendy mira el dashboard filtrado por una persona
1. Toca la fila de Sofía en "Quién responde".
2. El filtro "Respondido por: Sofía" se aplica, la URL cambia, vuelve arriba.
3. Números y tendencias muestran solo lo de Sofía; la sección del agente muestra el aviso; patrones muestra lo que envía Sofía.
4. Toca el ✕ del chip y vuelve a Todos.

---

## 9. Base técnica heredada

- **Proyecto base:** fork de ZernFlow (MIT), con Fases 1 y 2 y Bloques 1–2d de la Fase 3 construidos encima.
- **Framework:** Next.js 16 (App Router) + React 19 + TypeScript 5. Tailwind CSS v4. Vercel AI SDK v6. `@supabase/supabase-js` 2.95 + `@supabase/ssr` 0.8. `@zernio/node`. Vitest 3.
- **Patterns a respetar:** Server Components por defecto, islas Client para interactividad; mutaciones en Server Actions; webhooks en `app/api/`; Service Role solo en servidor; `requireWorkspaceAdmin()` para lo que es de Owner/Admin; `logAudit` para auditoría; helper único de IA con `source`; `scheduled_jobs` + `pg_cron` para jobs; filtros por URL como en la bandeja y el CRM; realtime en `messages`, `conversations` y `agent_drafts`.
- **No reescribir:** runner del agente, ráfaga y debounce, modo borrador y sus cuatro acciones, guardarraíles, registro de herramientas, etiquetas con efecto (2d), backfill de borradores (2d), cola de borradores y su navegación (2d).
- **Tablas que se tocan:** `messages`, `workspaces`, `agents`, `agent_runs`, `agent_drafts`, `audit_log` (solo lectura/escritura vía `logAudit`), `conversations` (lectura), `contacts` y `contact_tags` (lectura), `channels` (lectura).
- **Scripts existentes:** `scripts/verify-rls.mjs`, `scripts/verify-crm.mjs`. Se agrega `scripts/verify-dashboards.mjs`.

---

## 10. Detalle del Bloque 2

### 10.1 Verificación: definición y momentos

"Ya respondida" = existe en `messages` un saliente de la conversación con `created_at > agent_runs.inbound_at` que no es el envío de este turno.

**El refresco es la pieza clave.** Zernio no avisa por webhook lo que se manda desde ManyChat o la app de Instagram; solo aparece en el historial. Por eso, justo antes de cada verificación, se traen los últimos mensajes de la conversación desde Zernio y se guardan los faltantes como `external`. Con la ventana de silencio de 60 s y ManyChat respondiendo en 2–3 s, cuando el agente refresca la respuesta de ManyChat ya existe en Zernio.

| # | Cuándo | Resultado | Costo |
|---|---|---|---|
| 1 | Al vencer la ventana de silencio: **refresco** y después verificación, antes del modelo | `already_answered`, `routing.moment = 1` | 0 tokens, 1 llamada a Zernio |
| 2 | Después de generar: **refresco** y verificación atómica con el envío/guardado | `already_answered`, `status_detail = 'after_generation'` | Tokens de esa generación |
| 3 | Con borrador `pending`/`failed`: job cada 5 min con refresco, al guardarse un saliente propio y al aprobar | Borrador → `discarded` + `auto:answered_elsewhere` | 0 tokens |

Con `bundle_window_seconds = 60`, el 97% de las respuestas de ManyChat a botones ya existe en Zernio cuando vence la ventana y se hace el refresco. No hace falta cambiarla.

### 10.2 Espera tras respuesta externa

Si hubo un saliente `origin = 'external'` en los N minutos anteriores al último entrante de la ráfaga → `skipped / external_cooldown`. N = `agents.external_reply_cooldown_minutes` (default 10, 0 = desactivado).

### 10.3 Reglas: formato, campos y operadores

```json
{
  "id": "r_3",
  "name": "Menciona precio",
  "enabled": true,
  "conditions": [
    { "field": "response.text", "op": "contains_any", "value": ["precio", "$", "usd", "cuotas", "link de pago", "descuento"] }
  ],
  "action": "draft"
}
```

Acciones: `send` (Enviar directo), `draft` (Dejar borrador), `skip` (No responder).

| `field` | Etiqueta en pantalla | Operadores | Valor | Etapa |
|---|---|---|---|---|
| `inbound.text` | El mensaje del lead | `contains_any`, `not_contains_any` | lista de palabras | previa |
| `inbound.is_known_button` | Es un texto de botón conocido | `is` | sí/no | previa |
| `inbound.length` | Largo del mensaje del lead | `gt`, `lt` | número (caracteres) | previa |
| `inbound.burst_count` | Mensajes en la ráfaga | `gt`, `lt` | número | previa |
| `contact.temperature` | Temperatura del contacto | `is`, `is_not` | frío/tibio/caliente | previa |
| `contact.tags` | Etiquetas del contacto | `has_any`, `has_none` | lista de etiquetas | previa |
| `contact.is_new` | Es contacto nuevo | `is` | sí/no | previa |
| `contact.previous_episodes` | Conversaciones previas | `gt`, `lt` | número | previa |
| `conversation.assigned` | Está asignada | `is` / `is` persona | sí/no · usuario | previa |
| `conversation.window_hours_left` | Ventana restante | `gt`, `lt` | horas | previa |
| `conversation.is_episode_start` | Primer mensaje del episodio | `is` | sí/no | previa |
| `conversation.channel` | Canal | `is` | canal | previa |
| `time.in_business_hours` | Dentro del horario de atención | `is` | sí/no | previa |
| `response.text` | La respuesta del agente | `contains_any`, `not_contains_any` | lista de palabras | final |
| `response.has_link` | Incluye un link | `is` | sí/no | final |
| `response.parts` | Mensajes de la respuesta | `gt`, `lt` | número | final |
| `agent.wants_escalate` | Quiere derivar | `is` | sí/no | final |
| `agent.kb_miss` | No encontró en Conocimiento | `is` | sí/no | final |
| `agent.used_tool` | Usó la herramienta | `is` | nombre de herramienta | final |
| `intent.category` | La intención del mensaje | `is`, `is_not` + `min_confidence` | categoría + % | final (Bloque 5) |

- La lista es cerrada y vive en código (`lib/agent/rules/fields.ts`), con tipo de valor y operadores válidos. Es la fuente única para el editor, el validador del servidor y el evaluador.
- "Horario de atención": usar la definición que ya tienen los guardarraíles del agente.
- "Texto de botón conocido": `message_texts.is_button = true` para el texto normalizado de la ráfaga (F19).

### 10.4 Plantilla inicial

| # | Si… | Entonces |
|---|---|---|
| 1 | El mensaje del lead es un texto de botón conocido | No responder |
| 2 | El mensaje del lead contiene `gracias por ponerte en contacto`, `recibimos tu mensaje`, `te responderemos a la brevedad` | No responder |
| 3 | La respuesta del agente contiene `precio`, `$`, `usd`, `cuotas`, `link de pago`, `descuento`, `inversion` | Dejar borrador |
| 4 | El agente quiere derivar | Dejar borrador |
| 5 | El agente no encontró la respuesta en Conocimiento | Dejar borrador |
| 6 | La temperatura del contacto es caliente | Dejar borrador |
| 7 | El contacto tiene `alumno-actual` o `soporte-alumno` | Dejar borrador |
| 8 | El mensaje del lead tiene más de 200 caracteres | Dejar borrador |
| 9 | El mensaje del lead tiene menos de 25 caracteres **y** la respuesta tiene 1 mensaje **y** no incluye un link | Enviar directo |
| — | Si ninguna coincide | Dejar borrador |

### 10.6 Textos de botón para sembrar (datos reales al 25/09/2026)

| Texto (normalizado) | Apariciones |
|---|---|
| `si enviamelo` | 172 |
| `quiero aprender` | 42 |
| `tengo un negocio` | 32 |
| `tengo una base` | 31 |
| `si quiero a clase` | 29 |
| `si quiero la clase` | 10 |
| `generar contenido` | 9 |
| `empiezo de 0` | 8 |
| `automatizar todo` | 8 |
| `equipo ventas ia` | 4 |
| `agentes` | 3 |
| `responder mensajes` | 2 |

Más las variantes que figuran en el prompt del 2d: `recurso gratuito`, `quiero construir nuevas habilidades`, `buscando construir una habilidad nueva`, `ya tengo un negocio propio`, `tengo experiencia`. Verificar contra la base antes de sembrar.

### 10.5 Flujo del turno con este bloque

1. Entrante → guardar → automatizaciones internas (sin cambios).
2. Ventana de silencio (sin cambios).
3. **Refresco + momento 1.** Si ya fue respondida → fin.
4. **Espera externa.** Si corresponde → fin.
5. Guardarraíles (sin cambios).
6. Si modo `rules`: **evaluación previa**. "No responder" → fin sin tokens. Otra acción previa → se recuerda y se sigue.
7. El agente genera y ejecuta herramientas de clasificación (sin cambios). Declara `intent` (Bloque 5).
8. Si modo `rules` y no hubo decisión en 6: **evaluación final**.
9. **Refresco + momento 2**, atómico con el paso 10. Si el refresco falló, "Enviar directo" se degrada a borrador.
10. Enviar / guardar borrador / no responder. Escribir `routing`.
11. **Momento 3** mientras el borrador esté pendiente (job cada 5 min, guardado de salientes propios y `approveDraft`).

---

## 11. Definiciones de las métricas (Bloque 3)

Todo respeta los tres filtros y el scope de leads. "Período anterior" = mismo largo, inmediatamente antes. Días cortados en `workspaces.timezone`.

### 11.1 Mensajes
- **Recibidos / Enviados:** `messages` por `direction` en el período.
- **Enviados por autor:** por `origin`, agrupado: Agente IA (`agent`) · Equipo (`user`) · Automatizaciones (`flow` + `sequence` + `broadcast`) · Fuera del sistema (`external`).

### 11.2 Filtro "Respondido por"
Acota los salientes a ese `origin` (o a ese `sent_by_user_id` para una persona) y las métricas por conversación a los episodios donde ese autor envió al menos un mensaje.

### 11.3 Episodio
Empieza con un entrante que es el primero del contacto en ese canal, o el primero después de `conversations.closed_at`, o el primero después de `agents.close_after_inactive_hours` sin mensajes. Termina con el cierre o esa inactividad. "Conversaciones nuevas" = episodios cuyo mensaje inicial cae en el período. Función SQL, sin tabla.

### 11.4 Tiempos

| Métrica | Cálculo |
|---|---|
| Primera respuesta (general) | Por episodio: primer saliente − primer entrante. Mediana. Excluye episodios sin respuesta |
| Primera respuesta de una persona | Su primer saliente − max(primer entrante, momento de asignación/derivación a esa persona, desde `audit_log`) |
| Respuesta (mediana) | Para cada saliente del autor cuyo mensaje anterior es entrante: saliente − último entrante anterior |
| Respondidas en menos de 1 h | % de esas respuestas < 1 h |
| Lo que tarda el agente | `agent_runs.completed_at − inbound_at` |
| Lo que tarda la aprobación | `agent_runs.responded_at − completed_at` en runs `drafted` enviados |

### 11.5 Agente

| Métrica | Cálculo |
|---|---|
| Actuó | Episodios con al menos: un saliente `origin = 'agent'`, un borrador del agente (cualquier estado), o una entrada de `audit_log` con `performed_by_agent_id` sobre la conversación o su contacto. ÷ conversaciones nuevas |
| Tomó desde el primer mensaje | Episodios cuyo primer saliente es `origin = 'agent'`, aunque después haya derivado. ÷ conversaciones nuevas |
| Derivó a una persona | Episodios con acción de derivación del agente en `audit_log` (o run `escalated`), o borrador aprobado con sugerencia de derivar aplicada. ÷ conversaciones nuevas |
| Quién respondió primero | `origin` del primer saliente del episodio. Sin saliente → "Todavía sin respuesta" |
| Por qué derivó | Motivo registrado al derivar (explorar dónde lo guarda el 2b: `audit_log.metadata` o `agent_runs.status_detail`) |
| Acciones del agente | `audit_log` con `performed_by_agent_id`, por tipo |
| Resultados de reglas | `agent_runs.routing` agrupado por `rule_id` y `action` |

### 11.6 Borradores (excluye `superseded`, `regenerated`, los descartes automáticos `discard_reason LIKE 'auto:%'` y los de backfill del 2d-B cuando exista)

| Resultado | Condición |
|---|---|
| Aprobada sin cambios | `status = 'sent'` y `sent_body` = `body` |
| Corregida antes de enviar | `status = 'sent'` y `sent_body` ≠ `body` |
| Respondida a mano | `status = 'discarded'`, `discard_reason` no automático, y hubo un saliente `origin = 'user'` antes del siguiente entrante |
| Descartada | `status = 'discarded'`, `discard_reason` no automático, sin respuesta manual posterior |
| Ventana perdida | `window_missed_at` no nulo |

### 11.7 "Qué le responden"
Un entrante es respuesta a una categoría de salientes si es el **primer entrante después** de un saliente de esa categoría en la misma conversación, dentro de las 24 h. "% obtuvo respuesta" = salientes con respuesta ÷ salientes de la categoría.

### 11.8 Set de datos fijo de `verify-dashboards.mjs`

El script crea un workspace con 3 usuarios (Owner, Member A, Member B), 1 agente, 1 canal Instagram y 6 conversaciones con mensajes en fechas fijas (en `America/Costa_Rica`), cubriendo: (1) tomada por el agente y derivada a Member A 2 h después; (2) respondida primero por ManyChat (`external`) a los 2 s; (3) respondida primero por Member B; (4) sin respuesta; (5) con borrador aprobado sin cambios; (6) con borrador corregido y otro descartado con `auto:answered_elsewhere`. Claude Code define las fechas y calcula a mano los valores esperados de cada métrica de §11.1–§11.7 **antes** de escribir las funciones, y los deja en el script como constantes. El Member A tiene scope sobre las conversaciones 1 y 3.

### 11.9 Esperando respuesta ahora
Conversaciones no borradas, abiertas, con último mensaje entrante de hace más de 1 h, excluyendo `do_not_contact` y `agent_disabled_by_tag_id` no nulo.

---

## 12. Modelo de datos

### 12.1 Tablas nuevas

**`message_categories`**

| Campo | Tipo | Req. | Descripción | Relación |
|---|---|---|---|---|
| id | uuid (gen_random_uuid) | sí | PK | — |
| workspace_id | uuid | sí | Aislamiento | FK → workspaces |
| direction | text check (`inbound`,`outbound`) | sí | Listas separadas | — |
| name | text | sí | Nombre visible | — |
| description | text | no | Qué entra y qué no (lo usa el clasificador) | — |
| examples | text[] default `'{}'` | no | 2–3 ejemplos | — |
| is_fallback | boolean default false | sí | "Otro" | — |
| created_by | text check (`model`,`user`,`system`) | sí | Origen | — |
| created_by_user_id | uuid | no | Si la creó una persona | FK → auth.users |
| merged_into_id | uuid | no | Si se unió | FK → message_categories |
| archived_at | timestamptz | no | — | — |
| created_at / updated_at | timestamptz | sí | — | — |

Índices: único parcial `(workspace_id, direction, lower(name)) WHERE archived_at IS NULL`; único parcial `(workspace_id, direction) WHERE is_fallback`.

**`message_texts`**

| Campo | Tipo | Req. | Descripción | Relación |
|---|---|---|---|---|
| id | uuid | sí | PK | — |
| workspace_id | uuid | sí | — | FK → workspaces |
| direction | text | sí | `inbound`/`outbound` | — |
| normalized_text | text | sí | `normalize_message_text` | — |
| sample_text | text | sí | Versión original para mostrar | — |
| category_id | uuid | no | Null = sin clasificar | FK → message_categories |
| confidence | numeric(3,2) | no | 0–1 | — |
| source | text check (`rule`,`model`,`human`) | no | Quién asignó | — |
| prompt_version | int | no | Versión del clasificador | — |
| run_id | uuid | no | Corrida | FK → agent_runs |
| classified_at | timestamptz | no | — | — |
| reviewed_at / reviewed_by | timestamptz / uuid | no | Última revisión humana | FK → auth.users |
| review_result | text check (`ok`,`corrected`) | no | — | — |
| first_seen_at | timestamptz | sí | — | — |
| created_at / updated_at | timestamptz | sí | — | — |

Índices: único `(workspace_id, direction, normalized_text)`; `(workspace_id, category_id)`; parcial `(workspace_id, direction) WHERE category_id IS NULL`.

### 12.2 Columnas nuevas y cambios

| Tabla | Cambio | Detalle |
|---|---|---|
| `messages` | `origin` text | check (`agent`,`user`,`flow`,`sequence`,`broadcast`,`external`); null en entrantes; check que exige no nulo en salientes (después del backfill) |
| `messages` | `text_norm` text generada almacenada | `normalize_message_text(text)` |
| `workspaces` | `timezone` text default `'America/Costa_Rica'` | F3 |
| `workspaces` | `ai_background_settings` jsonb default `'{}'` | F23 |
| `agents` | `channel_modes` acepta `rules` | F10 |
| `agents` | `response_rules` jsonb default `'[]'` | Reglas |
| `agents` | `response_rules_default` text default `'draft'` check (`send`,`draft`,`skip`) | Acción por defecto |
| `agents` | `external_reply_cooldown_minutes` int default 10 check 0–120 | F7 |
| `agent_runs` | `status` acepta `already_answered`; `source` acepta `message_classification`, `message_classification_eval` | F4 |
| `agent_runs` | `routing` jsonb | F9 |
| `agent_runs` | `intent` jsonb | F26 |
| `agent_drafts` | Sin cambios de esquema. Se usa `discard_reason = 'auto:answered_elsewhere'` (ya existe) | F6 |
| `message_texts` | `is_button` boolean default false | F19 |

Índices nuevos en `messages`: `(workspace_id, direction, text_norm)`; `(workspace_id, origin, created_at)`; verificar `(conversation_id, created_at)`.

Ejemplo de `ai_background_settings`:

```json
{
  "message_classification": { "mode": "batch", "frequency": "daily", "hour": "03:00", "model": null,
    "active_prompt_version": 1,
    "prompt_versions": [ { "version": 1, "prompt": "…", "note": "Versión inicial", "created_at": "…",
      "eval": { "accuracy": null, "n": 0, "run_id": null } } ] },
  "conversation_summary": { "mode": "now" },
  "close_classification": { "mode": "now" },
  "knowledge_indexing": { "mode": "now" }
}
```

### 12.3 Trigger
`AFTER INSERT` en `messages` con texto no vacío → `INSERT … ON CONFLICT DO NOTHING` en `message_texts`. `SECURITY DEFINER`, `SET search_path = ''`. Nada más: no puede frenar el receptor.

El punto de guardado de salientes (función o código compartido) también dispara el momento 3 (F6). Si se hace en SQL, un segundo trigger `AFTER INSERT` sobre salientes; si se hace en código, en el helper único de guardado. Elegir uno y documentarlo.

### 12.4 Notas de optimización
- **No se crea** tabla de reglas: son pocas, se leen enteras en cada turno y viven con el agente. `response_rules` jsonb.
- **No se crea** tabla de versiones del clasificador: son pocas; viven en `ai_background_settings`.
- **No se crea** tabla de episodios: se derivan con una función.
- **No se crea** tabla de "set de control": son filas revisadas de `message_texts`.
- **No se crea** tabla de agregados diarios: el volumen actual no lo justifica (§14).
- **Contemplado para después:** `messages.origin` ya soporta canales de Etapa 2; `message_categories` tiene `direction` para sumar categorías de comentarios si la Etapa 2 las necesita.

### 12.5 Políticas de datos
- **Auditoría:** cambios de modo, reglas, espera externa, categorías (crear, renombrar, describir, unir), correcciones, configuración de tareas y versiones del clasificador → `audit_log` con anterior y nuevo.
- **Soft delete:** las categorías se archivan (`archived_at`), no se borran.
- **Retención:** `message_texts.sample_text` sigue la política de texto de mensajes (12 meses). Al purgar, si un texto ya no aparece en ningún mensaje se borra su fila, salvo `source = 'human'` o revisada (se conserva sin `sample_text`).

---

## 13. Detalle del Bloque 5

### 13.1 Tareas

| Tarea | Descripción en pantalla | Default | Nota |
|---|---|---|---|
| Clasificación de mensajes | Agrupa los mensajes por intención para el dashboard | Económico, diario, 03:00 | — |
| Resumen de conversación | La memoria del agente sobre cada contacto | Inmediato | En Económico: "Si el contacto vuelve a escribir antes de la corrida, el agente no tiene la memoria actualizada" |
| Clasificación al cierre | Tags, temperatura y seguimiento al cerrar una conversación | Inmediato | En Económico: "Un lead que se calentó hoy aparece como caliente recién mañana" |
| Indexación de Conocimiento | Prepara los documentos que subís para que el agente los use | Inmediato | No se puede apagar |

Columnas: Tarea · Modo · Frecuencia (diaria, cada 6 h, cada hora, semanal) · Hora · Última corrida · Gasto del mes. Pie: "Si una corrida por lote falla o tarda más de 24 h, se reintenta y después corre en modo normal. Todas respetan los topes de gasto."

### 13.2 Costo esperado
Con el volumen actual (~430 textos nuevos por mes), la clasificación cuesta **menos de USD 0,10 por mes**, y la clasificación inicial del historial alrededor de USD 0,01. Confirmar precios del modelo chico y del descuento por lote al construir y dejarlos en `docs/dashboards.md`.

### 13.3 Calidad

| Indicador | Definición |
|---|---|
| Precisión estimada | Aciertos ÷ revisados, solo en la revisión rápida. Con N |
| Corregidos | Filas clasificadas por el modelo en el período que alguien movió después |
| Sin categoría | Parte del **volumen de mensajes** en "Otro" o sin clasificar |
| Dudosos | Filas con confianza < 0,70 |
| Precisión por semana | Mini línea con referencia en 90% |
| Categorías con más correcciones | Top 3 |
| ¿La confianza es creíble? | Aciertos reales por tramo (> 90%, 70–90%, < 70%) |

Revisión rápida: tarjetas de a una, 20 por sesión, primero menor confianza y categorías nuevas. Set de control: filas con `review_result` no nulo o `source = 'human'`. Versiones: evaluar contra el set sin escribir (`message_classification_eval`), activar, volver, reclasificar dudosos (sin tocar `human`).

---

## 14. Arquitectura y stack

| Componente | Tecnología | Justificación |
|---|---|---|
| Frontend | Next.js 16 + React 19, Server Components con islas Client (filtros, período, gráficos, editor de reglas) | Patrón del fork |
| Gráficos | La librería que ya use la pestaña Costos del agente; si no hay ninguna, SVG propio como en el prototipo | No sumar peso |
| Métricas | Funciones SQL `SECURITY INVOKER` llamadas por RPC desde Server Components | Una sola fuente de verdad; la RLS aplica el scope |
| Evaluador de reglas | Función pura TS en `lib/agent/rules/` | Testeable, compartida por turno y simulación |
| Clasificador | Helper único de IA del proyecto, con API por lote del proveedor cuando exista | BYOK, costos registrados |
| Jobs | `scheduled_jobs` + `pg_cron` | Patrón existente |
| Tests | Vitest 3 + Playwright (e2e de la barra) + scripts `verify-*.mjs` | Verificación por máquina |

**Diagrama conceptual:**
`Instagram → Zernio → webhook → guardar (origin, text_norm, trigger message_texts, momento 3) → ¿automatización interna? → ventana de silencio → momento 1 → espera externa → guardarraíles → reglas (previa) → agente (+intent) → reglas (final) → momento 2 + envío/borrador (atómico) → routing`
En paralelo: `bg-dispatch → lote al proveedor → bg-collect → message_texts`. Aparte: `dashboard → funciones SQL sobre messages / agent_runs / agent_drafts / audit_log / message_texts`.

**Performance:** dashboard completo en < 1,5 s (p95) con "Este mes" y < 3 s con "Histórico" sobre los datos reales. Si no se cumple, anotarlo en `docs/PENDIENTE.md` con la medición; no construir agregados.

**Storage:** no aplica (no hay archivos nuevos).

---

## 15. Pantallas

### 15.1 Convenciones globales
- **Navegación:** sidebar con Dashboards primero. Barra superior de 56 px en todas las páginas: título · ⓘ con tooltip · controles propios · espacio · controles de la derecha. Sin subtítulo.
- **Sistema visual:** el del fork (neutro, Inter, acento actual). Colores de series estables: Agente, Equipo, Automatizaciones y Fuera del sistema con un color cada uno, validados para daltonismo en claro y oscuro. Estados (ámbar, rojo, verde) siempre con ícono o texto además del color.
- **Estados:** skeleton por bloque; vacío con explicación y acción; error con qué falló y "Reintentar"; toasts que dicen qué pasó.
- **Responsive:** < 860 px sidebar en drawer y filtros en franja propia; tarjetas en 2 columnas a 390 px; tablas con scroll horizontal propio; sin scroll horizontal de página.

### 15.2 Pantalla: Dashboards → Chat
- **URL:** `/dashboard/dashboards/chat`
- **Barra:** `Dashboards ⓘ │ [● Chat ▾] ··· [Canal ▾] [Respondido por ▾] [📅 Período]`. Tooltip: "Métricas de tus conversaciones: cuánto se habla, quién responde y qué tan rápido, y cómo está trabajando el agente. Filtrá por canal y por quién respondió arriba a la derecha. Un Member ve solo sus leads; Owner y Admin, todo el workspace."
- **Franja de contexto:** alcance, rango, chips de filtros con ✕, "Actualizado hace …".
- **Aviso de borradores:** si algún canal está en `draft` o `rules` y el filtro es Todos, Agente o una persona: pendientes, cuántos con < 6 h, ventanas perdidas en 7 días, botón "Ir a la cola de aprobación".
- **5 tarjetas:** Conversaciones nuevas (o "en que participó") · Mensajes recibidos · Mensajes enviados (o "por X") · Primera respuesta (tooltip con definición; verde si baja) · Esperando respuesta ahora (ámbar, sin comparación, link "Ver en Inbox").
- **Tendencias:** pestañas Conversaciones nuevas (barras) · Mensajes recibidos y enviados (barras agrupadas) · Enviados por autor (barras apiladas con 2 px de separación) · Primera respuesta (línea con referencia punteada en 1 h). Totales arriba. Tooltip por barra/punto. Semanal si > 62 días.
- **El agente:** tres porcentajes (Actuó, Tomó desde el primer mensaje, Derivó) con cantidad, comparación en puntos y mini línea de 8 semanas · Quién respondió primero (barra 100% + leyenda con cantidades) · Por qué derivó · Aprobación de respuestas (barra 100% de los 5 resultados, mini línea de aprobadas sin cambios con referencia 85%, 4 números, aprobación por categoría en Bloque 5) · Resultados de reglas (si hay canal en `rules`) · Acciones del agente. Link "Ver runs y acciones en Agentes →".
- **Quién responde:** tabla con Conversaciones · Mensajes enviados · Primera respuesta · Respuesta · Respondidas en < 1 h · Derivaciones recibidas · Borradores aprobados. Fila clicable = filtro.
- **Patrones:** "Lo que más se envía" (categorías con autor principal, variantes, % obtuvo respuesta, envíos) · "Qué le responden" / "Lo que más responden" · variantes desplegables con veces, confianza (ámbar < 70%) y "Mover a…" · menú ⋯ (Renombrar, Editar descripción, Unir con…) · línea de calidad con link a Settings.
- **Estados:** cargando (skeleton), sin datos ("No hubo conversaciones en este período" + "Ver últimos 30 días"), WhatsApp sin conectar, agente sin runs, sin canales en borrador, error por bloque.
- **Permisos:** Member en su scope; sin controles de edición en patrones; tabla con agente + su fila.

### 15.3 Pantalla: Agentes → Canales (modo y reglas)
- Selector "Cómo responde" con las tres opciones y su explicación.
- Editor de reglas: lista numerada que se lee como oración; por regla: nombre, condiciones con "+ y además…", acción, pausar, subir/bajar y arrastre, borrar. Pie: "Si ninguna regla coincide:". Aviso de regla inalcanzable. Botones Simular y Guardar (Guardar deshabilitado sin simular).
- Panel de simulación: totales por acción, coincidencias por regla, ejemplos por acción, contraste con la realidad, limitaciones.
- Tarjeta de sugerencia por categoría (Bloque 5).
- En la configuración de tiempos del agente: campo "Espera después de una respuesta externa (minutos)".
- Member: no ve el editor.

### 15.4 Pantalla: Agentes → Runs (extensión)
- Filtros nuevos: regla, `already_answered`, `external_cooldown`, `rule:<id>`.
- Detalle: oración de decisión desde `routing`.
- Indicador de salud del refresco contra Zernio (% de fallos en 7 días).

### 15.5 Cola de borradores (extensión)
- En cada fila, qué regla la dejó ("Regla 3 · menciona precio").
- Desaparición por realtime con aviso cuando se descarta por `auto:answered_elsewhere`.

### 15.6 Pantalla: Settings → Tareas en segundo plano
- **URL:** `/dashboard/settings/background`
- Ahorro estimado y proveedor · tabla de tareas · calidad de la clasificación (4 indicadores, precisión por semana, categorías con más correcciones, calibración) · revisión rápida · versiones del clasificador · últimas corridas.
- Solo Owner/Admin.

### 15.7 Settings → General (extensión)
- Selector de zona horaria.

---

## 16. Guías de UI
Se hereda el sistema visual del fork (neutro, Inter, acento actual). Tono cercano, tuteo rioplatense, sin jerga técnica en la UI. Cuidados específicos:
- **Todo número con su contexto:** período, cantidad detrás de cada porcentaje, qué significa en un tooltip.
- **Las decisiones del agente se leen como oraciones**, no como códigos (`rule:r_3` nunca aparece en pantalla).
- **La confianza del modelo es orientativa:** mostrarla, pero nunca como garantía.
- **Accesibilidad:** WCAG AA, foco visible, tooltips accesibles por teclado, reordenar reglas sin mouse, color nunca como única señal.

---

## 17. Decisiones transversales

| Decisión | Definición |
|---|---|
| Historial y auditoría | `audit_log` para todo cambio de configuración, reglas, categorías y correcciones (§12.5) |
| Soft delete | Categorías archivadas, no borradas. Resto sin cambios |
| Deduplicación de contactos | Sin cambios |
| Snapshot de precios | No aplica |
| Estados y ciclo de vida | Borrador: sin estados nuevos; el descarte automático por respuesta en otro medio queda como `discarded` + `auto:answered_elsewhere`. Run: se suma `already_answered` (terminal). Texto: sin clasificar → clasificado (regla/modelo) → corregido/confirmado (humano, terminal para el modelo) |
| Casos borde | Saliente entre generación y envío → refresco + momento 2 atómico. Refresco que trae un envío propio todavía sin guardar → match por ids, sin duplicar. Refresco caído → "Enviar directo" se degrada a borrador. Regla inválida en la base → se saltea sin romper el turno. Lote del proveedor que no vuelve → 24 h y modo normal. Dos personas corrigiendo la misma fila → gana la última, ambas en `audit_log` |
| Zona horaria e idioma | `workspaces.timezone`. Español rioplatense |
| Motor de automatización | Sin cambios en flows. Las reglas de respuesta son del agente, no del motor de flows |
| Precios variables | No aplica |
| Modelo de asignación | Sin cambios. Se usa para el tiempo de primera respuesta de una persona |
| Contacto cross-canal | Sin cambios |
| BYOK multi-provider | El clasificador usa el helper único de IA y la key del workspace. API por lote cuando el proveedor la tenga; si no, pedidos agrupados. Si la key falla, la corrida queda en error y se notifica, sin afectar al agente |
| Webhooks | Sin cambios en el receptor. Los salientes externos entran por el refresco contra Zernio y el historial, no por webhook |
| Broadcasts y rate limiting | Los broadcasts escriben `origin = 'broadcast'`. Sin otros cambios |

---

## 18. Seguridad

| Área | Definición |
|---|---|
| Autenticación | Sin cambios (Supabase Auth SSR) |
| RLS | `message_categories` y `message_texts`: SELECT para miembros del workspace (`is_workspace_member`); INSERT/UPDATE para Owner/Admin; el job escribe con service role. Funciones de métricas `SECURITY INVOKER` para que el scope aplique. Ninguna tabla nueva sin RLS |
| Validación | Reglas validadas en cliente y servidor con el mismo esquema y la lista cerrada de campos. `ai_background_settings`, `timezone` y `external_reply_cooldown_minutes` validados en servidor. Respuesta del clasificador validada con esquema JSON antes de escribir |
| Protección de API | Server Actions nuevas detrás de `requireWorkspaceAdmin()` donde corresponde. Ninguna API Route nueva pública |
| Datos sensibles | Keys de IA siguen en Vault. Los logs del clasificador no guardan textos de mensajes completos, solo ids y conteos |
| Inyección vía mensajes | Las reglas las evalúa código, no un modelo: un lead no puede cambiar la decisión escribiendo instrucciones. El prompt del clasificador trata los textos como datos (delimitados) y su salida se valida contra la lista de categorías |
| Comunicaciones | Sin cambios |

**Checklist para la IA constructora:**
- [ ] RLS habilitado en `message_categories` y `message_texts`
- [ ] Políticas RLS escritas y testeadas en `verify-rls.mjs`, incluido un Member real
- [ ] Funciones de métricas `SECURITY INVOKER`; trigger y jobs `SECURITY DEFINER` con `SET search_path = ''`
- [ ] Server Actions de reglas, categorías y configuración con verificación de rol en servidor
- [ ] Validación de reglas y configuración en servidor
- [ ] Salida del clasificador validada antes de escribir
- [ ] Secrets en Vault; nada nuevo en variables de entorno del frontend
- [ ] Logs sin textos de mensajes ni PII

---

## 19. Verificación en vivo (después de la corrida, con Wendy)

No es parte de la definición de "listo" de la corrida: requiere cuentas reales y una persona.

1. Con el agente prendido en modo borrador, tocar un botón de ManyChat desde una cuenta de prueba: no se genera borrador, el run queda `already_answered` con 0 tokens.
2. Lo mismo en modo "Envía directo".
3. Responder desde la app de Instagram durante la ventana de silencio: el agente se abstiene.
4. Con un borrador pendiente, responder desde la app de Instagram: el borrador desaparece de la cola abierta con el aviso.
5. Escribir en medio de un flow de ManyChat de varios pasos: `external_cooldown`. A los 10 minutos, el siguiente mensaje se procesa y la respuesta tiene en cuenta lo que mandó ManyChat.
6. Poner Instagram en "Según reglas" con la plantilla, simular, guardar, y mandar: un botón (no responde), una pregunta de precio (borrador con "Regla 3"), un "gracias" (envío directo).
7. Comparar el dashboard con una conversación de prueba: recibidos, enviados, primera respuesta y quién respondió primero coinciden con el hilo.
8. Revisar la primera clasificación nocturna real: costo del run, categorías creadas, y hacer una revisión rápida de 20.
9. Abrir el dashboard y la cola en un teléfono (390 px).

---

## 20. Fuera del alcance

> Nota: el backfill manual de borradores, la regla botón → etiqueta y las propuestas de etiqueta siguen en el **2d-B** (diferido). Este trabajo solo crea la lista de textos de botón que el 2d-B va a usar.


### Para después dentro de la Etapa 1 o más adelante
| Funcionalidad | Destino | Nota |
|---|---|---|
| Asistente de reglas en lenguaje natural | Posterior | Propone reglas estructuradas para confirmar |
| Corrección de categoría desde el Inbox | Posterior | — |
| Dashboard de Gasto de IA | Cuando Wendy lo pida | Ya figura en el selector |
| Tabla de agregados diarios | Solo si la performance lo exige | — |
| "O" entre condiciones, grupos anidados | Posterior | Hoy: dos reglas |

### Para etapas futuras
| Funcionalidad | Etapa |
|---|---|
| Dashboard de contenido orgánico | Etapa 2 |
| Dashboard de Meta Ads y unificado | Etapa 2 |
| Consultar métricas y patrones por lenguaje natural | Etapa 3 |

### Fuera del proyecto
| Funcionalidad | Motivo |
|---|---|
| Integración con la API de ManyChat | El refresco contra Zernio alcanza; evita otra dependencia |
| Envío automático de borradores por tiempo | Decisión del Bloque 2c: nada se autoenvía |
| Embeddings para agrupar mensajes | Peor resultado para textos cortos y sin nombres de grupo |
| Exportar dashboard a PDF/CSV | No pedido |

---

## 21. Notas y pendientes para la corrida

Si alguno de estos puntos no se puede resolver solo, **anotarlo en `docs/PENDIENTE.md` con lo que se decidió y seguir**:

1. **Autoría (F1):** si la conclusión es (b) y el arreglo toca un camino de envío que no está claro, arreglar los caminos claros, anotar el resto y seguir.
2. **API por lote:** si el SDK en uso no la soporta para algún proveedor, implementar el camino de pedidos agrupados, anotarlo, y dejar la interfaz lista para sumar el lote después.
3. **Refresco "últimos mensajes":** si la API de Zernio no permite pedir en orden descendente o con límite, implementar la variante más barata que funcione (por ejemplo, la última página), medir cuántas llamadas hace por turno y anotarlo.
4. **Motivo de derivación:** si el 2b no lo guarda de forma consultable, mostrar "Por qué derivó" con los motivos que existan y anotar qué falta.
5. **Episodios:** comparar la cantidad de episodios del historial real contra las 592 conversaciones y dejar el número en `docs/dashboards.md`.
6. **No prender el agente**, no cambiar el modo de ningún canal real y no correr el clasificador contra la base real con el proveedor real durante los tests (siempre mockeado). La primera corrida real queda programada por el default (03:00) y es de centavos.

**Cambios que deberían reflejarse en documentos anteriores:** la sección 4.9 y F35–F37 de `requerimientos-etapa1-fase3-v2.md` quedan reemplazadas por este documento; el alcance de la Etapa 1 debería sumar el modo "Según reglas" y la verificación antes de responder como parte del agente.
