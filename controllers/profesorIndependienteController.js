const { supabase, supabaseAdmin } = require('../config/supabase');

// ════════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════════

const registrarProfesorIndependiente = async (req, res) => {
  const { email, nombre, password } = req.body;
  if (!email || !nombre || !password) {
    return res.status(400).json({ error: 'Email, nombre y contraseña son obligatorios' });
  }

  try {
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (authError) return res.status(400).json({ error: authError.message });

    const { data, error } = await supabase
      .from('profesores_independientes')
      .insert([{ id: authData.user.id, nombre, email, activo: true }])
      .select()
      .single();

    if (error) {
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
// ✅ NUEVO: MATERIAS (dentro de una clase)
// ════════════════════════════════════════════════════════════════

const getMateriasDeClase = async (req, res) => {
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
      .from('materias_independientes')
      .select('*')
      .eq('clase_id', claseId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('❌ Error en getMateriasDeClase:', err.message);
    res.status(500).json({ error: 'Error al cargar materias' });
  }
};

const crearMateria = async (req, res) => {
  const { clase_id, nombre, descripcion } = req.body;
  if (!clase_id || !nombre) return res.status(400).json({ error: 'Clase y nombre de materia son obligatorios' });

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
      .from('materias_independientes')
      .insert([{ clase_id, nombre, descripcion: descripcion || null }])
      .select()
      .single();
    if (error) throw error;
    console.log(`✅ Materia creada: ${nombre}`);
    res.json(data);
  } catch (err) {
    console.error('❌ Error en crearMateria:', err.message);
    res.status(500).json({ error: 'Error al crear la materia' });
  }
};

const eliminarMateria = async (req, res) => {
  const { id } = req.params;
  try {
    const { error } = await supabase
      .from('materias_independientes')
      .delete()
      .eq('id', id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error en eliminarMateria:', err.message);
    res.status(500).json({ error: 'Error al eliminar la materia' });
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
// ASISTENCIA (✅ ahora requiere materia_id)
// ════════════════════════════════════════════════════════════════

const registrarAsistencia = async (req, res) => {
  const { cedula, clase_id, materia_id } = req.body;
  if (!cedula || !clase_id || !materia_id) {
    return res.status(400).json({ error: 'Cédula, clase y materia son obligatorios' });
  }

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
      .eq('cedula', cedula).eq('materia_id', materia_id).eq('fecha', hoy)
      .maybeSingle();
    if (yaRegistro) return res.status(400).json({ error: 'Este estudiante ya registró asistencia en esta materia hoy', estudiante });

    const { error } = await supabase
      .from('asistencia_independiente')
      .insert([{ cedula, clase_id, materia_id, fecha: hoy, hora: ahora }]);
    if (error) throw error;

    res.json({ message: 'Asistencia registrada', estudiante, hora: ahora });
  } catch (err) {
    console.error('❌ Error en registrarAsistencia (independiente):', err.message);
    res.status(500).json({ error: 'Error al registrar asistencia' });
  }
};

const getAsistenciaHoy = async (req, res) => {
  const { materiaId } = req.params;
  try {
    const hoy = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('asistencia_independiente')
      .select(`
        id, fecha, hora,
        estudiantes_independientes (cedula, nombre, apellido, foto_url)
      `)
      .eq('materia_id', materiaId)
      .eq('fecha', hoy);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('❌ Error en getAsistenciaHoy (independiente):', err.message);
    res.status(500).json({ error: 'Error al cargar asistencia' });
  }
};

const limpiarAsistenciaHoy = async (req, res) => {
  const { materiaId } = req.params;
  try {
    const hoy = new Date().toISOString().split('T')[0];
    const { error } = await supabase
      .from('asistencia_independiente')
      .delete()
      .eq('materia_id', materiaId)
      .eq('fecha', hoy);
    if (error) throw error;
    res.json({ message: 'Asistencia del día limpiada' });
  } catch (err) {
    res.status(500).json({ error: 'Error al limpiar asistencia' });
  }
};

// ════════════════════════════════════════════════════════════════
// ✅ REPORTES (por materia, con rango de fechas)
// ════════════════════════════════════════════════════════════════

const getReporte = async (req, res) => {
  const { materiaId } = req.params;
  const { fechaInicio, fechaFin } = req.query;
  try {
    let query = supabase
      .from('asistencia_independiente')
      .select(`
        id, fecha, hora,
        estudiantes_independientes (cedula, nombre, apellido)
      `)
      .eq('materia_id', materiaId);

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

// ✅ Reporte completo de TODA la clase (todas las materias) — útil para exportar
const getReporteClaseCompleto = async (req, res) => {
  const { claseId } = req.params;
  const { fechaInicio, fechaFin } = req.query;
  try {
    let query = supabase
      .from('asistencia_independiente')
      .select(`
        id, fecha, hora, materia_id,
        estudiantes_independientes (cedula, nombre, apellido),
        materias_independientes (nombre)
      `)
      .eq('clase_id', claseId);

    if (fechaInicio) query = query.gte('fecha', fechaInicio);
    if (fechaFin) query = query.lte('fecha', fechaFin);

    const { data, error } = await query.order('fecha', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('❌ Error en getReporteClaseCompleto:', err.message);
    res.status(500).json({ error: 'Error al cargar reporte' });
  }
};

module.exports = {
  registrarProfesorIndependiente,
  getMisClases,
  crearClase,
  eliminarClase,
  getMateriasDeClase,
  crearMateria,
  eliminarMateria,
  getEstudiantesDeClase,
  crearEstudiante,
  eliminarEstudiante,
  registrarAsistencia,
  getAsistenciaHoy,
  limpiarAsistenciaHoy,
  getReporte,
  getReporteClaseCompleto,
};
