"use client";

import { BellRing, X } from "lucide-react";
import { useEffect, useState } from "react";
import { suscribirPush } from "@/lib/acciones-push";
import { Panel } from "@/components/ui";

/**
 * "ACTIVÁ LOS AVISOS" — la tarjeta que insiste hasta que la empresa los tenga.
 *
 * En toda la base no había ni una suscripción push de una contratista. No
 * porque no quisieran: la campana vivía en el encabezado del personal
 * municipal, que la empresa nunca ve, y el único ofrecimiento era el cartel
 * de instalar la app, que aparece una vez y se cierra.
 *
 * Para una empresa el aviso no es una comodidad: es enterarse en el teléfono
 * de que le emitieron una orden, de que se le vence hoy, de que le validaron
 * o rechazaron un bache. Por eso esta tarjeta vuelve en cada visita mientras
 * no estén activos —se puede cerrar por hoy, no para siempre— y desaparece
 * sola cuando el teléfono quedó suscripto.
 *
 * "Sin soporte" (iPhone sin instalar, navegador viejo) no muestra nada:
 * pedir algo que el teléfono no puede hacer es ruido.
 */

type Estado = "cargando" | "sin_soporte" | "bloqueado" | "sin_activar" | "activo";

const CERRADA_HOY = "cimba-avisos-empresa-cerrada";

export function TarjetaAvisos() {
  const [estado, setEstado] = useState<Estado>("cargando");
  const [oculta, setOculta] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const clavePublica = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    try {
      // Cerrada HOY: vuelve mañana. Es lo bastante insistente para que se
      // active alguna vez, y lo bastante educado para no tapar la lista.
      if (sessionStorage.getItem(CERRADA_HOY) === new Date().toISOString().slice(0, 10)) {
        setOculta(true);
      }
    } catch {
      /* sin storage: se muestra */
    }
    void (async () => {
      if (!clavePublica || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setEstado("sin_soporte");
        return;
      }
      if (Notification.permission === "denied") {
        setEstado("bloqueado");
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setEstado(sub ? "activo" : "sin_activar");
    })();
  }, [clavePublica]);

  const activar = async () => {
    setTrabajando(true);
    setMensaje(null);
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") {
        setEstado("bloqueado");
        setMensaje("El teléfono no dio permiso. Se puede habilitar desde la configuración del navegador.");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: clavePublica,
      });
      await suscribirPush(sub.toJSON(), navigator.userAgent.slice(0, 250));
      setEstado("activo");
    } catch {
      setMensaje("No se pudo activar. Probá de nuevo con señal.");
    } finally {
      setTrabajando(false);
    }
  };

  const cerrarPorHoy = () => {
    setOculta(true);
    try {
      sessionStorage.setItem(CERRADA_HOY, new Date().toISOString().slice(0, 10));
    } catch {
      /* ídem */
    }
  };

  if (estado === "cargando" || estado === "sin_soporte" || estado === "activo" || oculta) return null;

  return (
    <Panel className="relative mb-4 border-celeste/40 bg-celeste/5 p-4">
      <button
        type="button"
        onClick={cerrarPorHoy}
        aria-label="Cerrar por hoy"
        className="absolute top-2 right-2 rounded-lg p-1.5 text-texto-3 transition hover:text-texto"
      >
        <X size={15} />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <BellRing size={22} className="mt-0.5 shrink-0 text-celeste" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Activá los avisos en este teléfono</p>
          <p className="mt-0.5 text-[12px] leading-snug text-texto-2">
            Te llega cuando les emiten una orden, cuando se vence, y cuando Bacheo valida o rechaza un
            bache que propusieron. Sin entrar a mirar.
          </p>
          {estado === "bloqueado" ? (
            <p className="mt-2 text-[12px] font-semibold text-amarillo">
              El navegador tiene los avisos bloqueados para CIMBA. Se habilitan desde el candado de la
              barra de direcciones (o en Ajustes → Notificaciones del teléfono).
            </p>
          ) : (
            <button
              type="button"
              onClick={() => void activar()}
              disabled={trabajando}
              className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-azul px-4 text-sm font-bold text-white transition active:scale-[0.99] disabled:opacity-60"
            >
              <BellRing size={16} />
              {trabajando ? "Activando…" : "Activar avisos"}
            </button>
          )}
          {mensaje && <p className="mt-2 text-[12px] text-texto-2">{mensaje}</p>}
        </div>
      </div>
    </Panel>
  );
}
