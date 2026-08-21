"use client";

import { Bell, BellOff, BellRing } from "lucide-react";
import { useEffect, useState } from "react";
import { desuscribirPush, probarPush, suscribirPush } from "@/lib/acciones-push";

type Estado = "no_soportado" | "sin_permiso" | "desuscripto" | "suscripto" | "trabajando";

/**
 * Campana de notificaciones push en el encabezado: suscribe este navegador
 * (VAPID), permite darse de baja y mandar una prueba. Requiere HTTPS o localhost.
 */
export function BotonPush() {
  const [estado, setEstado] = useState<Estado>("trabajando");
  const [menu, setMenu] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const clavePublica = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    void (async () => {
      if (!clavePublica || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        setEstado("no_soportado");
        return;
      }
      if (Notification.permission === "denied") {
        setEstado("sin_permiso");
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setEstado(sub ? "suscripto" : "desuscripto");
    })();
  }, [clavePublica]);

  const suscribir = async () => {
    setEstado("trabajando");
    setAviso(null);
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") {
        setEstado("sin_permiso");
        setAviso("El navegador bloqueó las notificaciones. Habilitalas desde el candado de la barra de direcciones.");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: clavePublica,
      });
      await suscribirPush(sub.toJSON(), navigator.userAgent.slice(0, 250));
      setEstado("suscripto");
      setAviso("Notificaciones activadas en este dispositivo ✓");
    } catch {
      setEstado("desuscripto");
      setAviso("No se pudo suscribir. Probá de nuevo.");
    }
  };

  const desuscribir = async () => {
    setEstado("trabajando");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await desuscribirPush({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setEstado("desuscripto");
      setAviso("Notificaciones desactivadas en este dispositivo.");
    } catch {
      setEstado("suscripto");
    }
  };

  const probar = async () => {
    setAviso("Enviando prueba…");
    try {
      const r = await probarPush();
      setAviso(r.enviadas > 0 ? "Prueba enviada: mirá la notificación ✓" : "No llegó a ningún dispositivo (¿suscripción caducada?).");
    } catch {
      setAviso("La prueba falló.");
    }
  };

  if (estado === "no_soportado") return null;

  return (
    <div className="relative">
      <button
        onClick={() => setMenu((m) => !m)}
        title={
          estado === "suscripto"
            ? "Notificaciones activadas — clic para opciones"
            : "Activar notificaciones push de bacheo en este dispositivo"
        }
        className={`rounded-lg border p-2 transition ${
          estado === "suscripto"
            ? "border-celeste/50 text-celeste"
            : "border-borde-2 text-texto-2 hover:border-celeste/50 hover:text-celeste"
        }`}
      >
        {estado === "suscripto" ? <BellRing size={15} /> : estado === "sin_permiso" ? <BellOff size={15} /> : <Bell size={15} />}
      </button>

      {menu && (
        <div className="panel-vidrio absolute top-11 right-0 z-50 w-64 rounded-xl p-3">
          <p className="mb-2 text-xs font-bold">Notificaciones push</p>
          {estado !== "suscripto" ? (
            <button
              onClick={() => void suscribir()}
              disabled={estado === "trabajando"}
              className="w-full rounded-lg bg-azul px-3 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
            >
              Activar en este dispositivo
            </button>
          ) : (
            <div className="space-y-1.5">
              <button
                onClick={() => void probar()}
                className="w-full rounded-lg border border-celeste/50 bg-celeste/10 px-3 py-2 text-xs font-semibold text-celeste transition hover:bg-celeste/20"
              >
                Enviar prueba
              </button>
              <button
                onClick={() => void desuscribir()}
                className="w-full rounded-lg border border-borde-2 px-3 py-2 text-xs text-texto-2 transition hover:border-peligro/50 hover:text-peligro"
              >
                Desactivar
              </button>
            </div>
          )}
          <p className="mt-2 text-[10px] leading-snug text-texto-3">
            {aviso ?? "Avisa cuando se te asigna trabajo (cuadrillas) y otras novedades del sistema."}
          </p>
        </div>
      )}
    </div>
  );
}
