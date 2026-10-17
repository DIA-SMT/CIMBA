"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useMigueInteraction } from "@/components/migue/migue-interaction";

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
  const migue = useMigueInteraction();
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [claveVisible, setClaveVisible] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  // Si vuelve con "atrás" desde adentro, el navegador puede mostrar esta
  // misma página congelada en "Entrando…": se la deja usable otra vez.
  useEffect(() => {
    const alVolver = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      setEntrando(false);
      setCargando(false);
    };
    window.addEventListener("pageshow", alVolver);
    return () => window.removeEventListener("pageshow", alVolver);
  }, []);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usuario.trim() || !clave || cargando) return;
    migue.wink();
    setCargando(true);
    setError(null);
    let entro = false;
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
        /**
         * "NO INGRESA" (14/10). La clave estaba bien —la auditoría muestra el
         * ingreso— pero el botón se reactivaba en el acto mientras la pantalla
         * de destino se armaba (unos segundos: Avance, Mis órdenes), así que
         * no cambiaba nada a la vista y se volvía a tocar: ingresos repetidos
         * a los 3, 6 y 18 segundos. Ahora queda en "Entrando a CIMBA…" hasta
         * que abre, y la navegación es una carga completa —con la barra de
         * progreso del navegador, y sin depender del enrutador del cliente,
         * que después de una publicación nueva puede quedar desfasado—.
         */
        entro = true;
        setEntrando(true);
        window.location.assign(destino === "/clave" || !vuelta ? destino : vuelta);
        return;
      }
      const cuerpo = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(cuerpo?.error ?? "No se pudo ingresar");
    } catch {
      setError("Se cortó la conexión. Probá de nuevo.");
    } finally {
      // Si entró, el botón queda ocupado hasta que cambia la página.
      if (!entro) setCargando(false);
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
        disabled={cargando || entrando || !usuario.trim() || !clave}
        className="w-full rounded-xl bg-azul px-4 py-3.5 text-center font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
      >
        {entrando ? "Entrando a CIMBA…" : cargando ? "Ingresando…" : "Ingresar"}
      </button>
    </form>
  );
}
