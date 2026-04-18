const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const P = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const { generarCodigo, obtenerFecha, procesarMoneda } = require('./utils');
const { guardarRegistro, verificarPendiente, actualizarPago } = require('./sheets');
const { getResumen } = require('./sheets');

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');

  const sock = makeWASocket({
    auth: state,
    logger: P({ level: 'silent' }),
  });

  sock.ev.on('creds.update', saveCreds);

  // -- Establecer conexión
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('📲 Escanea este QR:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      console.log('✅ Bot conectado');
    }

    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      console.log('❌ Conexión cerrada');

      if (shouldReconnect) {
        console.log('🔄 Reconectando...');
        startBot();
      } else {
        console.log('⚠️ Sesión inválida, elimina la carpeta "auth" y reinicia');
      }
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
     if (text.toLowerCase().startsWith('/resumen')) {
        const input = text.split(' ')[1]?.trim().toLowerCase();

        let tipo;

        if (input === 'hoy') {
            tipo = 'hoy';
        } else if (input === 'mes') {
            tipo = 'mes';
        } else if (input === 'año' || input === 'ano') {
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
            `💰 Total Soles: *S/.${r.totalPEN.toFixed(2)}*\n` +
            `📈 Promedio diario USD: *$${r.promedioUSD}*`
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
        : (usd !== '-' && parseInt(usd.replace('$', '')) <= 350
            ? 'EMISIONES'
            : 'CONFIGURACION');

      // 🔥 Validación: soles requieren descripción
      if (soles !== '-' && !partes[3]) {
        await sock.sendMessage(jid, {
          text: '⚠️ En soles debes agregar descripción',
        });
        return;
      }

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
      });

      await sock.sendMessage(jid, {
        text: `✅ Guardado: *${CODIGO}*\n${nombre}`,
      });
    }
  });
}

startBot();