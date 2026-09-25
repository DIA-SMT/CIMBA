import { Bot } from "grammy";
import { createLogger, installShutdownHandlers, onShutdown, requireEnv } from "@bots/core";
import { preguntarACimba, type ConfigCimba } from "./cimba.ts";
import { limpiar, olvidar, recordar } from "./conversacion.ts";
import { aHtml, aPlano } from "./formato.ts";
import { partirTexto } from "./partir.ts";
import { avisoDeCierre, cerrar as cerrarOrden, leerToqueOrden, reasignar as reasignarOrden, verOrden } from "./ordenes.ts";
import {
  contarResultado,
  describir,
  describirPendientes,
  leerToque,
  MOTIVOS,
  quePasaSiValida,
  resolver,
  verPendientes,
  verPropuesto,
} from "./propuestos.ts";

/**
 * El canal de Telegram de CIMBA.
 *
 * Este proceso no razona y no sabe nada del bacheo: recibe lo que se escribe,
 * se lo manda a CIMBA y devuelve la respuesta. Toda la inteligencia y TODOS los
 * permisos están del otro lado — el bot no tiene acceso a la base ni sabe quién
 * es quien le escribe. Si el chat no está vinculado, CIMBA contesta que no y el
 * bot repite ese texto.
 *
 * El camino de ida (los avisos que CIMBA manda solo) no pasa por acá: eso lo
 * hace CIMBA directo contra la API de Telegram. Este proceso es solo la vuelta.
 */

const log = createLogger("main");

/** Una consulta por vez y por chat: la de atrás espera o se avisa. */
const enVuelo = new Set<number>();

/**
 * Manda la respuesta con formato, y si Telegram la rechaza la manda en plano.
 *
 * El modelo escribe Markdown; Telegram lo entiende solo si se lo traduce. La
 * traducción es conservadora, pero un mensaje largo se parte en varios y un
 * corte podría quedar con una etiqueta abierta. En ese caso Telegram devuelve
 * 400 y descarta el mensaje ENTERO: el reintento en plano es lo que garantiza
 * que la respuesta llegue igual. Perder una negrita es aceptable; perder la
 * respuesta a la pregunta que alguien hizo desde la calle, no.
 */
async function responderConFormato(
  ctx: { reply: (t: string, o?: Record<string, unknown>) => Promise<unknown> },
  texto: string,
): Promise<void> {
  try {
    await ctx.reply(aHtml(texto), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  } catch (e) {
    log.warn({ err: e instanceof Error ? e.message : String(e) }, "HTML rechazado, va en plano");
    await ctx
      .reply(aPlano(texto), { link_preview_options: { is_disabled: true } })
      .catch(() => undefined);
  }
}

const BIENVENIDA =
  "Soy CIMBA. Preguntame por el estado del bacheo: cómo viene un barrio, qué " +
  "órdenes están vencidas, cuánto lleva ejecutado una empresa, cómo está la " +
  "brecha. Contesto con lo que vos podés ver en el sistema.\n\n" +
  "Y con /pendientes te muestro todo lo que espera una decisión tuya, para " +
  "resolverlo acá mismo.";

async function main(): Promise<void> {
  // Todo junto y al arrancar: descubrir que falta una variable cuando alguien
  // ya está esperando una respuesta es peor que no arrancar.
  const env = requireEnv(["TELEGRAM_BOT_TOKEN", "CIMBA_URL", "CIMBA_BOT_SECRET"]);

  const config: ConfigCimba = {
    baseUrl: env.CIMBA_URL.replace(/\/+$/, ""),
    secreto: env.CIMBA_BOT_SECRET,
  };

  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  bot.command("start", async (ctx) => {
    olvidar(ctx.chat.id);
    await ctx.reply(BIENVENIDA);
  });

  bot.command("nuevo", async (ctx) => {
    olvidar(ctx.chat.id);
    await ctx.reply("Listo, arrancamos de cero.");
  });

  /**
   * La bandeja: todo lo que espera una decisión, con el botón puesto.
   *
   * Es la diferencia entre un buscador y una lista de trabajo. Preguntar exige
   * acordarse de preguntar; esto se abre del menú y ya está todo junto.
   *
   * El resumen va en un mensaje y cada bache propuesto en el suyo, porque cada
   * uno lleva sus propios botones y Telegram los cuelga del mensaje, no de la
   * conversación.
   */
  /** Las tarjetas de los propuestos, cada una con sus botones. */
  const mostrarPropuestos = async (
    ctx: { reply: (t: string, o?: Record<string, unknown>) => Promise<unknown> },
    chatId: number,
  ) => {
    const r = await verPendientes(config, chatId);
    if (!r.ok) return;
    for (const p of r.datos.propuestos) {
      await ctx.reply(`${describir(p)}\n\n${quePasaSiValida(p)}`, {
        link_preview_options: { is_disabled: true },
        reply_markup: {
          inline_keyboard: [
            [{ text: "✓ Validar", callback_data: `p:${p.itemId}:v` }],
            [{ text: "✗ Rechazar", callback_data: `p:${p.itemId}:r` }],
          ],
        },
      });
    }
  };

  /** Las órdenes vencidas, cada una con qué se puede hacer con ella. */
  const mostrarVencidas = async (
    ctx: { reply: (t: string, o?: Record<string, unknown>) => Promise<unknown> },
    vencidas: Array<{ ordenId?: number; numero: string; empresa: string; vence: string; itemsPendientes: number }>,
  ) => {
    for (const o of vencidas) {
      if (o.ordenId == null) continue;
      await ctx.reply(
        `${o.numero} — ${o.empresa}\nVenció el ${o.vence} · ${o.itemsPendientes} sin reportar`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Cerrar la orden", callback_data: `o:${o.ordenId}:c` }],
              [{ text: "Pasarla a otra empresa", callback_data: `o:${o.ordenId}:r` }],
            ],
          },
        },
      );
    }
  };

  bot.command("pendientes", async (ctx) => {
    const chatId = ctx.chat.id;
    await ctx.replyWithChatAction("typing").catch(() => undefined);
    const r = await verPendientes(config, chatId);
    if (!r.ok) return void (await ctx.reply(r.texto));
    await responderConFormato(ctx, describirPendientes(r.datos));
    await mostrarPropuestos(ctx, chatId);
    await mostrarVencidas(ctx, r.datos.ordenesVencidas);
  });

  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const texto = ctx.message.text.trim();
    if (texto === "" || texto.startsWith("/")) return;

    if (enVuelo.has(chatId)) {
      await ctx.reply("Estoy con tu consulta anterior. Dame un segundo y te contesto.");
      return;
    }

    const ahora = Date.now();
    limpiar(ahora);
    enVuelo.add(chatId);
    try {
      // El reloj de "escribiendo" dura pocos segundos y la consulta puede
      // tardar bastante más, así que se renueva mientras se espera.
      await ctx.replyWithChatAction("typing").catch(() => undefined);
      const latido = setInterval(() => {
        void ctx.replyWithChatAction("typing").catch(() => undefined);
      }, 5000);

      const historial = recordar(chatId, { rol: "usuario", contenido: texto.slice(0, 4000) }, ahora);
      const r = await preguntarACimba(config, chatId, historial).finally(() => clearInterval(latido));

      if (r.ok) {
        recordar(chatId, { rol: "migue", contenido: r.texto }, Date.now());
      } else {
        // Una respuesta fallida no queda en el hilo: si no, la próxima pregunta
        // arrastra el error como si Migue lo hubiera dicho.
        log.warn({ chatId, reintentable: r.reintentable }, r.texto);
      }

      for (const parte of partirTexto(r.texto)) {
        await responderConFormato(ctx, parte);
      }

      /* Si la pregunta terminó siendo "¿qué tengo pendiente?" —lo decide el
         asistente, no una lista de frases de este lado—, después del texto van
         las tarjetas con sus botones. El asistente cuenta qué hay; el canal
         pone con qué resolverlo. */
      if (r.ok && r.herramientas.includes("pendientes")) {
        const p = await verPendientes(config, chatId);
        if (p.ok) {
          await mostrarPropuestos(ctx, chatId);
          await mostrarVencidas(ctx, p.datos.ordenesVencidas);
        }
      }
    } catch (e) {
      // Nunca dejar a la persona sin respuesta: es la convención de la casa.
      log.error({ chatId, err: e instanceof Error ? e.message : String(e) }, "falló al atender");
      await ctx
        .reply("Tuve un problema para procesar tu mensaje. Probá de nuevo en un momento.")
        .catch(() => undefined);
    } finally {
      enVuelo.delete(chatId);
    }
  });

  // Todo lo que no sea texto: se avisa en vez de ignorar en silencio.
  bot.on("message", async (ctx) => {
    if ("text" in ctx.message) return;
    await ctx.reply("Por ahora entiendo solo texto. Escribime la consulta.");
  });

  /**
   * Los botones del aviso de bache propuesto.
   *
   * El mensaje lo mandó CIMBA, no este proceso — pero el toque llega acá,
   * porque es el mismo bot. Se contesta PRIMERO el callback para cortarle el
   * relojito a Telegram, y recién después se trabaja.
   *
   * Validar tiene dos significados y el bot no los mezcla: si el bache ya viene
   * medido, validarlo habilita una certificación y no se deshace, así que pide
   * una segunda confirmación. Si no, un solo toque.
   */
  bot.on("callback_query:data", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => undefined);
    const chatId = ctx.chat?.id;
    if (chatId == null) return;
    const responder = (texto: string) => ctx.reply(texto).catch(() => undefined);

    /* Las órdenes: cerrar pide confirmación siempre —una orden cerrada no se
       reabre— y reasignar necesita además a quién, así que son dos toques. */
    const toqueOrden = leerToqueOrden(ctx.callbackQuery.data);
    if (toqueOrden) {
      try {
        if (toqueOrden.accion === "x") {
          await quitarBotones(ctx);
          return void (await responder("Listo, no hice nada."));
        }

        if (toqueOrden.accion === "c") {
          const visto = await verOrden(config, chatId, toqueOrden.ordenId);
          if (!visto.ok) return void (await responder(visto.texto));
          await quitarBotones(ctx);
          await ctx.reply(avisoDeCierre(visto.datos.orden), {
            reply_markup: {
              inline_keyboard: [
                [{ text: "Sí, cerrarla", callback_data: `o:${toqueOrden.ordenId}:C` }],
                [{ text: "No, dejala abierta", callback_data: `o:${toqueOrden.ordenId}:x` }],
              ],
            },
          });
          return;
        }

        if (toqueOrden.accion === "C") {
          await quitarBotones(ctx);
          const r = await cerrarOrden(config, chatId, toqueOrden.ordenId);
          return void (await responder(
            r.ok
              ? `✓ Orden cerrada${r.datos.pendientes ? `, con ${r.datos.pendientes} item(s) sin reportar` : ""}.`
              : r.texto,
          ));
        }

        if (toqueOrden.accion === "r") {
          const visto = await verOrden(config, chatId, toqueOrden.ordenId);
          if (!visto.ok) return void (await responder(visto.texto));
          const o = visto.datos.orden;
          if (o.empresasPosibles.length === 0) {
            await quitarBotones(ctx);
            return void (await responder(
              "No hay otra empresa habilitada para este tipo de orden. Habría que verlo desde CIMBA.",
            ));
          }
          await quitarBotones(ctx);
          await ctx.reply(`${o.numero} está en ${o.empresa}. ¿A quién se la pasás?`, {
            reply_markup: {
              inline_keyboard: [
                ...o.empresasPosibles.map((e) => [
                  { text: e.nombre, callback_data: `o:${o.ordenId}:a:${e.id}` },
                ]),
                [{ text: "Mejor no", callback_data: `o:${o.ordenId}:x` }],
              ],
            },
          });
          return;
        }

        if (toqueOrden.accion === "a" && toqueOrden.empresaId != null) {
          await quitarBotones(ctx);
          const r = await reasignarOrden(config, chatId, toqueOrden.ordenId, toqueOrden.empresaId);
          return void (await responder(
            r.ok
              ? `✓ ${r.datos.numero} pasó de ${r.datos.de} a ${r.datos.a}. Cambian de manos ${r.datos.pendientes} item(s), y ya le avisamos.`
              : r.texto,
          ));
        }
      } catch (e) {
        log.error({ chatId, err: e instanceof Error ? e.message : String(e) }, "falló un botón de orden");
        await responder("Tuve un problema con ese botón. Probá desde la pantalla de CIMBA.");
      }
      return;
    }

    const toque = leerToque(ctx.callbackQuery.data);
    if (!toque) return;

    try {
      if (toque.accion === "x") {
        await quitarBotones(ctx);
        await responder("Listo, no hice nada.");
        return;
      }

      // Validar: primero se mira qué es, después se decide si alcanza un toque.
      if (toque.accion === "v") {
        const visto = await verPropuesto(config, chatId, toque.itemId);
        if (!visto.ok) return void (await responder(visto.texto));
        const p = visto.datos.propuesto;
        if (!p.habilitaCertificacion) {
          await quitarBotones(ctx);
          return void (await ejecutar(ctx, chatId, toque.itemId, "validar"));
        }
        await quitarBotones(ctx);
        await ctx.reply(`${describir(p)}\n\n${quePasaSiValida(p)}`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Sí, validar y certificar", callback_data: `p:${toque.itemId}:V` }],
              [{ text: "No, dejalo así", callback_data: `p:${toque.itemId}:x` }],
            ],
          },
        });
        return;
      }

      if (toque.accion === "V") {
        await quitarBotones(ctx);
        return void (await ejecutar(ctx, chatId, toque.itemId, "validar"));
      }

      // Rechazar: se pregunta el motivo, porque le llega a la empresa.
      if (toque.accion === "r") {
        await quitarBotones(ctx);
        await ctx.reply("¿Por qué lo rechazás? Lo que elijas le llega a la empresa.", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "No corresponde a esta orden", callback_data: `p:${toque.itemId}:r1` }],
              [{ text: "Ya estaba reparado", callback_data: `p:${toque.itemId}:r2` }],
              [{ text: "Rechazar sin motivo", callback_data: `p:${toque.itemId}:r0` }],
              [{ text: "Mejor no", callback_data: `p:${toque.itemId}:x` }],
            ],
          },
        });
        return;
      }

      if (toque.accion.startsWith("r")) {
        await quitarBotones(ctx);
        return void (await ejecutar(ctx, chatId, toque.itemId, "rechazar", MOTIVOS[toque.accion]));
      }
    } catch (e) {
      log.error({ chatId, err: e instanceof Error ? e.message : String(e) }, "falló un botón");
      await responder("Tuve un problema con ese botón. Probá desde la pantalla de CIMBA.");
    }
  });

  /** Saca los botones del mensaje ya tocado: que no se pueda tocar dos veces. */
  const quitarBotones = async (ctx: { editMessageReplyMarkup: (o?: unknown) => Promise<unknown> }) => {
    await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
  };

  const ejecutar = async (
    ctx: { reply: (t: string) => Promise<unknown> },
    chatId: number,
    itemId: number,
    decision: "validar" | "rechazar",
    motivo?: string,
  ) => {
    const r = await resolver(config, chatId, itemId, decision, motivo);
    await ctx.reply(r.ok ? contarResultado(r.datos.resultado, r.datos.direccion) : r.texto);
  };

  bot.catch((err) => {
    log.error({ err: err.message }, "error del transporte de Telegram");
  });

  /* El menú ☰ de Telegram. Es lo que hace que la bandeja exista para quien la
     usa: un comando que hay que recordar es un comando que no se usa. Se manda
     en cada arranque —es idempotente— y si falla no frena nada: el bot anda
     igual, solo que sin el menú. */
  await bot.api
    .setMyCommands([
      { command: "pendientes", description: "Lo que espera una decisión tuya" },
      { command: "nuevo", description: "Empezar una conversación de cero" },
    ])
    .catch((e: unknown) => log.warn({ err: e instanceof Error ? e.message : String(e) }, "no pude poner el menú"));

  // Primero se registra cómo cerrar, después se abre: si se abriera antes, un
  // fallo entre las dos líneas dejaría el polling vivo sin forma de detenerlo.
  onShutdown("telegram", () => bot.stop());
  installShutdownHandlers();

  await bot.start({
    drop_pending_updates: true,
    onStart: (info) => log.info({ usuario: `@${info.username}`, cimba: config.baseUrl }, "escuchando"),
  });
}

main().catch((error) => {
  log.fatal({ err: error instanceof Error ? error.message : String(error) }, "falló el arranque");
  process.exit(1);
});
