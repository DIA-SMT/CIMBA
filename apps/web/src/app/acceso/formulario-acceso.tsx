"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useMigueInteraction } from "@/components/migue/migue-interaction";

/** Acceso simple temporal: un usuario y contraseña, mientras no está conectado el SSO. */
export function FormularioAcceso() {
  const router = useRouter();
  const migue = useMigueInteraction();
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [claveVisible, setClaveVisible] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usuario.trim() || !clave || cargando) return;
    migue.wink();
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
        router.push(cuerpo?.destino ?? "/mapa");
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

  function togglePassword() {
    const visible = !claveVisible;
    setClaveVisible(visible);
    migue.select(visible ? "password-visible" : "password-hidden");
  }

  return (
    <form onSubmit={entrar} className="space-y-3" onBlurCapture={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) migue.select("idle");
    }}>
      <input
        id="login-usuario"
        name="username"
        aria-label="Usuario"
        data-migue-input="username"
        value={usuario}
        onFocus={() => migue.select("username")}
        onChange={(e) => setUsuario(e.target.value)}
        placeholder="Usuario"
        autoComplete="username"
        className="w-full rounded-xl border border-borde-2 bg-panel-2 px-4 py-3 text-sm outline-none placeholder:text-texto-3 focus:border-celeste/50"
      />
      <div className="relative">
        <input
          id="login-clave"
          name="password"
          aria-label="Contraseña"
          data-migue-input="password"
          type={claveVisible ? "text" : "password"}
          value={clave}
          onFocus={() => migue.select(claveVisible ? "password-visible" : "password-hidden")}
          onChange={(e) => setClave(e.target.value)}
          placeholder="Contraseña"
          autoComplete="current-password"
          className="w-full rounded-xl border border-borde-2 bg-panel-2 px-4 py-3 pr-12 text-sm outline-none placeholder:text-texto-3 focus:border-celeste/50"
        />
        <button
          type="button"
          aria-label={claveVisible ? "Ocultar contraseña" : "Mostrar contraseña"}
          aria-controls="login-clave"
          aria-pressed={claveVisible}
          onFocus={() => migue.select(claveVisible ? "password-visible" : "password-hidden")}
          onPointerDown={(event) => { if (event.pointerType === "mouse") event.preventDefault(); }}
          onClick={togglePassword}
          className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-texto-3 hover:text-texto focus-visible:outline-2 focus-visible:outline-celeste"
        >
          {claveVisible ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
        </button>
      </div>
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
