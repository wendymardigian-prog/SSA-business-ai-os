# Automatizaciones de email y envíos programados — pendientes

## Para Wendy (fuera del código)

- **Reactivar el webhook de Resend.** Resend lo tiene desactivado (`webhook_disabled = "true"`); SSA no lo reactiva a propósito. Pasos:
  1. Entrar a resend.com/webhooks y activarlo.
  2. En SSA, ir a Ajustes → Integraciones → Resend y tocar «Actualizar webhook».

  Sin esto no llegan los rebotes ni las quejas, y el freno automático de la Fase 1a no tiene con qué decidir.
- **Elegir el «Máximo de emails de marketing por día»** antes del webinar. El default es 100. Con 1.000 y el calentamiento prendido, desde el jueves 5/11 salen 100 + 200 + 400 + 94, y los 794 terminan el domingo 8/11.

## Abiertos

- **Clic y apertura en condiciones (A3, Fase 2).** La 1a empieza a guardar `opened_at` / `clicked_at` en `email_log`; la condición «abrió / hizo clic en el email del paso X» queda para A3.
- ~~**`lib/vault-boundary.test.ts` se queda sin tiempo con la suite entera.**~~ Resuelto el 4/11: con la máquina cargada (carga 46 por otras sesiones) el `it` que recorre los imports pasaba los 5 s incluso solo; se le dio un tiempo propio de 30 s. No cambia nada de lo que comprueba.
- **La fecha fija del nodo «Esperar» se convierte con la zona del navegador** (`DelayPanel.tsx`), no con la del negocio. Se arregla en A4.
