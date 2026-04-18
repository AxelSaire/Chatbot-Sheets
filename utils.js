function generarCodigo() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function obtenerFecha() {
  const d = new Date();
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function procesarMoneda(valorRaw) {
  if (!valorRaw) return { usd: "-", soles: "-" };

  let valor = valorRaw.toLowerCase().trim();

  if (valor.startsWith('s')) {
    valor = valor.replace(/[^\d]/g, '');
    return { usd: "-", soles: `S/.${valor}` };
  }

  valor = valor.replace(/[^\d]/g, '');
  return { usd: `$${valor}`, soles: "-" };
}

module.exports = {
  generarCodigo,
  obtenerFecha,
  procesarMoneda
};