# Reporte de fin de día (EOD)

Un tipo de formulario nuevo dentro de Formularios. Cada persona del equipo completa, al
final del día, un reporte de lo que hizo. El más importante es el de **setters**: dejan
el reporte abierto todo el día y lo usan como **contador** ("+1" en "Links enviados"), y
al final del día lo envían.

Plano en el pedido del 12/10/2026 (bloques E1 a E3). Avance en `docs/PROGRESS-eod.md`.

## Las dos variantes

Se elige al crear ("+ Nuevo formulario" → "Reporte de fin de día" → "¿Para qué rol?") y
**no cambia después** (`saveEodConfig` la toma siempre de la base).

- **Setters (con canales).** Preguntas generales + una pregunta "¿Qué canales trabajaste
  hoy?" + un grupo de preguntas por canal. Nace con la plantilla de XCRM
  (`lib/eod/templates.ts`):
  - Generales: horas trabajadas (0–24), rendimiento (1–10), mejor conversación y "¿qué
    puede hacer el equipo para mejorar tu rendimiento?".
  - Instagram, WhatsApp y LinkedIn activos, cada uno con seis números ≥ 0 obligatorios:
    conversaciones inbound y outbound, seguimientos, respuestas, links enviados y llamadas
    agendadas.
- **General (otro rol).** Solo preguntas propias, sin canales. Nace con "¿Qué lograste
  hoy?" y "¿Qué te frenó?".

Tipos de pregunta: texto corto, texto largo, número, selección única y selección múltiple
(`EOD_FIELD_TYPES`). El número suma **paso** (`step`) y **qué mide** (`metricKey`).

## Canales

El catálogo es fijo (`lib/eod/channels.ts`): Instagram, WhatsApp, LinkedIn, Facebook /
Messenger, TikTok, X, Email, Telegram y Llamadas telefónicas, más los personalizados
(`custom_<slug>`). No dependen de que el canal esté conectado en la app.

- Desactivar un canal **no borra** sus preguntas: vuelven si se lo activa.
- "Copiar preguntas de…" y "Usar estas preguntas en todos los canales activos" copian con
  ids internos nuevos y **las mismas claves y métricas** (eso es lo que hace que sumen).
- La clave de una pregunta es única **dentro de su canal**.
- Para publicar: al menos un canal activo, y cada canal activo con al menos una pregunta.

## Las métricas (`metricKey`)

Catálogo en `lib/eod/metrics.ts`: `conv_inbound`, `conv_outbound`, `seguimientos`,
`respuestas`, `links_enviados`, `llamadas_agendadas`, `horas_trabajadas`, `rendimiento`, y
"Otra" con una clave propia (`^[a-z0-9_]{2,40}$`).

Dos preguntas con la misma métrica en canales distintos **se suman en el total**.
`computeEodMetrics` guarda, al enviar, el total por canal y en total. Un valor vacío no
suma: nunca se inventa un cero. Lo de un canal apagado tampoco suma.

## Dónde se completa

Con la **sesión iniciada**, en "Mi reporte del día" (`/dashboard/eod`, aparece en el menú
solo si la persona está en la audiencia de algún EOD publicado). La persona que reporta es
SIEMPRE la de la sesión: nunca un selector, nunca un dato del navegador. Un EOD no tiene
link público, ni embed, ni `<Formulario>` (`get_public_form` devuelve `unavailable`, 00179).

`/dashboard/eod/[formId]?fecha=AAAA-MM-DD`: sin fecha es hoy **en la zona horaria de la
persona** (`user_preferences`), no la del workspace. Nunca una fecha futura; como mucho
`pastDays` hacia atrás (0 = solo hoy).

El número tiene − y + de 44 px, se escribe con teclado numérico, la rueda del mouse no lo
cambia, mantener apretado repite (400 ms, después cada 80 ms) y las flechas suman y restan
(`components/eod/number-stepper.tsx`, lógica en `lib/eod/stepper.ts`).

## Que no se pierda nada (el borrador)

El borrador vive **en el servidor** (`eod_reports`, `status = 'draft'`, con un número de
revisión `rev`) y **en el navegador** (`localStorage`, clave
`eod:<workspace>:<form>:<persona>:<fecha>`). La lógica es pura (`lib/eod/draft.ts`); el
hook (`components/eod/use-eod-draft.ts`) solo la compone.

- Cada cambio se escribe en `localStorage` en el momento.
- Al servidor, agrupado: 1,5 s después del último cambio, y siempre que la pestaña se
  oculta o se cierra (`fetch` con `keepalive` a `POST /api/v1/eod/draft`, que usa el mismo
  núcleo que la Server Action).
- Sin conexión: reintenta a los 2, 5, 15 y 30 s, y después cada 30 s; sube apenas vuelve
  (`online`).
- Al abrir, se juntan los dos (`mergeDrafts`): si el del navegador tiene cambios sin
  confirmar, gana y se sube.
- **Dos pestañas o dos dispositivos.** El servidor solo acepta el guardado que viene de la
  revisión vigente (`save_eod_draft`: `UPDATE … WHERE rev = $rev`). Si otro guardó en el
  medio, responde `conflict` con lo vigente, y los números se **fusionan por diferencia**
  contra la última versión que conocía este navegador (`rebaseCounters`): 10, +3 en la
  compu y +2 en el celular = 15. Los textos: gana el último. Se avisa "Se actualizó con lo
  que cargaste en otra pestaña".
- Las pestañas del mismo navegador comparten UNA copia (`localStorage`), se avisan con
  `BroadcastChannel`, y el guardado va con `navigator.locks` para no mandar lo mismo dos
  veces. Si un guardado llegó pero la respuesta se perdió, `mergeDrafts` lo detecta por lo
  que se mandó (`sent`) y no suma dos veces.
- **Medianoche.** El reporte sigue siendo el de la fecha con la que se abrió. Aparece
  "Este reporte es del 12/10. ¿Lo enviás o empezás el de hoy?". Nada se mueve solo de un
  día a otro.
- **Si el formulario se republica.** Al enviar se valida contra la versión vigente: lo que
  sigue existiendo (por clave) se conserva; lo que se borró se descarta con un aviso.

## Enviar

`submitEodReport` (`lib/eod/submit.ts`), en este orden: sesión y miembro, audiencia,
publicado, fecha, **validación total** con `validateSubmission` de Formularios (las generales
siempre; las de cada canal, solo de los elegidos; el selector si es obligatorio; números en
rango, enteros y múltiplos del paso), modo de reporte, y se guarda con
`submit_eod_report` (00181/00184), en una transacción:

- las respuestas con su etiqueta, los canales elegidos, las métricas y la versión;
- la **unicidad la da un índice** `(form_id, user_id, report_date)`: doble clic o dos
  pestañas = un solo reporte (el segundo llega con una revisión vieja);
- el evento `eod_submitted` para las automatizaciones;
- una corrección suma `edit_count`/`edited_at` y deja lo anterior en `audit_log`
  (`eod_report` / `eod.edited`, con lo que cambió).

Después del commit, en `try/catch`, el aviso en la campana a quienes eligió el reporte.

**Modo "se puede corregir".** Mientras se corrige, lo enviado NO cambia: la corrección vive
en `pending_edit`, una columna que **nadie puede leer con su sesión** (privilegio por
columna), así quien ve los reportes de todos no ve una corrección a medio hacer.

## Quién ve qué

- Cada persona ve **sus** reportes, enviados y borradores.
- Owner, Admin y un rol con **`eod.view_all`** ven los **enviados** de todos
  (`can_view_eod_all`, 00180).
- Los **borradores ajenos no los ve nadie**. "Pendientes de hoy" solo muestra el estado
  (En curso / Sin empezar), leído desde el servidor.
- Administrar el reporte sigue siendo `forms.manage`. Un Member de sistema ve los EOD en
  Formularios (tiene `forms.view`) pero no los edita.
- `eod_reports` no tiene policies de escritura (escribe el servidor) ni de borrado.
- **Nunca `select("*")` sobre `eod_reports` con la sesión**: falla por `pending_edit`. Las
  consultas nombran las columnas (`REPORT_COLUMNS`).

## Reportes

`/dashboard/formularios/[id]/reportes`: una fila por persona y día con el total de cada
métrica, totales del período (solo enviados) por canal y en total, "Pendientes de hoy" (en
la zona de cada uno), filtros en la URL (`desde`, `hasta`, `persona`, `canal`) y CSV (sin
fórmulas, con BOM). El detalle muestra las generales, una tarjeta por canal, la versión, si
se corrigió y el Historial para Owner y Admin.

## Automatizaciones (flujos sin contacto)

Un EOD **no tiene contacto**: es de una persona del equipo. El motor aprendió que hay flujos
sin contacto (E15), por el registro y sin reescribirse:

- Cada disparador declara `subject` (`contact` por defecto, todos los de siempre).
  `eod_submitted` es el único `member`.
- Cada nodo declara `needsContact`. Sirven sin contacto: Condiciones, Esperar, Enviar
  email, HTTP, Ir a otro flujo (solo a otro sin contacto), A/B y el nodo nuevo **"Avisar en
  la campana"** (`notify_team`).
- `automation_events.contact_id` y `flow_sessions.contact_id` admiten null (00182), con
  CHECK: solo `eod_submitted` viene sin contacto, y una sesión tiene contacto o persona.
- El cron ramifica por sujeto de forma explícita; la rama de contacto no cambió. Sin
  contacto: no busca conversación ni canal y "no contactar" no aplica.
- El motor saltea (y anota `node_skipped`) un paso que necesita contacto en un flujo que no
  tiene: red de seguridad. El editor no los ofrece y guardar o publicar uno se rechaza
  (`lib/flow-engine/member-flow.ts`).
- "Enviar email" en un flujo sin contacto va a quien envió el reporte, a personas del
  equipo o a una dirección fija.

El disparador: `{ form_ids, on: "first" | "every" }` (primer envío del día o también cada
corrección); la clave `eod:<report>:<edit_count>` hace que una corrección no dispare dos
veces. Variables (`lib/eod/automation/variables.ts`): `member.*`, `eod.date`, `eod.role`,
`eod.channels`, `eod.all_answers`, `answer.<clave>`, `channel.<canal>.<clave>`,
`metrics.total.<métrica>`, `metrics.<canal>.<métrica>`, `report.url`.

Plantillas (apagadas al nacer): "Avisarme cuando alguien envía", "Copia del reporte por
email" y "Alerta por bajo rendimiento" (links en total < 10 → email a quien envió + aviso a
quien la crea; "Si no" vacío).

## Recordatorio

Si está prendido, a la hora elegida **en la zona de cada persona**, quien está en la
audiencia y no envió el de hoy recibe "Te falta el reporte del día" en la campana, una vez
por día. pg_cron cada 15 minutos encola un barrido por reporte (00185); la regla vive en
`lib/eod/reminder.ts`.

## Verificación

```
node scripts/verify-eod.mjs   # RLS, unicidad, concurrencia, audiencia, revisión, el evento, el flujo y el recordatorio
```

Crea y limpia sus datos (`zz-test-`); no se corre en simultáneo con los otros `verify-*`.

## Siguiente paso

El dashboard de setters de XCRM (cruzar estas métricas con agendas, show-up, ventas y
cash). Las `metricKey` lo dejan listo: ver `docs/PENDIENTE.md`.
