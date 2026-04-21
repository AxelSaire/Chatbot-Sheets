const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
const P = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const { generarCodigo, obtenerFecha, procesarMoneda } = require('./utils');
const { guardarRegistro, verificarPendiente, actualizarPago } = require('./sheets');
const { getResumen } = require('./sheets');
const { eliminarUltimoRegistro } = require('./sheets');

async function startBot() {
 const { state, saveCreds } = await useMultiFileAuthState('auth');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: 'silent' }),
    printQRInTerminal: false,
    // ✅ Evita caídas por inactividad
    keepAliveIntervalMs: 30_000,
    // ✅ Evita desconexión por timeout
    connectTimeoutMs: 60_000,
    // ✅ No guardar todos los mensajes en memoria
    getMessage: async () => undefined,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('📲 Escanea este QR:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      console.log('✅ Bot conectado');
      intentos = 0; // ✅ reset al conectar exitosamente
    }

    if (connection === 'close') {
      const codigo = lastDisconnect?.error?.output?.statusCode;
      const fueLogout = codigo === DisconnectReason.loggedOut;

      console.log(`❌ Desconectado — código: ${codigo}`);

      if (fueLogout) {
        console.log('⚠️ Sesión cerrada. Elimina la carpeta "auth" y reinicia.');
        process.exit(1); // ✅ sale limpio para que el proceso manager reinicie
        return;
      }

      if (intentos >= MAX_INTENTOS) {
        console.log(`🛑 ${MAX_INTENTOS} intentos fallidos. Reiniciando proceso...`);
        process.exit(1);
        return;
      }

      // ✅ Reconexión con backoff exponencial
      const espera = Math.min(1000 * 2 ** intentos, 30_000);
      intentos++;
      console.log(`🔄 Reintento ${intentos}/${MAX_INTENTOS} en ${espera / 1000}s...`);
      setTimeout(startBot, espera);
    }
  });
  
  // ✅ HANDLER DE MENSAJES — ahora dentro de startBot() con acceso a sock
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      // Ignorar mensajes propios o de estado
      console.log('este es el JID:', msg.key.remoteJid);
      if (msg.key.remoteJid === 'status@broadcast') return;

      const jid = msg.key.remoteJid;

      // Extraer texto del mensaje (texto simple o extended)
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        '';

      if (!text) return;

      // Comandos con "/"
    //   if (text.startsWith('/')) {
    //     // Aquí puedes agregar tus comandos
    //     // Ejemplo: if (text === '/ayuda') { ... }
    //     return;
    //   }
    if (text.toLowerCase() === '/eliminarultimo') {

    const eliminado = await eliminarUltimoRegistro();

    if (eliminado.error) {
      await sock.sendMessage(jid, {
        text: '⚠️ No hay registros para eliminar'
      }, { quoted: msg });
      continue;
    }

    await sock.sendMessage(
      jid,
      {
        text: `*Eliminado correctamente*

    ✅ CODIGO: *${eliminado.CODIGO}*
    👤 ${eliminado.NOMBRE}`
      },
      { quoted: msg }
    );

    continue;
    }
     if (text.toLowerCase().startsWith('/resumen')) {
        const input = text.split(' ')[1]?.trim().toLowerCase();

        let tipo;

        if (input === 'hoy') {
            tipo = 'hoy';
        } else if (input === 'mes') {
            tipo = 'mes';
        } else if (input === 'año' || input === 'year') {
            tipo = 'año';
        } else {
            await sock.sendMessage(jid, {
            text: '⚠️ Uso correcto:\n/resumen hoy\n/resumen mes\n/resumen año'
            }, { quoted: msg });
            return;
        }

        const r = await getResumen(tipo);

        const periodo =
            tipo === 'hoy' ? 'Hoy' :
            tipo === 'mes' ? 'Este mes' :
            'Este año';

        await sock.sendMessage(jid, {
            text:
            `📊 *REPORTE — ${periodo}*\n\n` +
            `📦 Operaciones: *${r.cantidad}*\n` +
            `📅 Días activos: *${r.diasActivos}*\n` +
            `💵 Total USD: *$${r.totalUSD.toFixed(2)}*\n` +
            `💰 Total Soles: *S/. ${r.totalPEN.toFixed(2)}*\n` +
            `📈 Promedio diario USD: *$ ${r.promedioUSD}*`
        }, { quoted: msg });

        return;
    }

      // -- Registro sin comando
      const partes = text.split(',').map(p => p.trim());

      if (partes.length < 3) return;

      const nombre = partes[0].toUpperCase();
      const equipo = partes[1].toUpperCase();
      const precioRaw = partes[2];

      const { usd, soles } = procesarMoneda(precioRaw);

      let descripcion = partes[3]
      ? partes.slice(3).join(', ').toUpperCase()
      : (
          soles !== '-' 
            ? 'EMISIONES' // --SOLES siempre
            : (parseInt(String(usd).replace(/[^\d]/g, '')) <= 350
                ? 'EMISIONES'
                : 'CONFIGURACION')
        );
      // 🔥 Warning de pagos pendientes
      const pendientes = await verificarPendiente(nombre);

      if (pendientes > 0) {
        await sock.sendMessage(jid, {
          text: `⚠️ ${nombre} tiene ${pendientes} pendiente(s)`,
        });
      }

      const CODIGO = generarCodigo();

      await guardarRegistro({
        FECHA: obtenerFecha(),
        CODIGO,
        NOMBRE: nombre,
        EQUIPO: equipo,
        DESCRIPCION: descripcion,
        USD_SERVICIO: usd,
        SOLES_SERVICIO: soles,
        PAGADO: "PENDIENTE",
        CONTABILIDAD:"PENDIENTE"
      });

      await sock.sendMessage(jid, {
        text: `✅ Guardado: *${CODIGO}*\n${nombre}`,
      });
    }
  });
}

startBot();