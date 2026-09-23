"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Solo rutas internas: "/campo" sí; "//otro-sitio", "https://…" o volver al
 * mismo acceso, no. El ?volver= lo escribe cualquiera en la URL.
 */
function volverSeguro(v: string | undefined): string | null {
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return null;
  if (v.startsWith("/acceso") || v.startsWith("/api")) return null;
  return v;
}

/** Acceso simple temporal: un usuario y contraseña, mientras no está conectado el SSO. */
export function FormularioAcceso({ volver }: { volver?: string } = {}) {
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
        // El destino depende de quién entró: el personal va al mapa,
        // las empresas contratistas a su portal de órdenes.
        const cuerpo = (await res.json().catch(() => null)) as { destino?: string } | null;
        // Si la sesión se había cerrado en medio del trabajo, se vuelve adonde
        // estaba. La clave temporal manda igual: primero se cambia.
        const destino = cuerpo?.destino ?? "/mapa";
        const vuelta = volverSeguro(volver);
        router.push(destino === "/clave" || !vuelta ? destino : vuelta);
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
