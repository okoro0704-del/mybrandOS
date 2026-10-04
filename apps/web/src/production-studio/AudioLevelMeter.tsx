import { useEffect, useRef, useState } from "react";

/** Real input level from the microphone via WebAudio. Shows nothing it cannot measure. */
export function AudioLevelMeter({ stream }: { stream: MediaStream | null }) {
  const [level, setLevel] = useState(0);
  const [peak, setPeak] = useState(0);
  const frame = useRef(0);

  useEffect(() => {
    if (!stream || !stream.getAudioTracks().length) {
      setLevel(0);
      return;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let held = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / data.length);
      const db = 20 * Math.log10(Math.max(rms, 1e-5));
      const normalized = Math.max(0, Math.min(1, (db + 60) / 60));
      held = Math.max(normalized, held - 0.01);
      setLevel(normalized);
      setPeak(held);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame.current);
      source.disconnect();
      void ctx.close();
    };
  }, [stream]);

  const hasInput = Boolean(stream?.getAudioTracks().length);
  return (
    <div className="audio-meter" data-has-input={hasInput ? "true" : "false"}>
      <div className="audio-meter__label">{hasInput ? "Microphone input" : "No microphone input"}</div>
      <div className="audio-meter__bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)} aria-label="Microphone level">
        <span className="audio-meter__fill" style={{ transform: `scaleX(${level})` }} />
        <span className="audio-meter__peak" style={{ left: `${peak * 100}%` }} />
      </div>
      <div className="audio-meter__scale" aria-hidden><span>-60</span><span>-30</span><span>-12</span><span>0 dB</span></div>
    </div>
  );
}
