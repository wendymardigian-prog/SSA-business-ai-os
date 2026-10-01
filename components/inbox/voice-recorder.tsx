"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2, Play, Pause, Send } from "lucide-react";
import {
  pickRecordingMime,
  extensionForRecordingMime,
  formatRecordingDuration,
  microphoneErrorMessage,
  MAX_RECORDING_MS,
} from "@/lib/audio/recording";

/**
 * El grabador de audio del composer (F18).
 *
 * Tres estados: grabando (punto rojo + contador + Descartar/Escuchar/Enviar
 * queda disponible recien al soltar), escuchando lo grabado, y enviando. La
 * logica de que mime elegir, como formatear el contador y traducir los
 * errores vive en lib/audio/recording.ts (pura, testeada); esto solo la usa.
 *
 * Cancelar NUNCA envia: `cancelledRef` es una bandera por referencia porque
 * `onstop` no sabe POR QUE se detuvo (el usuario pudo haber apretado
 * Descartar o Enviar, el evento es el mismo).
 */
export function VoiceRecorder({
  onSend,
  onCancel,
}: {
  onSend: (file: Blob, mime: string, durationSeconds: number) => void;
  onCancel: () => void;
}) {
  const [phase, setPhase] = useState<"recording" | "ready" | "error">("recording");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [autoStopped, setAutoStopped] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);
  const mimeRef = useRef<string>("audio/mp4");
  const startRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobRef = useRef<Blob | null>(null);
  /** true cuando se aprieta "Enviar" DURANTE la grabacion: manda apenas el blob este listo, sin pasar por "escuchar". */
  const sendOnStopRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      const mime = pickRecordingMime();
      if (!mime) {
        setError("Este navegador no puede grabar audio.");
        setPhase("error");
        return;
      }
      mimeRef.current = mime;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const recorder = new MediaRecorder(stream, { mimeType: mime });
        recorderRef.current = recorder;
        chunksRef.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onstop = () => {
          stopTracks();
          if (cancelledRef.current) return;
          const blob = new Blob(chunksRef.current, { type: mimeRef.current });
          if (blob.size === 0) {
            onCancel();
            return;
          }
          blobRef.current = blob;
          if (sendOnStopRef.current) {
            onSend(blob, mimeRef.current, (Date.now() - startRef.current) / 1000);
            return;
          }
          setPhase("ready");
        };

        startRef.current = Date.now();
        recorder.start();
        intervalRef.current = setInterval(() => {
          const elapsed = (Date.now() - startRef.current) / 1000;
          setSeconds(elapsed);
          if (Date.now() - startRef.current >= MAX_RECORDING_MS) {
            setAutoStopped(true);
            stopRecording();
          }
        }, 200);
      } catch (err) {
        if (cancelled) return;
        setError(microphoneErrorMessage(err));
        setPhase("error");
      }
    }

    start();

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
      // Si el composer se desmonta mientras se graba (se cambio de
      // conversacion), el stream se corta igual: si no, el indicador de
      // microfono del navegador queda prendido.
      stopTracks();
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        cancelledRef.current = true;
        recorderRef.current.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- arranca una sola vez, al montar.
  }, []);

  function stopTracks() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function stopRecording() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    recorderRef.current?.stop();
  }

  function handleDiscard() {
    cancelledRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    } else {
      stopTracks();
    }
    onCancel();
  }

  function handleStopAndReview() {
    cancelledRef.current = false;
    stopRecording();
  }

  function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
    } else {
      el.play();
    }
  }

  function handleSend() {
    if (!blobRef.current) return;
    onSend(blobRef.current, mimeRef.current, seconds);
  }

  if (phase === "error") {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        <span>{error}</span>
        <button type="button" onClick={onCancel} className="font-medium hover:underline">
          Cerrar
        </button>
      </div>
    );
  }

  if (phase === "recording") {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2">
        <span className="h-2.5 w-2.5 flex-shrink-0 animate-pulse rounded-full bg-red-500" aria-hidden />
        <span className="flex-1 text-sm tabular-nums text-muted-foreground">
          Grabando {formatRecordingDuration(seconds)}
        </span>
        <button
          type="button"
          onClick={handleDiscard}
          aria-label="Descartar"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
        >
          <Trash2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={handleStopAndReview}
          aria-label="Escuchar"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
        >
          <Pause className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            cancelledRef.current = false;
            sendOnStopRef.current = true;
            stopRecording();
          }}
          aria-label="Enviar"
          className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:opacity-90"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    );
  }

  // phase === "ready": escuchar antes de mandar.
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2">
      {blobRef.current && (
        <audio
          ref={audioRef}
          src={URL.createObjectURL(blobRef.current)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          className="hidden"
        />
      )}
      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? "Pausar" : "Escuchar"}
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-muted text-foreground hover:bg-accent"
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <span className="flex-1 truncate text-sm tabular-nums text-muted-foreground">
        {formatRecordingDuration(seconds)}
        {autoStopped && <span className="ml-2 text-xs normal-case text-amber-600">Se cortó a los 5 minutos</span>}
      </span>
      <button
        type="button"
        onClick={handleDiscard}
        aria-label="Descartar"
        className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={handleSend}
        aria-label="Enviar"
        className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:opacity-90"
      >
        <Send className="h-4 w-4" />
      </button>
    </div>
  );
}

/** La extension con la que se nombra el archivo que se sube, a partir del mime de la grabacion. */
export function recordingFilename(mime: string): string {
  return `nota-de-voz.${extensionForRecordingMime(mime)}`;
}
