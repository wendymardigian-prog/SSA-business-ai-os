# Auditoría de automatizaciones — pendientes

Lo que quedó afuera a propósito, con el motivo.

## Para revisar con Wendy

- **Prueba real de un email con adjunto**: no se mandó ninguno de verdad (el dominio de Resend daba 403 en octubre y no
  se creó un recurso de prueba en producción). Probar con un recurso propio en «Enviar email» y un email al propio correo.
- **Subir un recurso desde el editor**: se probó que el formulario se abre y que, al guardar, queda elegido el recurso más
  nuevo creado en el último minuto. No se subió un archivo real.

## Quedaron igual a propósito

- **El `condition` viejo** sigue leyendo `variable:` solo en el primer nivel (su caracterización dice «esto no se toca»;
  lo resuelve «Condiciones»).
- **`pickCanonicalTrigger`** (Ventas) elige la menor prioridad: decide cuál de los pares del MISMO flujo dispara una
  vez, no compite entre flujos. No es un bug.
- **«Enviar WhatsApp a un número»** guarda el número y el texto en `analytics_events`: es el historial del envío que se
  ve en la pantalla del webhook, no un log.
- **El editor de pasos** (Formularios, Agenda, EOD) sigue publicando al guardar: no pasa por el borrador del lienzo.
- **Los botones con payload** solo funcionan en Instagram: Evolution (WhatsApp por QR) no manda botones; ahora llegan
  como lista numerada en el texto.

## Para más adelante

- **Adjuntos en el paso de email de las Secuencias** (fuera del alcance de esta tanda).
- **Filtros de agenda que el matcher lee y el panel no muestra**: área, tipo de evento, anfitrión y estado de origen;
  y `closer_ids` en Llamadas. Necesitan selectores con datos (se arman hoy desde la pantalla de cada evento).
- **`postIds` de «Palabra clave en un comentario»** en el lienzo: se configuran desde la pestaña Growth.
- **«Volver después» de «Ir a otra automatización»** (`returnAfter`): sigue sin implementar.
- **`commentReply` / `privateReply`**: nodos registrados sin paleta ni panel (internos).
- **Plantilla «Captación de leads»**: el paso «Definir campo» usa los campos `name` y `email`; si el negocio no los tiene
  creados como campos personalizados, no guarda nada.
- **Un paso que se saltea por falta de contacto** sigue por la primera salida (en una condición vieja, la que esté
  primero). El editor ya impide armar eso; es la red de seguridad.
