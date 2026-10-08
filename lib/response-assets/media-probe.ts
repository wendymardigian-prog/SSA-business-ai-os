/**
 * Lo que el NAVEGADOR puede sacar de un archivo antes de subirlo: la
 * duracion de un audio o un video, y la miniatura del primer fotograma de un
 * video (banca v2, F6).
 *
 * Solo navegador (usa <video>, <audio> y <canvas>). Nunca lanza y siempre
 * termina: si el navegador no sabe abrir ese formato (un .mov en HEVC en
 * Chrome, un .3gp), o tarda mas que `timeoutMs`, devuelve null y el alta
 * sigue igual -- la lista muestra el icono del tipo. Una miniatura es una
 * comodidad, nunca un requisito.
 */

export interface MediaProbe {
  durationSeconds: number | null;
  /** jpg del primer fotograma. Solo para un video. */
  thumbnail: Blob | null;
}

const EMPTY: MediaProbe = { durationSeconds: null, thumbnail: null };

/** Ancho maximo de la miniatura: alcanza para una fila y pesa pocos KB. */
const THUMB_WIDTH = 480;

function roundDuration(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : null;
}

export function probeMedia(file: Blob, kind: "audio" | "video", timeoutMs = 5000): Promise<MediaProbe> {
  if (typeof document === "undefined") return Promise.resolve(EMPTY);

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const element = document.createElement(kind);
    let duration: number | null = null;
    let settled = false;

    const finish = (result: MediaProbe) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      element.removeAttribute("src");
      element.load();
      URL.revokeObjectURL(url);
      resolve(result);
    };

    const timer = setTimeout(() => finish({ durationSeconds: duration, thumbnail: null }), timeoutMs);

    element.preload = "metadata";
    element.muted = true;
    if (element instanceof HTMLVideoElement) element.playsInline = true;

    element.onerror = () => finish({ durationSeconds: duration, thumbnail: null });

    element.onloadedmetadata = () => {
      duration = roundDuration(element.duration);
      if (kind === "audio") {
        finish({ durationSeconds: duration, thumbnail: null });
        return;
      }
      // El fotograma 0 suele ser negro (un fundido): un toque mas adelante.
      const target = Number.isFinite(element.duration) && element.duration > 0 ? Math.min(0.5, element.duration / 3) : 0;
      element.currentTime = target;
    };

    element.onseeked = () => {
      const video = element as HTMLVideoElement;
      if (!video.videoWidth || !video.videoHeight) {
        finish({ durationSeconds: duration, thumbnail: null });
        return;
      }
      try {
        const scale = Math.min(1, THUMB_WIDTH / video.videoWidth);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        const context = canvas.getContext("2d");
        if (!context) {
          finish({ durationSeconds: duration, thumbnail: null });
          return;
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => finish({ durationSeconds: duration, thumbnail: blob }),
          "image/jpeg",
          0.8,
        );
      } catch {
        finish({ durationSeconds: duration, thumbnail: null });
      }
    };

    element.src = url;
  });
}
