# Automatizaciones de email y envíos programados — pendientes

## Para Wendy (fuera del código)

- **Reactivar el webhook de Resend.** Resend lo tiene desactivado (`webhook_disabled = "true"`); SSA no lo reactiva a propósito. Pasos:
  1. Entrar a resend.com/webhooks y activarlo.
  2. En SSA, ir a Ajustes → Integraciones → Resend y tocar «Actualizar webhook».

  Sin esto no llegan los rebotes ni las quejas, y el freno automático de la Fase 1a no tiene con qué decidir.
- **Elegir el «Máximo de emails de marketing por día»** antes del webinar. El default es 100. Con 1.000 y el calentamiento prendido, desde el jueves 5/11 salen 100 + 200 + 400 + 94, y los 794 terminan el domingo 8/11.

## Abiertos

- **`investigacion-verificacion-email.md` (módulo F) no está.** No apareció en el repo, Documentos, Descargas ni Escritorio. Se usan los umbrales del pedido: 2 % de rebotes y 0,05 % de quejas, con un mínimo de 50 enviados en 24 h. Si aparece el documento, comparar.
- **Clic y apertura (A3, Fase 2).** El webhook ya los escucha (`email.opened`, `email.clicked`), pero el receptor los descarta. Una condición «abrió / hizo clic en el email del paso X» necesita procesarlos primero.
- **`lib/vault-boundary.test.ts` se queda sin tiempo con la suite entera.** Corrido solo tarda 3,5 s, pero con 1188 archivos en paralelo a veces pasa los 5 s. No es un error de código. Si se repite, darle un timeout propio a ese `it`.
- **La fecha fija del nodo «Esperar» se convierte con la zona del navegador** (`DelayPanel.tsx`), no con la del negocio. Se arregla en A4.
