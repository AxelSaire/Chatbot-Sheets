const { google } = require('googleapis');

const path = require('path');

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(__dirname, 'credentials.json'), // ← relativo al archivo sheets.js
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

const SPREADSHEET_ID = '1SMbnKKB4umyDnJHCtO2kUnKlR2VnVnfanDmhsucttCg';
const RANGE = 'Hoja1!A:O';

// 💾 GUARDAR
async function guardarRegistro(data) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: RANGE,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        data.FECHA,
        data.CODIGO,
        data.NOMBRE,
        "",
        data.EQUIPO,
        data.DESCRIPCION,
        data.USD_SERVICIO,
        data.SOLES_SERVICIO,
        "-",
        data.PAGADO,
        data.CONTABILIDAD,
        "-",
        "-",
        "-",
        "",
        "",
        ""
      ]]
    }
  });
  // aplicarDropdownColumna();
}

// async function aplicarDropdownColumna() {
//   await sheets.spreadsheets.batchUpdate({
//     spreadsheetId: SPREADSHEET_ID,
//     requestBody: {
//       requests: [{
//         setDataValidation: {
//           range: {
//             sheetId: 0,
//             startRowIndex: 1,      // fila 2 en adelante (salta el header)
//             endRowIndex: 1000,     // hasta la fila 1000
//             startColumnIndex: 9,
//             endColumnIndex: 10
//           },
//           rule: {
//             condition: {
//               type: 'ONE_OF_LIST',
//               values: [
//                 { userEnteredValue: 'PENDIENTE' },
//                 { userEnteredValue: 'PAGADO' },
//                 { userEnteredValue: 'NO PAGADO' },
//                 { userEnteredValue: 'FOR FREE' }
//               ]
//             },
//             showCustomUi: true,
//             strict: true
//           }
//         }
//       }]
//     }
//   });
// }
// 🔍 OBTENER TODO
async function obtenerRegistros() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: RANGE
  });

  // ✅ Si no hay datos, retorna array vacío en vez de crashear
  return (res.data.values || []).slice(1);
}

// 🔎 BUSCAR PENDIENTES
async function verificarPendiente(nombre) {
  const rows = await obtenerRegistros();

  return rows.filter(r =>
    r[2] === nombre.toUpperCase() && r[9] === 'PENDIENTE'
  ).length;
}
async function getResumen(tipo, valor = null) {
  const rows = await obtenerRegistros();

  const hoy = new Date();
  const diaHoy = hoy.getDate();
  const mesHoy = hoy.getMonth() + 1;
  const añoHoy = hoy.getFullYear();

  let totalUSD = 0;
  let totalPEN = 0;
  let cantidad = 0;
  const dias = new Set();

  rows.forEach(r => {
    const fecha = r[0]; // columna A = FECHA
    if (!fecha) return;

    const [dia, mes, año] = fecha.split('/').map(Number);
    let cumple = false;

    if (tipo === 'hoy') {
      cumple = dia === diaHoy && mes === mesHoy && año === añoHoy;
    } else if (tipo === 'fecha') {
      const [d, m, a] = valor.split('/').map(Number);
      cumple = dia === d && mes === m && año === a;
    } else if (tipo === 'mes') {
      cumple = mes === mesHoy && año === añoHoy;
    } else if (tipo === 'año') {
      cumple = año === añoHoy;
    }

    if (!cumple) return;

    cantidad++;
    dias.add(dia);

    // columna G = USD (índice 6), columna H = SOLES (índice 7)
    const usdRaw = r[6];
    const solesRaw = r[7];

    if (usdRaw && usdRaw !== '-') {
      const val = parseFloat(String(usdRaw).replace(/[^\d.]/g, ''));
      totalUSD += val || 0;
    }

    if (solesRaw && solesRaw !== '-') {
    const val = Number(
      String(solesRaw)
        .replace(/s\/\.?|S\/\.?/gi, '') 
        .replace(/[^\d.]/g, '')         
    );

    totalPEN += isNaN(val) ? 0 : val;
    }
  });

  const promedioUSD = dias.size ? Math.round(totalUSD / dias.size) : 0;

  return { cantidad, totalUSD, totalPEN, promedioUSD, diasActivos: dias.size };
}

// ✏️ ACTUALIZAR PAGO
async function actualizarPago(codigo, pagado, formaPago) {
  const rows = await obtenerRegistros();

  const index = rows.findIndex(r => r[1] === codigo);

  if (index === -1) return false;

  const fila = index + 2;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Hoja1!J${fila}:K${fila}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[pagado, formaPago]]
    }
  });

  return true;
}
async function eliminarUltimoRegistro() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: RANGE
  });

  const rows = res.data.values;

  if (!rows || rows.length <= 1) {
    return { error: 'no_hay_registros' };
  }

  // 🔥 última fila (sin contar header)
  const lastIndex = rows.length - 1;
  const lastRow = rows[lastIndex];

  const CODIGO = lastRow[1];
  const NOMBRE = lastRow[2];

  // 🔥 eliminar fila
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: 0, // ⚠️ normalmente es 0 (Hoja1)
              dimension: "ROWS",
              startIndex: lastIndex,
              endIndex: lastIndex + 1
            }
          }
        }
      ]
    }
  });

  return { CODIGO, NOMBRE };
}

module.exports = {
  guardarRegistro,
  verificarPendiente,
  actualizarPago,
  getResumen,
  eliminarUltimoRegistro
};