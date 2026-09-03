"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cambiarMiClave } from "@/lib/acciones-clave";
import { Panel } from "@/components/ui";

export function FormularioClave({ nombre }: { nombre: string }) {
  const router = useRouter();
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [pendiente, iniciar] = useTransition();

  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (nueva !== repetida) {
      setError("Las claves nuevas no coinciden");
      return;
    }
    iniciar(async () => {
      try {
        await cambiarMiClave({ actual, nueva });
        setListo(true);
        setTimeout(() => router.push("/mapa"), 1200);
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo cambiar la clave");
      }
    });
  };

  if (listo) {
    return (
      <Panel className="p-6 text-center">
        <p className="text-lg font-bold" style={{ color: "var(--color-ok)" }}>
          Clave cambiada ✓
        </p>
        <p className="mt-1 text-sm text-texto-2">Listo, {nombre}. Te llevo al mapa…</p>
      </Panel>
    );
  }

  const claseInput =
    "w-full rounded-xl border border-borde-2 bg-panel-2 px-4 py-3 text-sm outline-none placeholder:text-texto-3 focus:border-celeste/50";

  return (
    <Panel className="p-5">
      <form onSubmit={enviar} className="space-y-3">
        <input
          type="password"
          value={actual}
          onChange={(e) => setActual(e.target.value)}
          placeholder="Clave actual"
          autoComplete="current-password"
          className={claseInput}
        />
        <input
          type="password"
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          placeholder="Clave nueva (mínimo 8 caracteres)"
          autoComplete="new-password"
          className={claseInput}
        />
        <input
          type="password"
          value={repetida}
          onChange={(e) => setRepetida(e.target.value)}
          placeholder="Repetí la clave nueva"
          autoComplete="new-password"
          className={claseInput}
        />
        {error && <p className="text-center text-xs text-peligro">{error}</p>}
        <button
          type="submit"
          disabled={pendiente || !actual || nueva.length < 8 || !repetida}
          className="w-full rounded-xl bg-azul px-4 py-3.5 font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {pendiente ? "Cambiando…" : "Cambiar mi clave"}
        </button>
      </form>
    </Panel>
  );
}
