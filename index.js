const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require('@whiskeysockets/baileys');

const P = require('pino');
const qrcode = require('qrcode-terminal');

const logger = P({ level: 'silent' });
const { generarCodigo, obtenerFecha, procesarMoneda } = require('./utils');
const { guardarRegistro, verificarPendiente, actualizarPago } = require('./sheets');
const { getResumen } = require('./sheets');
const { getDatosCliente } = require('./sheets');
const { eliminarUltimoRegistro } = require('./sheets');

async function startSock() {
  console.log('🚀 Iniciando bot...');

  const { state, saveCreds } = await useMultiFileAuthState('./auth');

  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    auth: state,
    browser: ['Chrome', 'Desktop', '1.0.0'],
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 0
  });

  // 🔥 EVENTOS OPTIMIZADOS (como tu ejemplo TS)
  sock.ev.process(async (events) => {

    // 📡 CONEXIÓN
    if (events['connection.update']) {
      const { connection, lastDisconnect, qr } = events['connection.update'];

      if (qr) {
        console.log('📲 Escanea QR:');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'open') {
        console.log('✅ Conectado');
      }

      if (connection === 'close') {
        const reason = lastDisconnect?.error?.output?.statusCode;

        console.log('❌ Conexión cerrada:', reason);

        if (reason !== DisconnectReason.loggedOut) {
          console.log('🔄 Reconectando...');
          startSock();
        } else {
          console.log('🚪 Sesión cerrada');
        }
      }
    }

    // 💾 GUARDAR SESIÓN
    if (events['creds.update']) {
      await saveCreds();
    }

    // 💬 MENSAJES
    if (events['messages.upsert']) {
      const upsert = events['messages.upsert'];

      if (upsert.type !== 'notify') return;

      for (const msg of upsert.messages) {

        if (!msg.message) continue;

        const jid = msg.key.remoteJid;
        console.log('mensaje de: ', jid)

        // 🔥 EXTRAER TEXTO (IMPORTANTE PARA GRUPOS)
        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          '';

        if (!text) continue;

        

        
        console.log('📩', text);

        // 🔥 EJEMPLO RESPUESTA
        if (text.toLowerCase() === '/estado') {
          await sock.sendMessage(jid, { text: 'activo' }, { quoted: msg });
        }
     if (text.toLowerCase() === '/help') {

      await sock.sendMessage(
        jid,
        {
          text: `📌 *Instrucciones de uso*

        *Formato para registrar*:
        _NOMBRE, MODELO, PRECIO, DESCRIPCION_

        Filtrar datos:
        _/resumen hoy_
        
        Eliminar Ultimo:
        _/eliminarultimo_

        estado:
        _/estado_
        `

        },
        { quoted: msg }
      );

      continue;
    }

        // 👉 AQUÍ VA TU LÓGICA (guardar, sheets, etc)
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
      const cliente = await getDatosCliente(nombre);
      const numero = cliente.numero || "";

      await guardarRegistro({
        FECHA: obtenerFecha(),
        CODIGO,
        NOMBRE: nombre,
        NUMERO: numero,
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
    }
  });

  return sock;
}

startSock();