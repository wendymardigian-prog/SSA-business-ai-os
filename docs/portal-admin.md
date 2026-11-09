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

- **Evaluaciones y actividades** son formularios de tipo `quiz` / `activity` atados al programa (no aparecen en
  Formularios ni tienen página pública). La nota la calcula la base; las respuestas correctas nunca salen. Portal ›
  Por revisar tiene las entregas (`submissions.review`) y los comentarios sin contestar.
- **Calendario**: las fechas no se guardan, se calculan en la zona de la sesión (`live_session_occurrences`). El link
  de la reunión no lo lee la sesión (permiso por columnas). La asistencia se mide sobre su base (todos con acceso,
  empezaron hace N días, una fase o una variante); quien asiste fuera de la base queda registrado sin sumar ni restar.
  «Agregar al portal» desde Grabaciones guarda una grabación como clase o como grabación de una fecha.
- **Comunidad**: posts y comentarios (un nivel), reacciones y reportes. Un comentario en una clase es un post del
  espacio reservado «clases». Lo borrado se oculta y se purga a los 30 días.
- **Tutor**: un agente `student_tutor` por programa, atado para siempre (`products.tutor_agent_id`, único). Se crea al
  prender Asistente IA en el programa y se apaga con él. Para un estudiante, busca solo en las clases que tiene
  abiertas; nunca evaluaciones, documentos internos ni lo excluido. Límite: el propio, el de su variante o el del
  programa; créditos = (límite − gasto del mes) × créditos por dólar.

## Las cards de Portal › Programas

Ocho números por programa en una consulta (`program_card_metrics`), con «Últimos 7 / 30 días»: estudiantes nuevos,
clases completadas, actividades por revisar y evaluaciones por corregir (la cola de hoy), certificados, posts,
asistencia en vivo y «sin entrar hace +14 días». Una sección apagada se ve «—».
