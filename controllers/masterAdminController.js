const { supabase } = require('../config/supabase');

// ════════════════════════════════════════════════════════════════
// VERIFICAR CÓDIGO DE MASTER ADMIN (público, sin token)
// ════════════════════════════════════════════════════════════════

const verificarCodigoMasterAdmin = async (req, res) => {
  const { codigo } = req.body;
  const codigoReal = process.env.MASTER_ADMIN_CODE;

  if (!codigoReal) {
    return res.status(500).json({ valido: false, error: 'Configuración de admin incompleta en el servidor' });
  }

  if (!codigo || codigo !== codigoReal) {
    // Respuesta genérica: no revelamos que existe un modo master admin
    return res.status(401).json({ valido: false });
  }

  res.json({ valido: true });
};

// ════════════════════════════════════════════════════════════════
// PROFESORES INDEPENDIENTES — listar, renovar, desactivar
// (rutas protegidas por verificarMasterAdmin)
// ════════════════════════════════════════════════════════════════

const listarProfesoresIndependientes = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('profesores_independientes')
      .select('id, nombre, email, fecha_vencimiento, activo, created_at')
      .order('fecha_vencimiento', { ascending: true, nullsFirst: true });
    if (error) throw error;

    const hoy = new Date().toISOString().split('T')[0];
    const profesores = (data || []).map(p => ({
      ...p,
      suscripcion_activa: !!p.fecha_vencimiento && p.fecha_vencimiento >= hoy,
    }));

    res.json(profesores);
  } catch (err) {
    console.error('❌ Error en listarProfesoresIndependientes:', err.message);
    res.status(500).json({ error: 'Error al cargar profesores' });
  }
};

// Renueva la suscripción sumando "dias" a partir de HOY (no acumula
// sobre la fecha anterior, para evitar líos si estaba vencida)
const renovarProfesorIndependiente = async (req, res) => {
  const { id } = req.params;
  const { dias } = req.body; // ej: 30

  const diasNum = parseInt(dias, 10) || 30;

  try {
    const nuevaFecha = new Date();
    nuevaFecha.setDate(nuevaFecha.getDate() + diasNum);
    const fechaISO = nuevaFecha.toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('profesores_independientes')
      .update({ fecha_vencimiento: fechaISO })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;

    console.log(`✅ [MASTER-ADMIN] Profesor ${id} renovado hasta ${fechaISO}`);
    res.json({ success: true, profesor: data });
  } catch (err) {
    console.error('❌ Error en renovarProfesorIndependiente:', err.message);
    res.status(500).json({ error: 'Error al renovar la suscripción' });
  }
};

// Corta el acceso inmediatamente (pone la fecha en el pasado)
const desactivarProfesorIndependiente = async (req, res) => {
  const { id } = req.params;

  try {
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    const fechaISO = ayer.toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('profesores_independientes')
      .update({ fecha_vencimiento: fechaISO })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;

    console.log(`⛔ [MASTER-ADMIN] Profesor ${id} desactivado`);
    res.json({ success: true, profesor: data });
  } catch (err) {
    console.error('❌ Error en desactivarProfesorIndependiente:', err.message);
    res.status(500).json({ error: 'Error al desactivar la suscripción' });
  }
};

module.exports = {
  verificarCodigoMasterAdmin,
  listarProfesoresIndependientes,
  renovarProfesorIndependiente,
  desactivarProfesorIndependiente,
};