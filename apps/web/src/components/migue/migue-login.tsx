"use client";

import Image from "next/image";
import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import styles from "./migue-login.module.css";
import { useMigueInteraction } from "./migue-interaction";
import type { mountMigue } from "./migue-scene";

export function MigueLogin() {
  const { mode, winkId } = useMigueInteraction();
  const interaction = useRef({ mode, winkId });
  interaction.current = { mode, winkId };
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<ReturnType<typeof mountMigue> | null>(null);
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const [phase, setPhase] = useState<"poster" | "ready">("poster");

  useEffect(() => { controller.current?.setInteraction({ mode, winkId }); }, [mode, winkId]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let cancelled = false, started = false;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const preference = () => {
      pausedRef.current = motion.matches; setPaused(motion.matches);
      controller.current?.setPaused(motion.matches);
    };
    preference(); motion.addEventListener("change", preference);
    const start = async () => {
      if (started || cancelled) return;
      started = true;
      // Data saver keeps the lightweight poster; the form never waits for WebGL.
      const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
      if (connection?.saveData) return;
      try {
        const { mountMigue } = await import("./migue-scene");
        if (cancelled) return;
        controller.current = mountMigue(element, {
          paused: pausedRef.current,
          interaction: interaction.current,
          ready: () => { if (!cancelled) setPhase("ready"); },
          unavailable: () => { if (!cancelled) setPhase("poster"); },
        });
      } catch { /* The poster remains visible if 3D is unavailable. */ }
    };
    const observer = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) { observer.disconnect(); void start(); } });
    // Give the login's first paint priority over the decorative scene.
    const timer = window.setTimeout(() => observer.observe(element), 180);
    return () => {
      cancelled = true; clearTimeout(timer); observer.disconnect();
      motion.removeEventListener("change", preference);
      controller.current?.dispose(); controller.current = null;
    };
  }, []);

  function toggle() {
    const value = !pausedRef.current;
    pausedRef.current = value; setPaused(value); controller.current?.setPaused(value);
  }

  return (
    <section className={styles.companion} aria-label="Migue, asistente de CIMBA">
      <div className={styles.greeting}>
        <p className={styles.eyebrow}>TU ASISTENTE EN CIMBA</p>
        <h2>¡Hola! Soy Migue.</h2>
        <p>Qué bueno verte por acá.</p>
      </div>
      <div className={styles.figure}>
        <div className={styles.halo} aria-hidden="true" />
        <div className={styles.portrait} aria-hidden="true">
          <Image src="/marca/migue/migue-casco-v3.png" alt="" fill priority sizes="(max-width: 639px) 160px, 480px" className={`${styles.poster} ${phase === "ready" ? styles.loaded : ""}`} />
          <div ref={host} className={styles.canvas} />
        </div>
        {phase === "ready" && (
          <button type="button" onClick={toggle} className={styles.motion} aria-label={paused ? "Activar animación de Migue" : "Pausar animación de Migue"} aria-pressed={paused}>
            {paused ? <Play size={13} aria-hidden /> : <Pause size={13} aria-hidden />}
            <span>{paused ? "Animar" : "Pausar"}</span>
          </button>
        )}
      </div>
    </section>
  );
}
