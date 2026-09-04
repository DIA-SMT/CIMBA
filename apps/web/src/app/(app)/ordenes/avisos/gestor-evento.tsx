"use client";

import { Bell, Mail, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { agregarDestinatario, alternarDestinatario, quitarDestinatario } from "@/lib/acciones-avisos";
import { ETIQUETA_ROL, ROLES_PUSH, type Destinatario, type EventoAviso } from "./constantes";

/**
 * La isla de una tarjeta de evento: quién se entera y por dónde. Lista los
 * destinatarios (toggle de activo + quitar con confirmación inline) y agrega
 * nuevos. Si el que mira no gestiona, se ve todo pero no se toca nada.
 */
export function GestorEvento({
  evento,
  destinatarios,
  puedeGestionar,
  emailActivo,
}: {
  evento: EventoAviso;
  destinatarios: Destinatario[];
  puedeGestionar: boolean;
  emailActivo: boolean;
}) {
  return (
    <div>
      <ul className="space-y-1.5">
        {destinatarios.map((d) => (
          <FilaDestinatario key={d.id} destinatario={d} puedeGestionar={puedeGestionar} emailActivo={emailActivo} />
        ))}
        {destinatarios.length === 0 && (
          <li className="rounded-lg border border-dashed border-borde-2 px-3 py-2.5 text-xs text-texto-3">
            Nadie se entera de esto todavía{puedeGestionar ? ": agregá el primer destinatario abajo." : "."}
          </li>
        )}
      </ul>
      {puedeGestionar && <FormAgregar evento={evento} emailActivo={emailActivo} />}
    </div>
  );
}

function FilaDestinatario({
  destinatario: d,
  puedeGestionar,
  emailActivo,
}: {
  destinatario: Destinatario;
  puedeGestionar: boolean;
  emailActivo: boolean;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alternar = () => {
    setError(null);
    startTransition(async () => {
      try {
        await alternarDestinatario({ id: d.id, activo: !d.activo });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo cambiar el estado");
      }
    });
  };

  const quitar = () => {
    setError(null);
    startTransition(async () => {
      try {
        await quitarDestinatario({ id: d.id });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo quitar el destinatario");
      }
    });
  };

  const nombre = d.canal === "push" ? (ETIQUETA_ROL[d.destino] ?? d.destino) : d.destino;

  return (
    <li
      className={`rounded-lg border border-borde bg-panel-2 px-3 py-2 transition ${!d.activo ? "opacity-55" : ""}`}
    >
      <div className="flex items-center gap-2.5">
        {d.canal === "push" ? (
          <Bell size={14} className="shrink-0 text-celeste" aria-label="Push" />
        ) : (
          <Mail size={14} className="shrink-0 text-azul" aria-label="Email" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" title={nombre}>
            {nombre}
          </p>
          <p className="truncate text-[10px] text-texto-3">
            {d.canal === "push"
              ? `push a todo el personal con rol ${d.destino}`
              : (d.etiqueta ?? "email") + (!emailActivo ? " — canal apagado: hoy se saltea" : "")}
          </p>
        </div>

        {puedeGestionar ? (
          <>
            {/* Toggle de activo: apagar no borra, solo silencia */}
            <button
              type="button"
              role="switch"
              aria-checked={d.activo}
              disabled={pendiente}
              onClick={alternar}
              title={d.activo ? "Activo: dejá de avisarle sin quitarlo" : "Silenciado: volver a avisarle"}
              className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-50 ${
                d.activo ? "bg-azul" : "bg-panel-3 border border-borde-2"
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                  d.activo ? "left-4.5" : "left-0.5"
                }`}
              />
            </button>

            {confirmando ? (
              <span className="flex shrink-0 items-center gap-1.5 text-[11px]">
                <button
                  type="button"
                  disabled={pendiente}
                  onClick={quitar}
                  className="rounded-md border border-peligro/50 bg-peligro/10 px-2 py-1 font-semibold text-peligro transition hover:bg-peligro/20 disabled:opacity-50"
                >
                  {pendiente ? "Quitando…" : "Sí, quitar"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmando(false)}
                  className="text-texto-3 hover:text-texto"
                >
                  no
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmando(true)}
                title="Quitar este destinatario"
                className="shrink-0 rounded-md border border-borde-2 p-1.5 text-texto-3 transition hover:border-peligro/50 hover:text-peligro"
              >
                <Trash2 size={13} />
              </button>
            )}
          </>
        ) : (
          <span className={`shrink-0 text-[10px] font-semibold ${d.activo ? "text-ok" : "text-texto-3"}`}>
            {d.activo ? "activo" : "silenciado"}
          </span>
        )}
      </div>
      {error && <p className="mt-1.5 text-[11px] text-peligro">{error}</p>}
    </li>
  );
}

function FormAgregar({ evento, emailActivo }: { evento: EventoAviso; emailActivo: boolean }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [canal, setCanal] = useState<"push" | "email">("push");
  const [rol, setRol] = useState<string>(ROLES_PUSH[0]);
  const [email, setEmail] = useState("");
  const [etiqueta, setEtiqueta] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const agregar = () => {
    setError(null);
    setAviso(null);
    const destino = canal === "push" ? rol : email.trim();
    if (canal === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(destino)) {
      setError("Escribí un email válido (nombre@dominio).");
      return;
    }
    startTransition(async () => {
      try {
        await agregarDestinatario({
          evento,
          canal,
          destino,
          etiqueta: canal === "email" && etiqueta.trim() ? etiqueta.trim() : undefined,
        });
        setEmail("");
        setEtiqueta("");
        if (canal === "email" && !emailActivo) {
          setAviso("Quedó guardado, pero con el canal de email apagado no va a recibir nada por ahora.");
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo agregar el destinatario");
      }
    });
  };

  return (
    <form
      className="mt-3 space-y-2 border-t border-borde pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        agregar();
      }}
    >
      <div className="flex items-center gap-4 text-xs">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="radio"
            name={`canal-${evento}`}
            checked={canal === "push"}
            onChange={() => setCanal("push")}
            className="accent-[var(--color-azul)]"
          />
          <Bell size={12} className="text-celeste" /> Push a un rol
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="radio"
            name={`canal-${evento}`}
            checked={canal === "email"}
            onChange={() => setCanal("email")}
            className="accent-[var(--color-azul)]"
          />
          <Mail size={12} className="text-azul" /> Email
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {canal === "push" ? (
          <select
            value={rol}
            onChange={(e) => setRol(e.target.value)}
            aria-label="Rol que recibe el push"
            className="min-w-0 flex-1 rounded-lg border border-borde-2 bg-panel-2 px-2.5 py-1.5 text-xs"
          >
            {ROLES_PUSH.map((r) => (
              <option key={r} value={r}>
                {ETIQUETA_ROL[r]}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="direccion@smt.gob.ar"
              aria-label="Email destinatario"
              className="min-w-0 flex-1 rounded-lg border border-borde-2 bg-panel-2 px-2.5 py-1.5 text-xs"
            />
            <input
              type="text"
              value={etiqueta}
              onChange={(e) => setEtiqueta(e.target.value)}
              maxLength={100}
              placeholder="Etiqueta (opcional), ej.: Secretaría de Obras"
              aria-label="Etiqueta amigable del destinatario"
              className="min-w-0 flex-1 rounded-lg border border-borde-2 bg-panel-2 px-2.5 py-1.5 text-xs"
            />
          </>
        )}
        <button
          type="submit"
          disabled={pendiente}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-azul px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          <Plus size={13} /> {pendiente ? "Agregando…" : "Agregar"}
        </button>
      </div>

      {error && <p className="text-[11px] text-peligro">{error}</p>}
      {aviso && <p className="text-[11px] text-amarillo">{aviso}</p>}
    </form>
  );
}
