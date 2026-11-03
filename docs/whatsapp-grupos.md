# Grupos de WhatsApp

Hasta noviembre de 2026 el sistema descartaba todo lo que pasaba en un grupo de WhatsApp. Ahora un número puede
**activar** algunos de sus grupos para:

- **verlos y escribir en ellos desde la bandeja** (vista «Grupos», con encuestas);
- **guardar como contacto a quien se une**, con el origen «Grupo de WhatsApp»;
- **disparar automatizaciones** cuando alguien se une, reacciona a un mensaje o vota en una encuesta.

Migraciones: `00280` (tablas y permisos), `00281` (el toque) y `00282` (los disparadores). Las tres son aditivas y
van **antes** de desplegar el código. En producción están aplicadas y registradas desde el 3/11/2026.

## Cómo se activa

**Ajustes → Integraciones → WhatsApp → (el número) → Grupos.** Lista los grupos en los que está el número y, por
grupo, dos interruptores:

- **Ver en la bandeja**: el grupo aparece en la bandeja → «Grupos». Se leen los mensajes, se escribe, se mandan
  fotos, videos, archivos y encuestas, y se arma una automatización desde un mensaje.
- **Guardar como contacto a quien se une**: quien entre desde ahora queda como contacto (o se vincula al que ya
  existía), con su toque de atribución.

Con uno activado aparece **Importar miembros**, que trae como contactos a los que ya estaban en el grupo (en segundo
plano y por partes, **sin disparar automatizaciones**).

Activar un grupo también le dice a Evolution que avise lo de los grupos (`groupsIgnore` en false) y registra el
webhook con el evento de miembros. Un número conectado antes de esta versión empieza a recibir los grupos recién
después de activar uno.

## Quién ve y quién escribe

Owner y Admin, siempre. Un rol ve los grupos de un número si su bandeja tiene esa cuenta con alcance «todas» o
«asignadas + sin asignar» (un grupo no tiene responsable: es como una conversación sin asignar), y escribe si además
«responde». El Member de sistema (solo lo asignado) no ve los grupos. Activar grupos pide `channels.manage`; armar
automatizaciones, `flows.edit`.

## La atribución

Quien se une a un grupo que guarda contactos queda con un toque:

| Campo | Valor |
|---|---|
| origen | `whatsapp_group` («Grupo de WhatsApp») |
| fuente | `whatsapp` |
| medio | `whatsapp_group` («grupo de WhatsApp») |
| contenido | el nombre del grupo |
| `raw` | `group_jid` y `group_event` (`join`, `import` o `activity`) |
| canal | **orgánico** |

Una vez por persona y grupo. Si era su primer toque, queda como su origen; si ya tenía otros, cuenta como último
toque. Reaccionar o votar no es un toque.

**No hay UTMs.** WhatsApp no dice por qué link de invitación entró cada persona. Para medir campañas distintas, la
salida es **un grupo por campaña**.

Un contacto que se creó al entrar a un grupo y después escribe por privado ya no cuenta como «primer mensaje» (igual
que alguien que llenó un formulario).

## Las automatizaciones

Tres disparadores nuevos (grupo «Grupos de WhatsApp» del selector):

- **Se unió a un grupo de WhatsApp**: una vez por persona y grupo.
- **Reaccionó a un mensaje de un grupo**: a cualquier mensaje del negocio (por defecto), a cualquier mensaje del
  grupo o a mensajes elegidos; con cualquier emoji o con los elegidos. Una vez por persona y mensaje.
- **Votó en una encuesta de un grupo**: cualquier encuesta, las elegidas o las que manda un paso «Enviar encuesta»;
  cualquier opción o las elegidas. Sin filtro de opciones, una vez por persona y encuesta. Con filtro, alcanza con que
  elija una, y si cambia a otra de la lista vuelve a disparar.

Los tres corren **sobre el contacto**: solo disparan si la persona es contacto (lo es si el grupo guarda contactos, o
si ya lo era). Si el flujo manda mensajes, le escribe **por privado desde el mismo número del grupo** (si no había
conversación, se crea una sin no leídos). Un contacto marcado «no contactar» no arranca nada.

Variables: `{{group.name}}`, `{{reaction.emoji}}`, `{{message.text}}`, `{{poll.question}}`, `{{poll.selected}}`.

**Paso «Enviar encuesta»**: manda una encuesta a un grupo activado (no necesita contacto). Sus votos se pueden usar
con «Votó en una encuesta de un grupo» → «Las que manda un paso».

**Desde la bandeja**: en un mensaje del negocio o una encuesta, «⋯» → Crear automatización. Crea la automatización en
borrador con el disparador ya armado (ese grupo, ese mensaje, los emojis u opciones elegidos) y la abre.

**Ojo con el spam**: escribirle por privado a cada persona de un grupo grande puede hacer que WhatsApp bloquee el
número. El tope de 200 mensajes automáticos por hora del canal sigue valiendo.

## Las encuestas

- Se mandan desde la bandeja (botón de encuesta en el grupo) o con el paso «Enviar encuesta». WhatsApp acepta de 2 a 12
  opciones distintas; «se puede elegir más de una» o una sola.
- **Los votos solo se leen si la encuesta salió de tu número** (por el sistema o desde el teléfono): Evolution
  necesita la encuesta guardada para descifrar el voto. Uno que llega cifrado se ignora.
- En la bandeja la encuesta muestra los votos por opción y quién votó.
- En un chat **privado** un voto ya no entra como mensaje vacío (antes sumaba un no leído y despertaba al agente);
  se ignora: los disparadores de encuestas son de grupos.

## Lo que no se puede romper

- **Un grupo no es una conversación.** Vive en `whatsapp_groups` y sus tablas; no pasa por el agente, ni por los flujos
  de mensajes, ni por «Esperando respuesta», ni por los no leídos de la bandeja privada.
- **Las tablas no tienen `contact_id`.** Cada participante se guarda con su identidad de WhatsApp (`participant_id`:
  teléfono o `@lid`, la misma de `contact_channels.platform_sender_id`) y el contacto se encuentra por
  `contact_channels`. Así la fusión de contactos las cubre sin tocar `merge_contacts`.
- **Un grupo no activado se ignora como siempre.** Solo se guarda lo de los grupos con una fila en `whatsapp_groups`
  (con algún interruptor prendido).
- **Los contactos nacen por la regla única** (`find_or_link_contact`), y solo si el grupo guarda contactos (o con
  «Importar miembros»). Importar no dispara automatizaciones.
- **Escribe solo el servidor.** La app lee con la RLS (`can_see_whatsapp_group`); escribir se chequea en TypeScript con
  la gemela (`canWriteWhatsappGroup`) antes de usar el cliente de servicio.
- **El envío pasa por un solo lugar** (`lib/whatsapp-groups/send.ts`): la bandeja y el paso «Enviar encuesta». El eco
  de Evolution se junta con el envío por `(group_id, platform_message_id)`.
- **`participantsData` de Evolution 2.3.7 viene roto** (cada teléfono es "[object Object]"): se lee `participants[]`.

## Dónde mirar

- Receptor: `app/api/webhooks/evolution/route.ts` → `lib/whatsapp-groups/inbound.ts` (parsers puros en `parse.ts`).
- Contactos y toque: `lib/whatsapp-groups/contacts.ts`. Importar: `lib/whatsapp-groups/import.ts` (job
  `whatsapp_group_import`).
- Disparadores: `lib/flow-engine/registry/whatsapp-group-triggers.ts` y `lib/whatsapp-groups/automation/*`.
- Ajustes: `components/channels/whatsapp-group-settings.tsx`, `lib/actions/whatsapp-groups.ts`.
- Bandeja: `app/(dashboard)/dashboard/(comunicacion)/inbox/groups-inbox.tsx`, `components/inbox/groups/*`,
  `lib/actions/whatsapp-group-inbox.ts`.

## Pendiente

- La media de los grupos no tiene retención (la limpieza de 180 días mira solo `messages`).
- A un grupo no se mandan audios ni stickers todavía, y desde la bandeja no se reacciona a un mensaje del grupo.
- «Importar miembros» no avisa al terminar: el resultado queda en el historial del canal.

## Verificación

```
node scripts/verify-whatsapp-groups.mjs   # permisos (gemelas SQL<->TS), RLS, únicos, toque orgánico, disparadores y cascada
node scripts/verify-contact-merge.mjs     # sin columnas contact_id nuevas, la fusión no cambia
node scripts/verify-organic-attribution.mjs  # touch_channel con el medium nuevo
```
