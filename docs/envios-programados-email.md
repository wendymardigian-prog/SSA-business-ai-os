# Mandar los emails del webinar (sin quemar el dominio)

Guía corta para el envío del webinar del lunes 9/11. Hoy (Fase 1a) los emails masivos salen por **Broadcasts**. El disparador «En una fecha y hora» de Automatizaciones llega en la Fase 1b.

## Antes de empezar (una sola vez)

1. **Reactivá el webhook de Resend.**
   - Entrá a resend.com/webhooks y activá el webhook de SSA. Hoy figura desactivado.
   - En SSA, andá a Ajustes → Integraciones → Resend y tocá «Actualizar webhook».

   Sin esto no llegan los rebotes, las quejas, las respuestas ni los resultados (entregados, aperturas, clics). Mientras siga desactivado, la tarjeta de Resend, el editor del broadcast y el paso «Enviar email» lo avisan en rojo.

2. **Poné el máximo diario en 1.000.**
   - Está en Ajustes → Integraciones → Resend → «Entrega de marketing» → «Máximo de emails de marketing por día»: escribí `1000`. Dejá prendido «Calentar el dominio».
   - Por qué 1.000 y no 794: con el calentamiento, el tope de cada día es **el más bajo** entre tu máximo y el escalón del día (100 → 200 → 400 → 800). Si el máximo quedara en 100, el calentamiento no podría subir nunca.
   - Arrancando el jueves 5/11, salen 100 el jueves, 200 el viernes, 400 el sábado y los 94 que faltan el domingo 8/11: los 794 antes del lunes.
   - El escalón sube solo cada día que salió algo y el freno no saltó.

## Mientras la 1a no esté mergeada: listas chicas

**Hasta que se mergee y despliegue la Fase 1a, cualquier broadcast de email va a una lista chica (unos 100 contactos).**

El carril de email de la cola no tiene tope diario: sin la guardia, un broadcast de 794 sale entero en unos minutos. Con un dominio frío, esa es la forma más rápida de caer en spam o de que Resend frene la cuenta.

## Armar el broadcast

1. Abrí **Contactos** y filtrá a quién va: por ejemplo, etiqueta del webinar y «Email → Suscripto».
2. Tocá **«Mandar un broadcast a estos contactos»**. Se abre el editor con esos mismos filtros.
3. **Canal**: el email del negocio.
4. **Mensaje**:
   - Asunto con un respaldo por si falta el nombre: `{{contact.first_name|Hola}}, te espero el lunes`.
   - En el cuerpo, la misma idea: `{{contact.first_name|hola}}`.
5. **Cuándo**:
   - «Ahora» para que empiece enseguida, dentro del máximo del día.
   - O «Programar» con fecha y hora.
6. Confirmá. Antes de poner en cola, el editor dice a cuántos les llega y a cuántos no, y por qué (sin email, dado de baja, rebota, marcó spam, sin suscribir).

## Qué pasa después

- **Primero los más activos.** Salen primero los contactos con actividad más reciente (último mensaje, formulario, agenda o compra; si no hay ninguna, el alta más nueva). Si el día no alcanza, lo usan los que más probablemente abren.
- **Lo que pasa del máximo no se pierde.** Queda pendiente y sale al día siguiente, en orden. El broadcast lo muestra («N esperan el máximo de emails de marketing del día»). No es un error.
- **El freno.** Si en 24 horas, con al menos 50 enviados, rebotan más del 2 % o se marcan como spam más del 0,05 %, se pausa todo el marketing y te llega un aviso.
  - Los transaccionales (confirmaciones de agenda, contratos) siguen saliendo.
  - Se reanuda a mano desde la tarjeta de Resend, con confirmación.
- **Los resultados.** En la página del broadcast, «Resultados del email» muestra entregados, abiertos (aproximado), clics, rebotes, quejas y bajas de ese email. La lista se filtra por estado y por resultado, con link a cada ficha. En la ficha del contacto, el historial muestra lo mismo para cada email.

## Recordatorios («mañana es el webinar»)

Por ahora son otro broadcast, programado para la fecha y hora del recordatorio, con los mismos filtros.

Como la lista se arma al poner en cola, quien se sume entre medio no entra. Para eso, armá el recordatorio lo más cerca posible de la fecha. En la Fase 1b, el disparador «En una fecha y hora» de Automatizaciones mira la lista en el momento del envío y suma pasos (email → esperar → WhatsApp).
