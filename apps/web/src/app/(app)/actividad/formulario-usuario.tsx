"use client";

import { ChevronDown, Check, Copy, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { crearUsuarioLocal } from "@/lib/acciones-usuarios";
import { mensajeDeError } from "@/lib/errores";

const ROLES: Array<{ valor: string; etiqueta: string }> = [
  { valor: "lectura", etiqueta: "Lectura" },
  { valor: "atencion_ciudadana", etiqueta: "Atención ciudadana" },
  { valor: "planificacion", etiqueta: "Planificación" },
  { valor: "supervision", etiqueta: "Supervisión" },
  { valor: "cuadrilla", etiqueta: "Cuadrilla" },
  { valor: "hcd", etiqueta: "HCD" },
  { valor: "informacion_estrategica", etiqueta: "Información estratégica" },
  { valor: "funcionario", etiqueta: "Funcionario (pedidos de territorio)" },
  { valor: "admin", etiqueta: "Admin (superadmin)" },
];

/**
 * Alta de un usuario local: nombre + usuario + rol. La clave la genera el
 * sistema (no se elige a mano) y se muestra UNA vez — de ahí en más solo
 * queda el hash. Entra marcada como temporal: el primer ingreso la obliga a
 * cambiarla antes de dejarla usar cualquier otra pantalla.
 */
export function FormularioUsuario() {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [usuario, setUsuario] = useState("");
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [rol, setRol] = useState("lectura");
  const [error, setError] = useState<string | null>(null);
  const [creado, setCreado] = useState<{ usuario: string; clave: string } | null>(null);
  const [copiada, setCopiada] = useState(false);

  const crear = () => {
    setError(null);
    startTransition(async () => {
      try {
        const r = await crearUsuarioLocal({ usuario, nombre, email, rol });
        setCreado(r);
        setUsuario("");
        setNombre("");
        setEmail("");
        setRol("lectura");
        router.refresh();
      } catch (e) {
        setError(mensajeDeError(e, "No se pudo crear el usuario"));
      }
    });
  };

  const copiar = async () => {
    if (!creado) return;
    try {
      await navigator.clipboard.writeText(creado.clave);
      setCopiada(true);
      setTimeout(() => setCopiada(false), 2500);
    } catch {
      setError("No se pudo copiar sola: seleccionala y copiala a mano.");
    }
  };

  return (
    <details className="relative">
      <summary
        onClick={() => setCreado(null)}
        className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-borde-2 px-4 py-2 text-sm font-semibold text-texto-2 transition select-none hover:border-celeste/50 hover:text-celeste [&::-webkit-details-marker]:hidden"
      >
        <UserPlus size={14} /> Nuevo usuario <ChevronDown size={14} />
      </summary>

      <div className="panel-vidrio absolute right-0 z-20 mt-1.5 w-60 rounded-xl p-3 text-sm">
        {creado ? (
          <div>
            <p className="mb-2 text-[13px] text-texto-2">
              Acceso creado para <b>{creado.usuario}</b>. Pasale esto al referente — no se vuelve a mostrar:
            </p>
            <div className="flex items-center gap-2">
              <code className="num rounded-md border border-amarillo/50 bg-amarillo/10 px-2.5 py-1 text-sm font-bold tracking-wider text-amarillo select-all">
                {creado.clave}
              </code>
              <button
                onClick={() => void copiar()}
                title="Copiar la clave"
                className="rounded-md border border-borde-2 p-1.5 text-texto-2 transition hover:border-celeste hover:text-celeste"
              >
                {copiada ? <Check size={13} style={{ color: "#199e70" }} /> : <Copy size={13} />}
              </button>
            </div>
            <button onClick={() => setCreado(null)} className="mt-3 text-xs font-semibold text-celeste hover:underline">
              + dar de alta otro
            </button>
          </div>
        ) : (
          <div className="space-y-2.5">
            <p className="text-[11px] leading-snug text-texto-3">
              El sistema genera la clave sola y entra marcada como temporal: en el primer ingreso, antes que
              nada, va a tener que cambiarla.
            </p>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-texto-2">Nombre y apellido</span>
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="María López"
                className="w-full rounded-lg border border-borde-2 bg-panel px-2.5 py-1.5 text-sm outline-none focus:border-celeste"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-texto-2">Usuario</span>
              <input
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
                placeholder="email o nombre de usuario"
                className="w-full rounded-lg border border-borde-2 bg-panel px-2.5 py-1.5 text-sm outline-none focus:border-celeste"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-texto-2">Email (opcional)</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="para avisos, si aplica"
                className="w-full rounded-lg border border-borde-2 bg-panel px-2.5 py-1.5 text-sm outline-none focus:border-celeste"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-texto-2">Rol</span>
              <select
                value={rol}
                onChange={(e) => setRol(e.target.value)}
                className="w-full rounded-lg border border-borde-2 bg-panel px-2.5 py-1.5 text-sm outline-none focus:border-celeste"
              >
                {ROLES.map((r) => (
                  <option key={r.valor} value={r.valor}>
                    {r.etiqueta}
                  </option>
                ))}
              </select>
            </label>
            {error && <p className="text-[11px] text-peligro">{error}</p>}
            <button
              onClick={crear}
              disabled={pendiente || !usuario.trim() || !nombre.trim()}
              className="w-full rounded-lg bg-azul px-3 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
            >
              {pendiente ? "Creando…" : "Crear usuario"}
            </button>
          </div>
        )}
      </div>
    </details>
  );
}
