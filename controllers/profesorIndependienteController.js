const { supabase, supabaseAdmin } = require('../config/supabase');

// ════════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════════

// Registro: crea usuario en Supabase Auth + fila en profesores_independientes
const registrarProfesorIndependiente = async (req, res) => {
  const { email, nombre, password } = req.body;
  if (!email || !nombre || !password) {
    return res.status(400).json({ error: 'Email, nombre y contraseña son obligatorios' });
  }

  try {
    // ✅ CORREGIDO: usa supabaseAdmin (service_role), no supabase (anon)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (authError) return res.status(400).json({ error: authError.message });

    // 2. Crear fila en profesores_independientes (con cliente normal está bien)
    const { data, error } = await supabase
      .from('profesores_independientes')
      .insert([{ id: authData.user.id, nombre, email, activo: true }])
      .select()
      .single();

    if (error) {
      // Si falla, eliminar el usuario de Auth para no dejar huérfanos
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return res.status(400).json({ error: error.message });
    }

    console.log(`✅ Profesor independiente registrado: ${email}`);
    res.json({ success: true, profesor: data });
  } catch (err) {
    console.error('❌ Error en registrarProfesorIndependiente:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ════════════════════════════════════════════════════════════════
// CLASES
// ════════════════════════════════════════════════════════════════

const getMisClases = async (req, res) => {
  try {
    const profesorId = req.user.id;
    const { data, error } = await supabase
      .from('clases_independientes')
      .select('*')
      .eq('profesor_id', profesorId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('❌ Error en getMisClases:', err.message);
    res.status(500).json({ error: 'Error al cargar clases' });
  }
};

const crearClase = async (req, res) => {
  const { nombre, descripcion } = req.body;
  if (!nombre) return res.status(400).json({ error: 'El nombre de la clase es obligatorio' });

  try {
    const profesorId = req.user.id;
    const { data, error } = await supabase
      .from('clases_independientes')
      .insert([{ profesor_id: profesorId, nombre, descripcion: descripcion || null }])
      .select()
      .single();
    if (error) throw error;
    console.log(`✅ Clase independiente creada: ${nombre}`);
    res.json(data);
  } catch (err) {
    console.error('❌ Error en crearClase:', err.message);
    res.status(500).json({ error: 'Error al crear la clase' });
  }
};

const eliminarClase = async (req, res) => {
  const { id } = req.params;
  try {
    const profesorId = req.user.id;
    const { error } = await supabase
      .from('clases_independientes')
      .delete()
      .eq('id', id)
      .eq('profesor_id', profesorId);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error en eliminarClase:', err.message);
    res.status(500).json({ error: 'Error al eliminar la clase' });
  }
};

// ════════════════════════════════════════════════════════════════
// ESTUDIANTES
// ════════════════════════════════════════════════════════════════

const getEstudiantesDeClase = async (req, res) => {
  const { claseId } = req.params;
  try {
    const profesorId = req.user.id;
    const { data: clase } = await supabase
      .from('clases_independientes')
      .select('id')
      .eq('id', claseId)
      .eq('profesor_id', profesorId)
      .maybeSingle();
    if (!clase) return res.status(403).json({ error: 'No tienes acceso a esta clase' });

    const { data, error } = await supabase
      .from('estudiantes_independientes')
      .select('*')
      .eq('clase_id', claseId)
      .order('apellido', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('❌ Error en getEstudiantesDeClase:', err.message);
    res.status(500).json({ error: 'Error al cargar estudiantes' });
  }
};

const crearEstudiante = async (req, res) => {
  const { cedula, nombre, apellido, clase_id, foto_url } = req.body;
  if (!cedula || !nombre || !apellido || !clase_id) {
    return res.status(400).json({ error: 'Cédula, nombre, apellido y clase son obligatorios' });
  }

  try {
    const profesorId = req.user.id;
    const { data: clase } = await supabase
      .from('clases_independientes')
      .select('id')
      .eq('id', clase_id)
      .eq('profesor_id', profesorId)
      .maybeSingle();
    if (!clase) return res.status(403).json({ error: 'No tienes acceso a esta clase' });

    const { data, error } = await supabase
      .from('estudiantes_independientes')
      .insert([{ cedula, nombre, apellido, clase_id, foto_url: foto_url || null }])
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('❌ Error en crearEstudiante (independiente):', err.message);
    res.status(500).json({ error: err.message || 'Error al crear estudiante' });
  }
};

const eliminarEstudiante = async (req, res) => {
  const { cedula } = req.params;
  try {
    const { error } = await supabase
      .from('estudiantes_independientes')
      .delete()
      .eq('cedula', cedula);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error en eliminarEstudiante (independiente):', err.message);
    res.status(500).json({ error: 'Error al eliminar estudiante' });
  }
};

// ════════════════════════════════════════════════════════════════
// ASISTENCIA
// ════════════════════════════════════════════════════════════════

const registrarAsistencia = async (req, res) => {
  const { cedula, clase_id } = req.body;
  if (!cedula || !clase_id) return res.status(400).json({ error: 'Cédula y clase son obligatorios' });

  try {
    const hoy = new Date().toISOString().split('T')[0];
    const ahora = new Date().toLocaleTimeString('en-GB', { hour12: false });

    const { data: estudiante, error: errEst } = await supabase
      .from('estudiantes_independientes')
      .select('cedula, nombre, apellido')
      .eq('cedula', cedula)
      .eq('clase_id', clase_id)
      .maybeSingle();
    if (errEst || !estudiante) return res.status(404).json({ error: 'Estudiante no encontrado en esta clase' });

    const { data: yaRegistro } = await supabase
      .from('asistencia_independiente')
      .select('id')
      .eq('cedula', cedula).eq('clase_id', clase_id).eq('fecha', hoy)
      .maybeSingle();
    if (yaRegistro) return res.status(400).json({ error: 'Este estudiante ya registró asistencia hoy', estudiante });

    const { error } = await supabase
      .from('asistencia_independiente')
      .insert([{ cedula, clase_id, fecha: hoy, hora: ahora }]);
    if (error) throw error;

    res.json({ message: 'Asistencia registrada', estudiante, hora: ahora });
  } catch (err) {
    console.error('❌ Error en registrarAsistencia (independiente):', err.message);
    res.status(500).json({ error: 'Error al registrar asistencia' });
  }
};

const getAsistenciaHoy = async (req, res) => {
  const { claseId } = req.params;
  try {
    const hoy = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('asistencia_independiente')
      .select(`
        id, fecha, hora,
        estudiantes_independientes (cedula, nombre, apellido, foto_url)
      `)
      .eq('clase_id', claseId)
      .eq('fecha', hoy);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('❌ Error en getAsistenciaHoy (independiente):', err.message);
    res.status(500).json({ error: 'Error al cargar asistencia' });
  }
};

const limpiarAsistenciaHoy = async (req, res) => {
  const { claseId } = req.params;
  try {
    const hoy = new Date().toISOString().split('T')[0];
    const { error } = await supabase
      .from('asistencia_independiente')
      .delete()
      .eq('clase_id', claseId)
      .eq('fecha', hoy);
    if (error) throw error;
    res.json({ message: 'Asistencia del día limpiada' });
  } catch (err) {
    res.status(500).json({ error: 'Error al limpiar asistencia' });
  }
};

// ════════════════════════════════════════════════════════════════
// REPORTES (rango de fechas)
// ════════════════════════════════════════════════════════════════

const getReporte = async (req, res) => {
  const { claseId } = req.params;
  const { fechaInicio, fechaFin } = req.query;
  try {
    let query = supabase
      .from('asistencia_independiente')
      .select(`
        id, fecha, hora,
        estudiantes_independientes (cedula, nombre, apellido)
      `)
      .eq('clase_id', claseId);

    if (fechaInicio) query = query.gte('fecha', fechaInicio);
    if (fechaFin) query = query.lte('fecha', fechaFin);

    const { data, error } = await query.order('fecha', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('❌ Error en getReporte (independiente):', err.message);
    res.status(500).json({ error: 'Error al cargar reporte' });
  }
};

module.exports = {
  registrarProfesorIndependiente,
  getMisClases,
  crearClase,
  eliminarClase,
  getEstudiantesDeClase,
  crearEstudiante,
  eliminarEstudiante,
  registrarAsistencia,
  getAsistenciaHoy,
  limpiarAsistenciaHoy,
  getReporte,
};
