// Middleware del MASTER ADMIN (tú, el dueño de la app) — NO tiene nada
// que ver con el admin institucional (rol 'admin' en la tabla 'profesores').
// Este usa un código secreto fijo en variables de entorno, no un token de Supabase.
const verificarMasterAdmin = (req, res, next) => {
  const codigoEnviado = req.headers['x-master-admin-code'];
  const codigoReal = process.env.MASTER_ADMIN_CODE;

  if (!codigoReal) {
    console.error('❌ MASTER_ADMIN_CODE no está configurado en las variables de entorno');
    return res.status(500).json({ error: 'Configuración de admin incompleta en el servidor' });
  }

  if (!codigoEnviado || codigoEnviado !== codigoReal) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  next();
};

module.exports = { verificarMasterAdmin };