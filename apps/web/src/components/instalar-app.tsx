"use client";

import { BellRing, Download, Share, X } from "lucide-react";
import { useEffect, useState } from "react";
import { suscribirPush } from "@/lib/acciones-push";

/**
 * EL OFRECIMIENTO DE INSTALAR Y DE ACTIVAR LOS AVISOS.
 *
 * Las dos cosas ya existían pero había que ir a buscarlas: la campana de push
 * estaba en el encabezado, chica, y la instalación no la ofrecía nadie —el
 * navegador guarda el gesto y no lo muestra por su cuenta—. Resultado: nadie
 * tenía la app en el teléfono y nadie recibía el aviso de una orden vencida.
 *
 * Aparece una vez, abajo, sin tapar nada, y con dos botones. Si se descarta,
 * no vuelve a aparecer en ese dispositivo. No insiste: un cartel que vuelve
 * cada vez se aprende a ignorar en dos días.
 */

const DESCARTADO = "cimba-instalar-descartado";
/** Cuánto esperar antes de ofrecer: primero que la pantalla cargue y se use. */
const ESPERA_MS = 6_000;

/** El evento de Chrome/Edge. No está en las tipificaciones estándar. */
interface EventoInstalacion extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstalarApp() {
  const [evento, setEvento] = useState<EventoInstalacion | null>(null);
  const [visible, setVisible] = useState(false);
  const [esIOS, setEsIOS] = useState(false);
  const [puedeAvisos, setPuedeAvisos] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    /**
     * El service worker se registra SIEMPRE, no recién cuando alguien toca la
     * campana. Sin registro no hay push que llegue ni caché de los GeoJSON, y
     * hasta ahora el registro vivía adentro del botón de suscribirse: quien no
     * lo tocaba nunca, no tenía service worker.
     */
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    let descartado = false;
    try {
      descartado = localStorage.getItem(DESCARTADO) === "1";
    } catch {
      /* modo privado: se ofrece igual, no es información sensible */
    }
    if (descartado) return;

    // Ya instalada: la app corre en su propia ventana, no hay nada que ofrecer.
    const instalada =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;

    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setEsIOS(ios);

    const avisosPosibles =
      "Notification" in window &&
      "PushManager" in window &&
      Notification.permission === "default" &&
      Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
    setPuedeAvisos(avisosPosibles);

    const alPoderInstalar = (e: Event) => {
      // Sin esto Chrome muestra su propia barra, que en el escritorio es un
      // ícono minúsculo en la barra de direcciones que nadie ve.
      e.preventDefault();
      setEvento(e as EventoInstalacion);
      if (!instalada) setTimeout(() => setVisible(true), ESPERA_MS);
    };
    window.addEventListener("beforeinstallprompt", alPoderInstalar);

    /**
     * iOS no dispara beforeinstallprompt: Safari solo instala desde Compartir →
     * Agregar a inicio. Ahí el cartel explica el gesto en vez de ofrecer un
     * botón que no podría hacer nada.
     */
    if ((ios && !instalada) || (instalada && avisosPosibles)) {
      setTimeout(() => setVisible(true), ESPERA_MS);
    }

    return () => window.removeEventListener("beforeinstallprompt", alPoderInstalar);
  }, []);

  const cerrar = () => {
    setVisible(false);
    try {
      localStorage.setItem(DESCARTADO, "1");
    } catch {
      /* sin storage: vuelve a ofrecerse la próxima vez, mal menor */
    }
  };

  const instalar = async () => {
    if (!evento) return;
    await evento.prompt();
    const { outcome } = await evento.userChoice;
    setEvento(null);
    if (outcome === "accepted") cerrar();
  };

  const activarAvisos = async () => {
    setMensaje("Pidiendo permiso…");
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") {
        setMensaje("Quedaron desactivadas. Se pueden activar después desde la campana.");
        setPuedeAvisos(false);
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
      });
      await suscribirPush(sub.toJSON(), navigator.userAgent.slice(0, 250));
      setMensaje("Avisos activados en este dispositivo ✓");
      setPuedeAvisos(false);
    } catch {
      setMensaje("No se pudo activar. Probá desde la campana del encabezado.");
    }
  };

  if (!visible) return null;
  const puedeInstalar = Boolean(evento) || esIOS;
  if (!puedeInstalar && !puedeAvisos) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-[60] mx-auto max-w-md print:hidden">
      <div className="panel-vidrio relative rounded-2xl border border-celeste/40 p-4 shadow-xl">
        <button
          onClick={cerrar}
          aria-label="No mostrar más"
          className="absolute top-2 right-2 rounded-lg p-1.5 text-texto-3 transition hover:text-texto"
        >
          <X size={15} />
        </button>
        <p className="pr-6 text-sm font-bold">Tené CIMBA a mano</p>
        <p className="mt-1 text-[12px] leading-snug text-texto-2">
          {puedeInstalar
            ? "Instalada abre sin barra del navegador y queda con su ícono en la pantalla de inicio."
            : "Activá los avisos y te llega cuando una orden vence o se te asigna trabajo."}
        </p>

        {esIOS && !evento && (
          <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-panel-3 px-3 py-2 text-[12px] text-texto-2">
            Tocá <Share size={14} className="shrink-0 text-celeste" /> y después{" "}
            <b className="text-texto">Agregar a inicio</b>.
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {evento && (
            <button
              onClick={() => void instalar()}
              className="flex items-center gap-1.5 rounded-lg bg-azul px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
            >
              <Download size={15} /> Instalar la app
            </button>
          )}
          {puedeAvisos && (
            <button
              onClick={() => void activarAvisos()}
              className="flex items-center gap-1.5 rounded-lg border border-celeste/50 px-4 py-2.5 text-sm font-semibold text-celeste transition hover:bg-celeste/10"
            >
              <BellRing size={15} /> Activar avisos
            </button>
          )}
          <button onClick={cerrar} className="px-2 text-sm text-texto-3 transition hover:text-texto">
            Ahora no
          </button>
        </div>

        {mensaje && <p className="mt-2 text-[11px] text-texto-2">{mensaje}</p>}
      </div>
    </div>
  );
}
