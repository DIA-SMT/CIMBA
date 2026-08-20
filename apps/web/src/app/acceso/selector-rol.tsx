"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ROLES_USUARIO } from "@cimba/domain";

export function SelectorRolDev({ requiereCodigo }: { requiereCodigo: boolean }) {
  const router = useRouter();
  const [cargando, setCargando] = useState<string | null>(null);
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const entrar = async (rol: string) => {
    setCargando(rol);
    setError(null);
    const res = await fetch("/api/auth/dev", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rol, codigo: codigo || undefined }),
    });
    if (res.ok) router.push("/mapa");
    else {
      const cuerpo = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(cuerpo?.error ?? "No se pudo ingresar");
      setCargando(null);
    }
  };

  return (
    <div className="mt-6 border-t border-borde pt-5">
      <p className="mb-3 text-center text-[11px] font-semibold tracking-widest text-amarillo uppercase">
        Beta abierta · elegí un rol para explorar
      </p>
      {requiereCodigo && (
        <input
          type="password"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          placeholder="Código de acceso del equipo"
          className="mb-3 w-full rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-center text-sm placeholder:text-texto-3"
        />
      )}
      {error && <p className="mb-2 text-center text-xs text-peligro">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        {ROLES_USUARIO.map((rol) => (
          <button
            key={rol}
            onClick={() => entrar(rol)}
            disabled={cargando !== null}
            className="rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-xs font-medium text-texto-2 transition hover:border-celeste hover:text-texto disabled:opacity-50"
          >
            {cargando === rol ? "…" : rol.replaceAll("_", " ")}
          </button>
        ))}
      </div>
    </div>
  );
}
