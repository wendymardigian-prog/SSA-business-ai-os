# Pendientes — Sistema de Tareas

Formato: **qué quedó** / por qué / qué se decidió.

## Fusión de contactos
- **Resuelto en Tareas × CRM (13/10/2026):** `linkContacts` ahora delega en `merge_contacts` (00207), que reapunta también `tasks` (y las otras 23 relaciones). Ver [contactos-fusion.md](contactos-fusion.md).

## Baseline de los `verify-*.mjs` (punto de partida)
- **Qué quedó:** tres scripts ya fallaban **antes** de tocar nada y siguen fallando igual; no tienen que ver con Tareas:
  - `verify-attribution.mjs`: 781 de 840 contactos con `first_touch` (datos reales de producción).
  - `verify-publishing.mjs`: 2 chequeos.
  - `verify-webhook.mjs`: necesita la app corriendo en `localhost:3000`.
- **Decisión:** se anotan, no se tocan. El resto de los `verify-*` pasan igual que en el punto de partida (resultado completo en `docs/PROGRESS-tareas.md`).

## Documentos de contexto ausentes
- **Qué quedó:** `claude/v10/alcance-v10.md`, `investigacion-sistema-tareas.md` y `claude/v10/requerimientos-tareas.md` no están en el repo; solo se entregó el plano (copiado a `docs/requerimientos-tareas.md`).
- **Decisión:** el plano manda.

## F25 (triggers sin contacto) — resuelto
- Se construyó «también sin contacto» (00199 + enrutado por fila solo para los tipos que lo declaran). El cambio del motor fue chico (un `if` al inicio de `processEvent` y un campo opcional `contactOptional` en el registro), así que no se difirió. Queda probado de punta a punta en `verify-tasks.mjs`.

## «Crear tarea» en los editores de pasos de Formularios, Agenda y Fin de día
- **Qué quedó:** el nodo `create_task` está en la paleta del lienzo y en el simulador, pero **no** en los editores de pasos simplificados (los que arman «Cuándo / Solo si… / Pasos» en Formularios, Agenda y EOD).
- **Por qué:** esos editores tienen su propio catálogo (`step-catalog`) y su propia validación por pantalla; sumarle un paso exige tocar cada uno y sus plantillas, fuera del alcance de T4.
- **Decisión:** un flujo que ya tenga el paso lo conserva y lo edita en el lienzo (el editor de pasos solo acepta lo que ya estaba guardado). Para ofrecerlo en esos editores: una entrada en cada `step-catalog` + `step-card`.

## `task_overdue` solo avisa y dispara con responsable o seguidores
- **Qué quedó:** una tarea vencida sin responsable ni seguidores no genera aviso ni evento `task_overdue`.
- **Por qué:** no hay a quién avisar, y el evento sin contacto necesita una persona como sujeto. El barrido tampoco la encola (evita trabajo inútil).
- **Decisión:** es intencional. Quien quiera verlas las filtra en la tabla («Vencidas», «Sin responsable»).

## El plan de fechas ya no depende de lo que la persona ve
- **Resuelto en Tareas × CRM (13/10/2026, R10):** completar un bloqueante corrige las fechas de TODAS sus dependientes (`task_shift_context`, 00207), incluidas las que quien completa no ve; esas se resumen en una línea sin título y sus dueños reciben `task_date_moved`. Ver [tareas.md](tareas.md). Revierte la decisión anterior («las que no ve no se mueven»).

## Purga de tareas borradas
- **Qué quedó:** `delete_task` hace borrado lógico; **no** se agregó la purga a 30 días a `purge_soft_deleted`.
- **Por qué:** esa función cubre otras tablas y se reescribe entera en cada migración; tocarla excedía el plano (4 migraciones).
- **Decisión:** las tareas borradas quedan guardadas (con su historial). Cuando se purgue, hay que recrear `purge_soft_deleted` copiando la versión vigente (con la definición vieja en la cabecera, como hizo la 00106).

## El editor de flujos en celular
- **Qué quedó:** el lienzo de automatizaciones en un celular (390 px) muestra la paleta a todo el ancho y deja casi sin lugar al canvas.
- **Por qué:** es el comportamiento de antes de Tareas (el editor es de escritorio); no lo introdujo este trabajo.
- **Decisión:** no se toca. La revisión a 390 px de Tareas (lista de tarjetas, drawer a pantalla completa, tablero) está hecha y descrita en `docs/PROGRESS-tareas.md`.

## Verificación en vivo (plano §14f)
- **Qué quedó:** no se probó con proveedores externos reales: ni con un lead real escribiendo por WhatsApp o Instagram, ni con el agente de IA contestando.
- **Por qué:** la corrida prohíbe llamar a servicios externos reales.
- **Decisión:** `verify-tasks.mjs` prueba contra la base real todo lo que no depende de un proveedor (RLS, reglas, cron, avisos y el motor de flujos). Falta, con la app desplegada: (1) activar `createTaskOnEscalate` en un agente de prueba y derivar una conversación; (2) un flujo con el trigger «Se completó una tarea» y el paso «Crear tarea»; (3) mirar la campana a las 08:00 locales con una tarea que vence ese día.

## Despliegue
- **Qué quedó:** las migraciones 00196–00199 ya están aplicadas en la base de producción, pero el código nuevo **todavía no está desplegado** (la rama no se mergeó). Mientras tanto el cron `tasks-due-enqueue` (cada hora) encola un job `tasks_due_sweep` **solo si hay tareas candidatas**, y el código desplegado no tiene ese handler: el job **falla** con `UnknownJobTypeError` («No hay quien ejecute un job de tipo...»). No toca ningún dato; solo deja filas `failed` en `scheduled_jobs`.
- **Qué pasó en esta corrida:** las pruebas (`verify-tasks.mjs` y la revisión visual) crearon tareas con vencimiento y el cron encoló 17 jobs que fallaron. Se borraron al final junto con los datos de prueba (`type = 'tasks_due_sweep'`, ninguno existía antes de la 00198). Sin tareas reales todavía, el cron no encola nada.
- **Decisión:** el orden correcto es aplicar las migraciones, desplegar el código y recién ahí empezar a cargar tareas. Si alguien carga tareas con vencimiento antes de desplegar, los jobs fallan sin consecuencia y los avisos de «vence hoy» llegan recién con el despliegue (el handler avisa lo pendiente, una vez por tarea y fecha). Para no ver jobs fallidos: `select cron.unschedule('tasks-due-enqueue')` y recrearlo (con el SQL de la 00198) al desplegar.

## `verify-eod` y `verify-webhook` piden estados opuestos del servidor local
- **Qué quedó:** `verify-eod.mjs` solo pasa con el servidor de desarrollo **parado** (si está prendido, también drena `automation_events` y dispara el flujo para otras personas); `verify-webhook.mjs` solo pasa con la app **corriendo** en `localhost:3000`.
- **Por qué:** ambos comparten la base real; el servidor local procesa la cola de eventos igual que producción.
- **Decisión:** no se tocan (son anteriores a Tareas). Correrlos en ese orden y de a uno.

