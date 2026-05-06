const supabase = require('../config/supabase');
const { parseExcel } = require('../utils/excelParser');

// ========== HELPER: obtener perfil del usuario (rol e institución) ==========
async function getPerfil(userId) {
  const { data, error } = await supabase
    .from('profesores')
    .select('rol, institucion_id')
    .eq('id', userId)
    .single();
  if (error) return { rol: null, institucion_id: null };
  return { rol: data?.rol || null, institucion_id: data?.institucion_id || null };
}

// Obtener todos los estudiantes (filtrando por institución si corresponde)
const getEstudiantes = async (req, res) => {
  console.log('📋 [estudiantes] GET / - Obteniendo todos los estudiantes');
  try {
    const userId = req.user.id;
    const { rol, institucion_id } = await getPerfil(userId);
    
    let query = supabase.from('estudiantes').select('*');
    if (institucion_id) {
      // Si el usuario tiene institución, filtrar por ella
      query = query.eq('institucion_id', institucion_id);
    }
    // Si es superadmin (institucion_id = null), no aplicar filtro
    
    const { data, error } = await query.order('apellido', { ascending: true });
    
    if (error) {
      console.error('❌ Error en getEstudiantes:', error.message);
      return res.status(400).json({ error: error.message });
    }
    console.log(`✅ Encontrados ${data.length} estudiantes`);
    res.json(data);
  } catch (err) {
    console.error('❌ Excepción en getEstudiantes:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// Buscar estudiante por cédula (con filtro de institución)
const getEstudianteByCedula = async (req, res) => {
  const { cedula } = req.params;
  console.log(`🔍 [estudiantes] GET /${cedula} - Buscando por cédula`);
  
  try {
    const userId = req.user.id;
    const { institucion_id } = await getPerfil(userId);
    
    let query = supabase.from('estudiantes').select('*').eq('cedula', cedula);
    if (institucion_id) {
      query = query.eq('institucion_id', institucion_id);
    }
    const { data, error } = await query.maybeSingle();
    
    if (error) {
      console.error('❌ Error en getEstudianteByCedula:', error.message);
      return res.status(500).json({ error: 'Error al buscar estudiante' });
    }
    
    if (!data) {
      console.log(`⚠️ Estudiante con cédula ${cedula} no encontrado`);
      return res.status(404).json({ error: 'Estudiante no encontrado' });
    }
    
    console.log(`✅ Estudiante encontrado: ${data.nombre} ${data.apellido}`);
    res.json(data);
  } catch (err) {
    console.error('❌ Excepción en getEstudianteByCedula:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// Crear un estudiante individual (asignando institución del usuario autenticado)
const createEstudiante = async (req, res) => {
  const { cedula, nombre, apellido, grado, seccion, carrera } = req.body;
  console.log(`📝 [estudiantes] POST / - Creando estudiante ${cedula}`);
  
  try {
    const userId = req.user.id;
    const { rol, institucion_id } = await getPerfil(userId);
    
    // Solo administradores pueden crear estudiantes
    if (rol !== 'admin') {
      return res.status(403).json({ error: 'No tienes permiso para crear estudiantes' });
    }
    
    const { data, error } = await supabase
      .from('estudiantes')
      .insert([{ 
        cedula, nombre, apellido, grado, seccion, carrera,
        institucion_id  // se asigna la institución del administrador
      }])
      .select();
    
    if (error) {
      console.error('❌ Error en createEstudiante:', error.message);
      return res.status(400).json({ error: error.message });
    }
    console.log(`✅ Estudiante creado: ${cedula}`);
    res.json(data[0]);
  } catch (err) {
    console.error('❌ Excepción en createEstudiante:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// Carga masiva desde Excel (carrera ya viene incluido desde parseExcel)
const bulkUploadEstudiantes = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo' });
    }
    
    const userId = req.user.id;
    const { rol, institucion_id } = await getPerfil(userId);
    if (rol !== 'admin') {
      return res.status(403).json({ error: 'No tienes permiso para realizar carga masiva' });
    }
    
    const estudiantes = await parseExcel(req.file.buffer);
    const resultados = { exitosos: [], fallidos: [] };
    
    for (const estudiante of estudiantes) {
      // Asignar institución del administrador a cada estudiante
      const estudianteConInstitucion = { ...estudiante, institucion_id };
      
      const { error } = await supabase
        .from('estudiantes')
        .insert([estudianteConInstitucion]);
      
      if (error) {
        resultados.fallidos.push({ ...estudiante, error: error.message });
      } else {
        resultados.exitosos.push(estudiante);
      }
    }
    
    res.json({
      message: `Carga completada: ${resultados.exitosos.length} exitosos, ${resultados.fallidos.length} fallidos`,
      resultados
    });
  } catch (err) {
    console.error('❌ Error en bulkUpload:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// Actualizar estudiante (verificar que pertenezca a la misma institución)
const updateEstudiante = async (req, res) => {
  const { cedula } = req.params;
  const { nombre, apellido, grado, seccion, carrera } = req.body;
  console.log(`✏️ [estudiantes] PUT /${cedula} - Actualizando`);
  
  try {
    const userId = req.user.id;
    const { rol, institucion_id } = await getPerfil(userId);
    
    if (rol !== 'admin') {
      return res.status(403).json({ error: 'No tienes permiso para modificar estudiantes' });
    }
    
    // Verificar que el estudiante pertenezca a la institución (si aplica)
    let checkQuery = supabase.from('estudiantes').select('institucion_id').eq('cedula', cedula);
    if (institucion_id) {
      checkQuery = checkQuery.eq('institucion_id', institucion_id);
    }
    const { data: existing, error: checkError } = await checkQuery.maybeSingle();
    if (checkError || !existing) {
      return res.status(403).json({ error: 'No tienes permiso para modificar este estudiante' });
    }
    
    const { data, error } = await supabase
      .from('estudiantes')
      .update({ nombre, apellido, grado, seccion, carrera })
      .eq('cedula', cedula)
      .select();
    
    if (error) {
      console.error('❌ Error en updateEstudiante:', error.message);
      return res.status(400).json({ error: error.message });
    }
    res.json(data[0]);
  } catch (err) {
    console.error('❌ Excepción en updateEstudiante:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// Eliminar estudiante (con verificación de institución)
const deleteEstudiante = async (req, res) => {
  const { cedula } = req.params;
  console.log(`🗑️ [estudiantes] DELETE /${cedula} - Eliminando`);
  
  try {
    const userId = req.user.id;
    const { rol, institucion_id } = await getPerfil(userId);
    
    if (rol !== 'admin') {
      return res.status(403).json({ error: 'No tienes permiso para eliminar estudiantes' });
    }
    
    // Verificar que el estudiante pertenezca a la institución
    let checkQuery = supabase.from('estudiantes').select('institucion_id').eq('cedula', cedula);
    if (institucion_id) {
      checkQuery = checkQuery.eq('institucion_id', institucion_id);
    }
    const { data: existing, error: checkError } = await checkQuery.maybeSingle();
    if (checkError || !existing) {
      return res.status(403).json({ error: 'No tienes permiso para eliminar este estudiante' });
    }
    
    const { error } = await supabase
      .from('estudiantes')
      .delete()
      .eq('cedula', cedula);
    
    if (error) {
      console.error('❌ Error en deleteEstudiante:', error.message);
      return res.status(400).json({ error: error.message });
    }
    res.json({ message: 'Estudiante eliminado' });
  } catch (err) {
    console.error('❌ Excepción en deleteEstudiante:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// Obtener grados y secciones únicos (con filtro por institución opcional)
const getGradosSecciones = async (req, res) => {
  try {
    const userId = req.user.id;
    const { institucion_id } = await getPerfil(userId);
    
    let query = supabase.from('estudiantes').select('grado, seccion');
    if (institucion_id) {
      query = query.eq('institucion_id', institucion_id);
    }
    const { data, error } = await query.order('grado', { ascending: true }).order('seccion', { ascending: true });
    
    if (error) {
      console.error('❌ Error en getGradosSecciones:', error.message);
      return res.status(400).json({ error: error.message });
    }
    
    const uniqueMap = new Map();
    data.forEach(item => {
      const key = `${item.grado}|${item.seccion}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, { grado: item.grado, seccion: item.seccion });
      }
    });
    const gradosSecciones = Array.from(uniqueMap.values());
    console.log(`✅ Grados y secciones únicos encontrados: ${gradosSecciones.length}`);
    res.json(gradosSecciones);
  } catch (err) {
    console.error('❌ Excepción en getGradosSecciones:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

module.exports = {
  getEstudiantes,
  getEstudianteByCedula,
  createEstudiante,
  bulkUploadEstudiantes,
  updateEstudiante,
  deleteEstudiante,
  getGradosSecciones
};
