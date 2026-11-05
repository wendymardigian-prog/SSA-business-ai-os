import { describe, expect, it } from "vitest";
import { emailBubbleParts, readableQuote, splitQuotedReply, withoutQuotedLines } from "./quoted-reply";

/** La respuesta real de Gmail: el encabezado partido en tres líneas. */
const GMAIL = `Gracias!

El mié, 4 nov 2026 a la(s) 5:45 p.m., Wendy Mardigian (
baios@mail.wendymardigian.com) escribió:

> ¡Hola Wendy Mardigian!
>
> Tu lugar en Clase en vivo: Cómo generar ingresos con IA quedó confirmado.
>
> Fecha: 2026-11-09T19:00:00-06:00
>
> Wendy
>`;

describe("splitQuotedReply", () => {
  it("Gmail en español, con el encabezado en varias líneas", () => {
    const { reply, quoted } = splitQuotedReply(GMAIL);
    expect(reply).toBe("Gracias!");
    expect(quoted).toContain("escribió:");
    expect(quoted).toContain("> Fecha: 2026-11-09T19:00:00-06:00");
  });

  it.each([
    ["inglés", "Thanks!\n\nOn Wed, Nov 4, 2026 at 5:45 PM Wendy <w@x.test> wrote:\n\n> Hi\n> there"],
    ["portugués", "Obrigada!\n\nEm qua., 4 de nov. de 2026 às 17:45, Wendy <w@x.test> escreveu:\n\n> Oi"],
    ["solo líneas con >", "Listo\n\n> lo de antes\n> y esto"],
    ["Outlook, separador", "Gracias\n\n-----Mensaje original-----\nDe: Wendy\nEnviado: hoy\nAsunto: Clase\n\nHola"],
    ["Outlook, encabezados", "Gracias\n\nDe: Wendy <w@x.test>\nEnviado: martes, 3 de noviembre de 2026\nPara: Ana\nAsunto: Clase\n\nHola, te cuento"],
    ["correo pasado de HTML a texto, sin >", "Gracias\n\nEl mié, 4 nov 2026, Wendy <w@x.test> escribió:\n\nHola, te cuento"],
  ])("%s", (_name, text) => {
    const { reply, quoted } = splitQuotedReply(text);
    expect(reply.split("\n")[0]).toMatch(/^(Thanks!|Obrigada!|Listo|Gracias)$/);
    expect(reply).not.toContain("Hola");
    expect(quoted).toBeTruthy();
  });

  it("una respuesta intercalada queda entera", () => {
    const text = "Hola\n\nOn Wed Wendy wrote:\n> ¿Venís?\nSí, voy\n> ¿A qué hora?\nA las 7";
    expect(splitQuotedReply(text)).toEqual({ reply: text, quoted: null });
  });

  it("un correo que es solo cita queda entero: nunca un mensaje vacío", () => {
    expect(splitQuotedReply("> solo esto\n> y esto")).toEqual({ reply: "> solo esto\n> y esto", quoted: null });
    expect(splitQuotedReply("On Wed Wendy wrote:\n> Hola")).toEqual({ reply: "On Wed Wendy wrote:\n> Hola", quoted: null });
  });

  it("un texto normal no cambia, aunque mencione palabras parecidas", () => {
    for (const text of ["El martes te escribo", "Hola\nEl dueño me escribió:\nque sí", "De: lunes a viernes\nNos vemos", "Hola"]) {
      expect(splitQuotedReply(text)).toEqual({ reply: text, quoted: null });
    }
    expect(splitQuotedReply("")).toEqual({ reply: "", quoted: null });
    expect(splitQuotedReply(null)).toEqual({ reply: "", quoted: null });
  });
});

describe("withoutQuotedLines", () => {
  it("una cita nunca cuenta como pedido, tampoco en una respuesta intercalada", () => {
    expect(withoutQuotedLines("> Darme de baja\nSí, voy\n> Darme de baja")).toBe("Sí, voy");
    expect(withoutQuotedLines("darme de baja")).toBe("darme de baja");
    expect(withoutQuotedLines("> solo cita")).toBe("");
  });
});

describe("lo que se muestra", () => {
  it("la cita se lee sin los >", () => {
    expect(readableQuote("> Hola\n>\n>> Antes\n> Chau")).toBe("Hola\n\nAntes\nChau");
  });

  it("un mensaje nuevo usa lo guardado; uno viejo se separa al dibujarlo", () => {
    expect(emailBubbleParts({ text: "Gracias", email_quoted_text: "> Hola" })).toEqual({ reply: "Gracias", quoted: "> Hola" });
    expect(emailBubbleParts({ text: GMAIL, email_quoted_text: null }).reply).toBe("Gracias!");
  });
});
