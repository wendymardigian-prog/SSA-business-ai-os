import { describe, expect, it } from "vitest";
import { hasSpeakers, segmentTranscript, transcriptToText } from "./transcript-segments";

const sp = (n: string) => ({ display_name: n });

describe("segmentTranscript", () => {
  it("transcripción vacía o con forma inesperada → sin segmentos", () => {
    expect(segmentTranscript(null)).toEqual([]);
    expect(segmentTranscript("texto suelto")).toEqual([]);
    expect(segmentTranscript([])).toEqual([]);
  });

  it("une locuciones seguidas del mismo hablante en un solo turno", () => {
    const t = [
      { text: "Hola, muy bien, todo excelente.", speaker: sp("Hellen"), timestamp: "00:00:00" },
      { text: "Un gustazo tenerte por acá, finalmente.", speaker: sp("Hellen"), timestamp: "00:00:04" },
    ];
    const segs = segmentTranscript(t);
    expect(segs).toHaveLength(1);
    expect(segs[0].content).toBe("Hellen: Hola, muy bien, todo excelente. Un gustazo tenerte por acá, finalmente.");
    expect(segs[0].speaker).toBe("Hellen");
  });

  it("arrastra el rango de tiempo del pedazo", () => {
    const t = [
      { text: "Primera cosa que se dice en la llamada de ventas.", speaker: sp("Hellen"), timestamp: "00:00:10" },
      { text: "Respuesta del prospecto con su objeción principal.", speaker: sp("Elizabeth"), timestamp: "00:01:30" },
    ];
    const [seg] = segmentTranscript(t);
    expect(seg.tsStart).toBe("00:00:10");
    expect(seg.tsEnd).toBe("00:01:30");
  });

  it("deja speaker en null cuando el pedazo mezcla voces, pero conserva los nombres en el texto", () => {
    const t = [
      { text: "Contame un poco de tu situación actual, así te oriento.", speaker: sp("Hellen"), timestamp: "00:00:01" },
      { text: "Estoy buscando cambiar de trabajo este año.", speaker: sp("Elizabeth"), timestamp: "00:00:20" },
    ];
    const [seg] = segmentTranscript(t);
    expect(seg.speaker).toBeNull();
    expect(seg.content).toContain("Hellen:");
    expect(seg.content).toContain("Elizabeth:");
  });

  it("parte cuando se pasa del tope y ningún pedazo lo excede de más", () => {
    const largo = "Una frase de la llamada que se repite mucho. ".repeat(120);
    const segs = segmentTranscript([{ text: largo, speaker: sp("Hellen"), timestamp: "00:00:00" }]);
    expect(segs.length).toBeGreaterThan(1);
    for (const s of segs) expect(s.content.length).toBeLessThanOrEqual(1300);
    // El nombre se repite en cada pedazo: si no, la mitad no diría quién habla.
    for (const s of segs) expect(s.content.startsWith("Hellen: ")).toBe(true);
  });

  it("transcripción sin hablantes (resumen importado) → igual produce pedazos", () => {
    const t = [
      { text: "Propósito de la reunión" },
      { text: "Evaluar el programa de setting para la transición profesional de Kembly." },
      { text: "Motivación: busca un ingreso de $1.500 al mes para reemplazar su trabajo." },
    ];
    const segs = segmentTranscript(t);
    expect(segs.length).toBeGreaterThan(0);
    expect(segs[0].speaker).toBeNull();
    expect(segs[0].content).toContain("Kembly");
  });
});

describe("hasSpeakers", () => {
  it("distingue una llamada real de un resumen pegado", () => {
    expect(hasSpeakers([{ text: "hola", speaker: sp("Hellen") }])).toBe(true);
    expect(hasSpeakers([{ text: "Puntos clave" }, { text: "algo" }])).toBe(false);
    expect(hasSpeakers(null)).toBe(false);
  });
});

describe("transcriptToText", () => {
  it("arma el texto plano con los nombres delante", () => {
    const t = [
      { text: "Buenas.", speaker: sp("Hellen"), timestamp: "00:00:00" },
      { text: "Hola.", speaker: sp("Bryan"), timestamp: "00:00:02" },
    ];
    expect(transcriptToText(t)).toBe("Hellen: Buenas.\nBryan: Hola.");
  });

  it("sin hablantes devuelve sólo el texto", () => {
    expect(transcriptToText([{ text: "Puntos clave" }, { text: "algo más" }])).toBe("Puntos clave\nalgo más");
  });
});
