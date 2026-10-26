/**
 * Голосовой ввод в «Добавить еду»: запись MediaRecorder → Blob → POST /transcribe.
 *
 * Лимиты согласованы с сервером: запись не длиннее 60 с (автостоп), base64 не
 * больше 700 000 символов (тело под лимитом nginx в 1 МБ). Битрейт 32 кбит/с —
 * минута речи укладывается с запасом.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export const MAX_RECORD_SECONDS = 60;
export const MAX_AUDIO_BASE64_CHARS = 700_000;
const AUDIO_BITS_PER_SECOND = 32_000;

/** Порядок предпочтения: Android/Desktop — webm, iOS WebView — mp4. */
export const AUDIO_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

/** Первый mimeType, который поддерживает MediaRecorder; null — пусть выберет сам. */
export function pickAudioMimeType(isSupported: (type: string) => boolean): string | null {
  for (const type of AUDIO_MIME_CANDIDATES) {
    try {
      if (isSupported(type)) return type;
    } catch {
      /* старый движок без isTypeSupported */
    }
  }
  return null;
}

/** Blob → base64 без data:-префикса. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? "");
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

/** Причина, по которой запись не началась: нет API или пользователь не дал доступ. */
export type VoiceStartError = "unavailable";

interface Options {
  onRecorded: (blob: Blob, mimeType: string) => void;
  onError: (reason: VoiceStartError) => void;
}

/**
 * Запись с микрофона. Треки микрофона останавливаются при стопе, отмене и
 * размонтировании — иначе в Telegram висит индикатор активного микрофона.
 */
export function useVoiceRecorder({ onRecorded, onError }: Options) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timersRef = useRef<{ tick?: number; limit?: number }>({});
  const cancelledRef = useRef(false);
  const callbacks = useRef({ onRecorded, onError });
  callbacks.current = { onRecorded, onError };

  const releaseMic = useCallback(() => {
    window.clearInterval(timersRef.current.tick);
    window.clearTimeout(timersRef.current.limit);
    timersRef.current = {};
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    else releaseMic();
  }, [releaseMic]);

  /** Остановить без отправки (закрытие шторки). */
  const cancel = useCallback(() => {
    cancelledRef.current = true;
    stop();
    releaseMic();
    setRecording(false);
  }, [stop, releaseMic]);

  const start = useCallback(async () => {
    if (recorderRef.current?.state === "recording") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      callbacks.current.onError("unavailable");
      return;
    }
    cancelledRef.current = false;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Отказ в доступе или клиент Telegram не пускает к микрофону.
      if (!cancelledRef.current) callbacks.current.onError("unavailable");
      return;
    }
    // Шторку закрыли, пока висел системный запрос доступа, — не пишем.
    if (cancelledRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    const mimeType = pickAudioMimeType((t) => MediaRecorder.isTypeSupported(t));
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      });
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      callbacks.current.onError("unavailable");
      return;
    }

    const chunks: Blob[] = [];
    streamRef.current = stream;
    recorderRef.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      releaseMic();
      recorderRef.current = null;
      setRecording(false);
      if (cancelledRef.current || chunks.length === 0) return;
      const type = rec.mimeType || mimeType || "audio/webm";
      callbacks.current.onRecorded(new Blob(chunks, { type }), type);
    };

    rec.start();
    setSeconds(0);
    setRecording(true);
    const startedAt = Date.now();
    timersRef.current.tick = window.setInterval(
      () => setSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      250,
    );
    // На секунду раньше лимита: MediaRecorder дописывает хвост после stop(),
    // а сервер отказывает записям длиннее MAX_RECORD_SECONDS.
    timersRef.current.limit = window.setTimeout(() => stop(), (MAX_RECORD_SECONDS - 1) * 1000);
  }, [releaseMic, stop]);

  // Размонтирование (закрыли шторку) — гасим микрофон без отправки.
  useEffect(
    () => () => {
      cancelledRef.current = true;
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") rec.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      window.clearInterval(timersRef.current.tick);
      window.clearTimeout(timersRef.current.limit);
    },
    [],
  );

  return { recording, seconds, start, stop, cancel };
}
