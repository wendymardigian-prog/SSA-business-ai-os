# El portal desde SSA

Todo lo del portal de estudiantes se configura y se sigue desde SSA (Corrida A1). El portal en sí (lo que ve el
estudiante) es la Parte 2 (Corrida B): acá están las reglas, las tablas y las pantallas del equipo. Modelo general en
[servicios.md](servicios.md).

## El contrato con el portal

- `app_servicio_portal` es un esquema **cerrado**: sin USAGE para `anon` ni `authenticated`. SSA lee por funciones de
  `app_servicio` (por ejemplo `portal_admin_service_accesses`, `community_feed`, `tutor_knowledge_list`), y el portal
  va a leer con su propio servidor. `verify-portal-schema` lo comprueba (también que la API no lo expone).
- Todo lo que el portal necesita decidir ya está en la base: qué secciones ve cada estudiante
  (`portal_access_effective`), qué clase tiene abierta (`program_item_unlocked`), si puede publicar
  (`community_can_post`), cuántos créditos le quedan (`assistant_credits`), qué materiales puede usar su tutor
  (`tutor_knowledge_ids`), si le faltan los términos (`portal_terms_pending`).
- **El link del formulario de un paso** (00503): el portal pide `POST /api/portal/form-link` con `{ session, item_id }`
  (firmado con `PORTAL_SHARED_SECRET`, como `/api/portal/file`). SSA responde `{ ok, url }` con el link firmado del
  formulario (lleva el paso: al enviarlo se tilda ese paso) o `{ ok: false, code, message }` (PO403 vista previa,
  PO404 sin formulario o no publicado, PO409 completo o bloqueado). El link nunca se loguea. Del lado del portal, la
  ruta `/ir/paso/<id>` lo pide y redirige.

## Secciones y accesos

- Por variante (Productos › variante › Portal): el acceso al portal y cada sección con su regla de apertura, cómo se
  ve cerrada, hasta cuándo dura y sus límites. Por programa (Portal › programa › Ajustes del programa): qué
  secciones están prendidas.
- Cada servicio recibe sus filas en `portal_access` (motor en 00341: al crear, al pasar un paso, por tiempo, al
  extender, al pausar, al cortar). Mora: se suspende y se repone sola. A mano (ficha del servicio › Accesos): acceso
  extra, extender, quitar, «dar ahora», siempre con motivo y al historial.
- Gemelas `lib/portal-admin/access.ts` con `access-rule.cases.json` y `access.cases.json`.

## Cuentas e invitación

`portal_accounts` (una por contacto y negocio), invitación con huella y 7 días, una por minuto y cinco por día, por el
Resend del negocio (email transaccional). «Ver como estudiante» crea un pase de 60 segundos (`portal.view_as`).

**Ajustes del portal** (el engranaje de la barra de Portal, `/dashboard/portal/ajustes`, `portal.settings`):
- **Remitente de las invitaciones**: el del negocio, o una dirección propia con lo de antes del @ y un dominio
  **verificado** del Resend del negocio (nunca escrito a mano: `lib/portal-admin/sender.ts`, y el servidor lo vuelve a
  comprobar al guardar). La invitación sale desde ahí (`fromOverride` de `sendTransactionalEmail`).
- **Email de invitación**: asunto y mensaje con formato y el botón «{ } Variable» (`contact.first_name`,
  `contact.name`, `workspace.name`, las claves del catálogo de Automatizaciones), con vista previa. `{nombre}`, la
  forma vieja, se sigue entendiendo. Con formato, los valores van escapados y el HTML pasa por la lista blanca de
  `lib/email/html.ts` (`portalInviteEmail`).
- **Pantalla de inicio**, **También con contraseña** y **WhatsApp de soporte** se guardan, pero el portal todavía no
  los lee: la pantalla lo dice.

## Programa, evaluaciones, calendario, comunidad y tutor

Las pestañas van en la barra superior (`TopbarTabs`, igual en Portal, cada programa, Clientes y Afiliados); los ajustes
de cada sección son el engranaje de la barra (`SettingsLinkButton`) y abren su propia pantalla. Los links viejos
`?tab=ajustes` / `?tab=reglas` llevan ahí. «Por revisar» y «Comunidad» llevan el contador de lo que espera una persona
(`lib/portal-admin/review-count.ts`: actividades sin revisar, la misma regla que el filtro «Pendientes», y comentarios
sin contestar).

| Pestaña de Portal › programa | Qué hace | Claves |
|---|---|---|
| Contenido | Módulos, submódulos y clases; desbloqueo; transcripciones a Conocimiento con el segundo de cada parte; «N comentarios nuevos» | `program.manage`, `program.activate` |
| Calendario | Sesiones en vivo (semanales o sueltas, en su zona), mover y cancelar una fecha, asistencia y su base, grabaciones | `live_sessions.manage`, `attendance.manage` |
| Comunidad | El muro, los comentarios de las clases, Sin contestar · 30 días, Reportados, los espacios | `community.view`, `.reply`, `.moderate`, `.spaces` |
| Asistente IA | El tutor del programa, sus límites y créditos, el uso del mes y su base de conocimiento | `tutor.manage`, `tutor.knowledge` |
| Afiliados | Qué links ven los estudiantes | `portal.sections` |
| ⚙ Ajustes del programa (`/dashboard/portal/<id>/ajustes`) | Secciones, términos al entrar y el resumen de las variantes | `portal.sections` |

- **Desbloqueo «Al completar algo»** (`after_complete`): se elige de una lista un paso del camino de las variantes del
  producto (se guarda su clave, `target: journey_item`: se cumple cuando ese paso queda completo en cualquiera de los
  servicios vigentes de la persona) u otra clase o módulo (`target: program_item`). Las opciones salen de
  `lib/program/unlock-targets.ts`. **Texto propio del candado** (00502): con candado, `locked_text` reemplaza al texto
  automático en cualquier tipo de regla; con «Próximamente» manda `coming_soon_text`. Gemelas `reasonOf` /
  `program_unlock_plan`, casos en `lib/program/unlock.cases.json`.
- **Abrir, cerrar o programar un módulo para UN cliente** (00504): en la ficha del servicio, «Avance en el classroom»,
  cada módulo tiene un menú «⋯» (con `services.access` y el servicio activo, en pausa o completado): **Abrir ya**,
  **Cerrar**, **Programar…** (una regla propia: fecha, N días desde que empezó, al completar algo o al empezar el
  Reto, que reemplaza a la del programa) y **Volver a la regla del programa**. Se guarda por contacto y módulo en
  `program_progress.override_mode` / `override_rule` y lo escribe solo `svc_module_override` (queda en el historial
  como `svc.module_override`). Abrir y la regla propia incluyen el módulo aunque su variante no lo incluya («Darle
  acceso ya»); cerrar le gana también a lo que abrió un paso del camino o una automatización, y el estudiante ve
  «Todavía no está disponible». Como todo pasa por `program_item_unlocked` (`ctx.overrides`), el portal no cambia.
  Gemelas `unlockPlan` / `program_unlock_plan` con los casos de `unlock.cases.json`; lectura de la ficha en
  `classroomProgressView` («Abierto a mano», «Cerrado a mano», «Regla propia · se abre …»). Al unir dos contactos,
  queda el del principal o, si no tiene, el del duplicado (`merge_contacts_hook`).
- **Una clase de video también puede llevar una página HTML** (00490): el cajón de la clase muestra «Página debajo del
  video (opcional)» y el portal la dibuja debajo del video (o del botón de Fathom), en el mismo marco aislado que una
  clase de tipo Página. Solo la clase de tipo Página se marca vista sola al abrirla.
- **Evaluaciones y actividades** son formularios de tipo `quiz` / `activity` atados al programa (no aparecen en
  Formularios ni tienen página pública). La nota la calcula la base; las respuestas correctas nunca salen. Portal ›
  Por revisar tiene las entregas (`submissions.review`) y los comentarios sin contestar.
  **Encuestas en las actividades (00512)**: una actividad puede tener preguntas de **estrellas** (`rating`, 1 a 5, con
  `min`/`max` en la definición: la misma convención que las encuestas de Formularios, así un tablero común las suma sin
  convertir nada) y cada pregunta suma una **ayuda** (`help`, hasta 300 caracteres): en un texto se ve dentro del
  cuadro; en estrellas u opciones, debajo de la pregunta. Las reglas del editor y del guardado viven en
  `lib/program/activity-fields.ts`. `portal_submit` valida estrellas y opciones con `activity_answers_valid` (gemela
  `lib/program/activity-answers.ts`, casos en `activity-answers.cases.json`; una respuesta vieja guardada no se toca).
  La entrega sigue pasando por Por revisar (ahí se ve «★★★★☆ (4)») y el editor de la actividad muestra el promedio de
  cada pregunta de estrellas con la última entrega de cada estudiante (`loadActivityRatings`). El portal dibuja las
  estrellas, las opciones de selección y el texto corto (antes todo era un cuadro de texto).
- **Calendario**: las fechas no se guardan, se calculan en la zona de la sesión (`live_session_occurrences`). El link
  de la reunión no lo lee la sesión (permiso por columnas). La asistencia se mide sobre su base (todos con acceso,
  empezaron hace N días, una fase o una variante); quien asiste fuera de la base queda registrado sin sumar ni restar.
  «Agregar al portal» desde Grabaciones guarda una grabación como clase o como grabación de una fecha.
- **Calendario, la lista y el drawer de una clase (27/11/2026, 00537)**: debajo de las métricas, pestañas **Próximas** y
  **Pasadas** (`?lista=pasadas`); cada fila se cliquea entera y abre el drawer de ESA clase (`?sesion=<id>&fecha=<fecha
  original>`, `lib/program/class-drawer.ts`), igual para próximas y pasadas: «Entrar», menú «⋯» (mover, cancelar, quién
  ve esta fecha, editar la sesión), **notas internas** con formato (`live_session_dates.note`, HTML limpio con
  `sanitizeEmailHtml`, se guardan solas; ninguna función del portal lee esa columna) y **tareas de la clase**
  (`tasks.live_session_id` + `live_session_on`, las escribe el servidor). En una pasada, además, grabación (link a
  Grabaciones si es de Fathom) y asistencia. El formulario de toda la serie quedó solo en «Editar sesión» y «+ Sesión».
  Guardar notas: gana el último que guarda.
- **Comunidad**: posts y comentarios (un nivel), reacciones y reportes. Un comentario en una clase es un post del
  espacio reservado «clases». Lo borrado se oculta y se purga a los 30 días.
  **Autor del equipo (00505)**: un post o comentario del equipo se ve en el portal con el nombre de quien lo escribió
  (`full_name` del perfil de SSA, vía `team_author_name`) y la marca «Equipo»; solo «Como <negocio>» (`as_business`,
  apagado de entrada en el panel) sale como «Equipo». Sin nombre cargado, «Equipo».
  **Título y aviso por correo (00405)**: un post nuevo del equipo lleva título (hasta 200, con emojis; lo exige la
  base) y el interruptor «Avisar por correo», prendido de entrada. Prendido, la acción encola `community_post_email`
  (el reparto), que pide `community_email_targets` (cuenta del portal ACTIVA, con acceso a la comunidad y miembro de
  alguna de las comunidades del post; una fila por persona) y encola un `community_post_email_send` por persona,
  cada 0,7 s, con clave `community_post_email:<post>:<contacto>` (nadie recibe dos veces). El envío vuelve a mirar el
  post y a la persona, y manda como transaccional (sale aunque se haya dado de baja de marketing; un rebote lo frena):
  asunto = título, la cajita «X publicó en la comunidad:», el cuerpo con formato (`communityEmailHtml`, escapa todo),
  «Esta publicación tiene N fotos» (las fotos no viajan) y el botón al portal `/p/<producto>/comunidad`. Editar no
  vuelve a mandar. El portal ya dibuja `title` (viene en `post_row`).
  **Renglones vacíos (18/11/2026, sin migración)**: entre dos bloques, cada par de saltos de línea de más es un párrafo
  vacío (`a\n\n\n\nb`); dos o tres saltos siguen siendo párrafos seguidos, así lo viejo se ve igual. Lo lee
  `splitBlankLines` / `communityBlocks` (`lib/program/community-text.ts`) y la COPIA del portal
  (`lib/shared/community-text.ts`, mismos casos en `community-text.cases.json`); el editor guarda un párrafo vacío entre
  dos con texto (`communityFromEditorDoc`) y la pantalla, el portal y el correo lo dibujan como renglón en blanco. Un
  Markdown pegado se lee de su texto plano aunque el portapapeles traiga HTML (`pasteTextOverHtml`): el HTML de una
  vista ya dibujada convierte los saltos simples en espacios.
- **Tutor**: un agente `student_tutor` por programa, atado para siempre (`products.tutor_agent_id`, único). Se crea al
  prender Asistente IA en el programa y se apaga con él. Para un estudiante, busca solo en las clases que tiene
  abiertas; nunca evaluaciones, documentos internos ni lo excluido. Límite: el propio, el de su variante o el del
  programa; créditos = (límite − gasto del mes) × créditos por dólar.
  - **Búsqueda variada** (`diversifyFragments`, `lib/portal-tutor/prompt.ts`): pide 20 trozos y usa 8, sin repetir el
    mismo texto ni la misma clase y minuto, y con un máximo de 2 por documento (así un taller largo no tapa al resto).
  - **Fuera de las clases**: por defecto responde solo con el material. Si las instrucciones del tutor lo permiten
    (Agentes IA › el tutor), después de aclarar que no está en las clases puede dar una orientación general corta.
  - **Guía del programa**: un documento del tutor sin clase (etiqueta `programa:<id>`) lo ve todo estudiante con el
    Asistente abierto. Sirve para «¿por dónde empiezo?» y «¿qué tengo que entregar?»: nombra cada clase en una línea.
  - **«Me sirvió / No me sirvió»** (00513): el estudiante marca cada respuesta en el portal
    (`portal_tutor_feedback`, `ai_messages.feedback`; la vista previa no puede). Cada respuesta guarda en
    `ai_messages.result` `{fragments, cited}` (nunca frena la respuesta).
  - **Conversaciones** (Asistente IA › Conversaciones, `?vista=conversaciones&filtro=`): cada respuesta con su pregunta,
    el estudiante, las citas y la marca; filtros Todas / No le sirvió / Le sirvió / Sin clases (respondió sin citar
    ninguna clase). Lee `app_servicio.tutor_conversations` con `services.view` o `tutor.manage`.

## Archivos para descargar (zip, plugins, plantillas) y quién los bajó

Cada clase puede tener **recursos descargables** (editor del programa → la clase → «Recurso descargable»): PDF, imágenes,
Office y, desde la 00538, **.zip** (un plugin de Claude, una plantilla, un proyecto para llevarse), hasta **45 MB** cada uno.

- Se guardan en el bucket privado `program-resources`: no hay link público. Solo los baja quien tiene esa clase abierta
  (`portal_file_grant`), con un link firmado que vence a los **5 minutos**. Pasarle el link a otra persona no sirve.
- Un zip se acepta solo si sus bytes son un ZIP **y** quien sube dice que es un zip (por el tipo o por el nombre):
  `checkResource` (`lib/program/lesson.ts`). `sniffUploadMime` no cambió (contenido y chat no aceptan zips).
- **Registro de descargas** (00538): cada vez que SSA firma un link de un recurso para un estudiante, anota cuenta,
  servicio, clase, recurso y hora en `app_servicio_portal.resource_downloads`. Se ve en la ficha del servicio, bloque
  «Descargas» (`svc_resource_downloads`, mismo alcance que la ficha). La vista previa del equipo no se anota.
  **Anotar nunca frena una descarga**: va en `after()` y la función no lanza.
- Lo que nadie puede impedir: que alguien que ya bajó un archivo se lo pase a otro. El registro sirve para saber quién lo tuvo.

## Las cards de Portal › Programas

Ocho números por programa en una consulta (`program_card_metrics`), con «Últimos 7 / 30 días»: estudiantes nuevos,
clases completadas, actividades por revisar y evaluaciones por corregir (la cola de hoy), certificados, posts,
asistencia en vivo y «sin entrar hace +14 días». Una sección apagada se ve «—».
