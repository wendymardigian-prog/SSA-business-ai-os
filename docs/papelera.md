# Papelera: eliminar y restaurar registros

Casi todo se puede eliminar desde su ficha o su fila: agendas, ventas, pagos, servicios, grabaciones,
formularios y respuestas, reportes de fin de día, gastos, comisiones, productos, ideas y piezas de contenido y
conversaciones. Contactos y tareas ya se eliminaban desde antes. Lo eliminado desaparece de todas las pantallas
y números, y queda **30 días en Ajustes → Papelera**, desde donde se restaura tal como estaba. Después se borra
solo y para siempre.

Eliminar no reemplaza a «Cancelar», «Anular», «Reembolsar» ni «Archivar», que siguen igual. Eliminar está pensado
para lo que no tendría que existir: pruebas, duplicados o lo importado por error.

## Quién puede

Cada tipo tiene su permiso en **Roles y permisos**. Owner y Admin los tienen todos y un Member, ninguno. A un rol
personalizado se le prenden de a uno.

| Qué | Clave |
|---|---|
| Agendas | `bookings.delete` |
| Ventas | `sales.delete` |
| Pagos | `payments.delete` |
| Productos | `products.delete` |
| Servicios | `services.delete` |
| Grabaciones | `calls.delete` |
| Formularios | `forms.delete` |
| Respuestas de formularios | `forms.delete_responses` |
| Reportes de fin de día | `eod.delete` |
| Gastos | `expenses.delete` |
| Comisiones | `commissions.delete` |
| Ideas y piezas de contenido | `content.delete` |
| Conversaciones | `conversations.delete` |
| Contactos (ya existía) | `contacts.delete` |
| Tareas (ya existía) | `tasks.delete` |

Además del permiso, la persona tiene que **ver** el registro (el alcance de su rol). La Papelera le muestra solo
los tipos que puede eliminar, y restaurar pide la misma clave.

## Qué frena un borrado

Antes de confirmar, la ventana muestra lo que se va con el registro (por ejemplo, «3 pagos, 2 comisiones»), los
avisos y, si no se puede eliminar, el motivo:

- **Contrato firmado** (venta, formulario, respuesta): la firma es una prueba legal y no se elimina.
- **Comisión en un gasto** (venta, pago, comisión): primero hay que anular ese gasto o sacar la comisión de la liquidación.
- **Gasto automático** (comisión del procesador, pauta de Meta, recurrente, liquidación): si se elimina, el sistema lo vuelve a crear, así que se anula.
- **Producto vendido**: se archiva en vez de eliminarse.
- **Pieza programada o publicándose**: primero se desprograma.
- **Lo usa otro registro**: el motor lo detecta solo y nombra la tabla.

Avisos que no frenan:

- Una agenda futura se saca del calendario de Google **sin avisarle al invitado**. Para avisarle está Cancelar.
- Un cobro ya informado a Meta como compra no se puede retirar.
- Una venta con servicio ofrece «Eliminar también el servicio» (desmarcado por defecto).
- Una grabación eliminada **no vuelve a entrar** cuando Fathom sincroniza ni al importar el historial.
- En una conversación eliminada, si la persona vuelve a escribir, se abre una nueva.

## Lo que se recalcula

- **Ventas y pagos:**
  - el estado de la venta (`refresh_sale_status`);
  - la marca «Cliente», si la había puesto un cobro y no queda otro;
  - el gasto de comisión del procesador del mes, encolando el trabajo diario de Finanzas.

  Al restaurar, se recalcula todo de nuevo.
- **Grabaciones:** queda su id en `calls_deleted_external`, que la ingesta de Fathom saltea. Restaurar la saca de ahí.
- **Productos:** se suelta el «producto de interés» de los contactos y vuelve al restaurar.

## Cómo funciona por dentro

No hay `deleted_at` en cada tabla. Agregarlo obligaría a filtrar en decenas de lectores (funciones de métricas,
finanzas y comisiones, crons), y un olvido mostraría lo eliminado en un número. En cambio:

1. `private.trash_plan` (00411) decide, para cada tipo, qué raíces se borran (por ejemplo, la venta, sus pagos y
   sus comisiones), qué frena y qué avisa. Mira la clave (`private.trash_can`) y que la persona vea el registro
   (las mismas funciones de visibilidad de la RLS).
2. `private.trash_capture` (00410) recorre `pg_constraint` desde esas raíces. Lo que cuelga por
   `ON DELETE CASCADE` entra en la foto. Lo que queda en `SET NULL` se anota para volver a enlazarlo. Lo que es
   `RESTRICT` frena, salvo que también se elimine.
3. La foto va a `private.trash_items` y recién después se borra de verdad.
4. Restaurar (`private.trash_restore_snapshot`) sigue estos pasos:
   - Comprueba que cada padre exista. Si falta uno obligatorio, no restaura nada y dice cuál («restaurá primero la venta»). Si falta uno opcional (`SET NULL`), la fila vuelve sin ese vínculo.
   - Apaga los triggers de esas tablas solo en esa transacción, por nombre, para que no se regeneren comisiones, eventos de Meta, servicios ni automatizaciones.
   - Inserta las mismas filas con los mismos ids, vuelve a enlazar y prende los triggers.

   Las claves foráneas se siguen controlando.

`session_replication_role = replica` no sirve, porque Supabase no deja cambiarlo desde una función. `ALTER TABLE …
DISABLE TRIGGER` sí, porque el dueño de las tablas es el dueño de la función. Toma un candado exclusivo sobre esas
tablas durante la restauración (milisegundos). Con `lock_timeout` de 3 s, si una tabla está ocupada responde «busy»
y la persona reintenta.

Un tipo de tabla hija nuevo queda cubierto solo. **Un tipo de registro nuevo** se suma en
`lib/trash/entities.ts`, `private.trash_can` y `private.trash_plan`, en el mismo cambio. Dos tests lo controlan:
`lib/trash/entities.test.ts` compara las dos listas y que cada bloqueo y aviso tenga su texto.

## Lo que no se puede romper

- Las funciones públicas (`trash_preview`, `trash_delete`, `trash_restore`, `trash_list`) corren con la **sesión** de
  la persona: la base mira la clave y la visibilidad. Las privadas no las ejecuta nadie más que esas funciones.
- La foto **nunca viaja al navegador**: `trash_list` devuelve solo un texto corto (`label`) y las cuentas.
- Eliminar toma un candado por registro: doble clic o dos personas a la vez dan un solo borrado y un «ya no existe».
- Contactos y tareas siguen con su borrado suave (`deleted_at`). La Papelera los lista y los restaura con sus acciones de siempre.
- La purga diaria (`trash-purge`, pg_cron por SQL directo, no `call_app_cron`) borra lo vencido.
- Restaurar una agenda no vuelve a crear su evento en Google.

## Migraciones

`00410_trash_engine` (el motor, `private.trash_items`, `calls_deleted_external`, la lista, la purga) y
`00411_trash_entities` (las reglas de cada tipo, vista previa, eliminar y restaurar). Las dos son aditivas y pueden
ir antes o después del código: sin ellas, eliminar responde un error claro y la Papelera muestra igual los contactos
y las tareas borrados. Traídas de RER-BAIOS (allá 00474/00475) el 18/11/2026: en SSA **todavía sin aplicar**; antes de
aplicarlas, ensayarlas en una transacción que se deshace sola.

Diferencias con RER: sin tickets (SSA no los tiene) y sin la cola de avisos de agenda (`discard_booking_send_queue`);
una agenda eliminada cancela sus trabajos pendientes en `scheduled_jobs`. La lista de la Papelera no muestra los
contactos que se unieron a otro con Fusionar (`metadata.merged_into`): no son algo eliminado.

## Verificación

```
DB_TARGET=local node scripts/verify-trash.mjs            # todo, contra la base LOCAL, dentro de transacciones que se deshacen
DB_TARGET=local node scripts/verify-trash.mjs --solo venta
```

Cubre:

- **Permisos:**
  - un Member y alguien de otro negocio no eliminan;
  - un rol con solo `sales.delete` elimina ventas y no pagos.
- **Ida y vuelta**, comparando cada fila antes y después:
  - venta con pagos y comisión, pago, agenda con grabación enlazada, grabación con comentario;
  - conversación con mensajes, producto con contacto interesado;
  - gasto, comisión, pieza, idea, formulario con respuesta.
- **Que restaurar no encola comisiones.**
- **Los bloqueos y los padres que faltan.**
- **La marca «Cliente», el tombstone de Fathom y la purga.**
