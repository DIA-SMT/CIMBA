"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ROLES_USUARIO } from "@cimba/domain";
import { modificarUsuario, type UsuarioAdmin } from "@/lib/acciones-usuarios";
import { mensajeDeError } from "@/lib/errores";
import { fechaCorta } from "@/lib/formato";

/**
 * Una fila del padrón, editable en el lugar.
 *
 * El rol se cambia con un select que guarda al soltarlo, sin botón: son
 * cambios de una sola cosa y un formulario con "Guardar" para un solo campo
 * agrega un paso que nadie necesita. Lo irreversible —dar de baja— sí pide
 * confirmación.
 */

const ROLES = ROLES_USUARIO.filter((r) => r !== "empresa");

export function FilaUsuario({
  usuario: u,
  etiquetaRol,
  esUnoMismo,
  accionClave,
}: {
  usuario: UsuarioAdmin;
  etiquetaRol: Record<string, string>;
  esUnoMismo: boolean;
  accionClave: React.ReactNode;
}) {
  const router = useRouter();
  const [pendiente, comenzar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const guardar = (cambio: { rol?: string; activo?: boolean }) =>
    comenzar(async () => {
      setError(null);
      try {
        await modificarUsuario({ perfilId: u.id, ...cambio });
        router.refresh();
      } catch (e) {
        setError(mensajeDeError(e, "No se pudo guardar"));
      }
    });

  return (
    <tr className={`border-b border-borde/60 ${u.activo ? "" : "opacity-50"}`}>
      <td className="px-4 py-2.5">
        <span className="font-medium">{u.usuario ?? "—"}</span>
        {u.empresaNombre && (
          <span className="block text-[11px] text-texto-3">{u.empresaNombre}</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        {u.nombre}
        {esUnoMismo && <span className="ml-1 text-[11px] text-celeste">(vos)</span>}
      </td>
      <td className="px-4 py-2.5">
        <select
          value={u.rol}
          disabled={pendiente || u.rol === "empresa"}
          onChange={(e) => guardar({ rol: e.target.value })}
          className="rounded-lg border border-borde-2 bg-panel-2 px-2 py-1.5 text-xs disabled:opacity-60"
          title={
            u.rol === "empresa"
              ? "El usuario de una contratista se administra en Órdenes → Empresas"
              : "Cambiar el rol"
          }
        >
          {u.rol === "empresa" && <option value="empresa">Empresa contratista</option>}
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {etiquetaRol[r] ?? r}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-2.5">
        {u.activo ? (
          u.claveTemporal ? (
            <span
              className="rounded bg-amarillo/15 px-2 py-1 text-[11px] font-bold text-amarillo"
              title="Todavía no cambió la clave que se le entregó"
            >
              Clave temporal
            </span>
          ) : (
            <span className="text-[11px] font-semibold" style={{ color: "var(--color-hecho)" }}>
              Activo
            </span>
          )
        ) : (
          <span className="text-[11px] font-semibold text-texto-3">Dado de baja</span>
        )}
      </td>
      <td className="num px-4 py-2.5 text-[12px] text-texto-2">
        {u.ultimoIngreso ? fechaCorta(u.ultimoIngreso) : "nunca entró"}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {accionClave}
          <button
            type="button"
            disabled={pendiente || esUnoMismo}
            onClick={() => {
              if (u.activo && !confirm(`¿Dar de baja el acceso de ${u.nombre}?`)) return;
              guardar({ activo: !u.activo });
            }}
            title={esUnoMismo ? "No podés darte de baja a vos mismo" : undefined}
            className={`rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition disabled:opacity-40 ${
              u.activo
                ? "border-borde-2 text-texto-2 hover:border-peligro/50 hover:text-peligro"
                : "border-borde-2 text-texto-2 hover:border-celeste/60 hover:text-celeste"
            }`}
          >
            {u.activo ? "Dar de baja" : "Reactivar"}
          </button>
        </div>
        {error && <p className="mt-1 text-right text-[11px] text-peligro">{error}</p>}
      </td>
    </tr>
  );
}
