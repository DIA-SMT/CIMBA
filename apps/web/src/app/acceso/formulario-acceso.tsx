"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Acceso simple temporal: un usuario y contraseña, mientras no está conectado el SSO. */
export function FormularioAcceso() {
  const router = useRouter();
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usuario.trim() || !clave || cargando) return;
    setCargando(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/simple", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ usuario: usuario.trim(), clave }),
      });
      if (res.ok) {
        router.push("/mapa");
        return;
      }
      const cuerpo = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(cuerpo?.error ?? "No se pudo ingresar");
    } catch {
      setError("Se cortó la conexión. Probá de nuevo.");
    } finally {
      setCargando(false);
    }
  };

  return (
    <form onSubmit={entrar} className="space-y-3">
      <input
        value={usuario}
        onChange={(e) => setUsuario(e.target.value)}
        placeholder="Usuario"
        autoComplete="username"
        className="w-full rounded-xl border border-borde-2 bg-panel-2 px-4 py-3 text-sm outline-none placeholder:text-texto-3 focus:border-celeste/50"
      />
      <input
        type="password"
        value={clave}
        onChange={(e) => setClave(e.target.value)}
        placeholder="Contraseña"
        autoComplete="current-password"
        className="w-full rounded-xl border border-borde-2 bg-panel-2 px-4 py-3 text-sm outline-none placeholder:text-texto-3 focus:border-celeste/50"
      />
      {error && <p className="text-center text-xs text-peligro">{error}</p>}
      <button
        type="submit"
        disabled={cargando || !usuario.trim() || !clave}
        className="w-full rounded-xl bg-azul px-4 py-3.5 text-center font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
      >
        {cargando ? "Ingresando…" : "Ingresar"}
      </button>
    </form>
  );
}
