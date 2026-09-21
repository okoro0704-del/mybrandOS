import { useEffect, useState } from "react";

export type MediaOutcome = { kind: "hearts" } | { kind: "text"; text: string };

export type MediaParticle =
  | { id: number; kind: "heart"; left: number; delay: number; duration: number; drift: number; size: number }
  | { id: number; kind: "text"; text: string; left: number; duration: number };

let particleSeq = 1;

export function spawnMediaOutcome(outcome: MediaOutcome): MediaParticle[] {
  if (outcome.kind === "hearts") {
    return Array.from({ length: 10 }, (_, i) => ({
      id: particleSeq++,
      kind: "heart" as const,
      left: 10 + Math.random() * 80,
      delay: i * 55,
      duration: 1500 + Math.random() * 800,
      drift: (Math.random() - 0.5) * 56,
      size: 18 + Math.random() * 18,
    }));
  }
  return [
    {
      id: particleSeq++,
      kind: "text",
      text: outcome.text,
      left: 16 + Math.random() * 48,
      duration: 2300,
    },
  ];
}

export function MediaOutcomeLayer({
  particles,
  onExpire,
}: {
  particles: MediaParticle[];
  onExpire: (id: number) => void;
}) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  if (!particles.length) return null;
  return (
    <div className="media-outcome" data-reduced={reduced ? "true" : undefined} aria-hidden>
      {particles.map((particle) =>
        particle.kind === "heart" ? (
          <span
            key={particle.id}
            className="media-outcome__heart"
            style={{
              left: `${particle.left}%`,
              animationDelay: `${particle.delay}ms`,
              animationDuration: `${particle.duration}ms`,
              fontSize: `${particle.size}px`,
              ["--drift" as string]: `${particle.drift}px`,
            }}
            onAnimationEnd={() => onExpire(particle.id)}
          >
            ❤️
          </span>
        ) : (
          <span
            key={particle.id}
            className="media-outcome__text"
            style={{
              left: `${particle.left}%`,
              animationDuration: `${particle.duration}ms`,
            }}
            onAnimationEnd={() => onExpire(particle.id)}
          >
            {particle.text}
          </span>
        ),
      )}
    </div>
  );
}
