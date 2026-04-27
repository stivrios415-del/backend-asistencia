const supabase = require('../config/supabase');
const { parseExcel } = require('../utils/excelParser');

// Obtener todos los estudiantes
const getEstudiantes = async (req, res) => {
  console.log('📋 [estudiantes] GET / - Obteniendo todos los estudiantes');
  try {
    const { data, error } = await supabase
      .from('estudiantes')
      .select('*')
      .order('apellido', { ascending: true });
    
    if (error) {
      console.error('❌ Error en getEstudiantes:', error.message);
      return res.status(400).json({ error: error.message });
    }
    console.log(`✅ Encontrados ${data.length} estudiantes`);
    res.json(data);
  } catch (err) {
    console.error('❌ Excepción en getEstudiantes:', err.message);
    console.error('❌ Causa:', err.cause);
    console.error('❌ Código:', err.cause?.code);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// Buscar estudiante por cédula
const getEstudianteByCedula = async (req, res) => {
  const { cedula } = req.params;
  console.log(`🔍 [estudiantes] GET /${cedula} - Buscando por cédula`);
  
  try {
    const { data, error } = await supabase
      .from('estudiantes')
      .select('*')
      .eq('cedula', cedula)
      .maybeSingle();
    
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
    console.error('❌ Causa:', err.cause);
    console.error('❌ Código:', err.cause?.code);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// Crear un estudiante individual
const createEstudiante = async (req, res) => {
  const { cedula, nombre, apellido, grado, seccion } = req.body;
  console.log(`📝 [estudiantes] POST / - Creando estudiante ${cedula}`);
  
  try {
    const { data, error } = await supabase
      .from('estudiantes')
      .insert([{ cedula, nombre, apellido, grado, seccion }])
      .select();
    
    if (error) {
      console.error('❌ Error en createEstudiante:', error.message);
      return res.status(400).json({ error: error.message });
    }
    console.log(`✅ Estudiante creado: ${cedula}`);
    res.json(data[0]);
  } catch (err) {
    console.error('❌ Excepción en createEstudiante:', err.message);
    console.error('❌ Causa:', err.cause);
    console.error('❌ Código:', err.cause?.code);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// Carga masiva desde Excel
const bulkUploadEstudiantes = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo' });
    }
    
    const estudiantes = await parseExcel(req.file.buffer);
    const resultados = { exitosos: [], fallidos: [] };
    
    for (const estudiante of estudiantes) {
      const { error } = await supabase
        .from('estudiantes')
        .insert([estudiante]);
      
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
    console.error('❌ Causa:', err.cause);
    console.error('❌ Código:', err.cause?.code);
    res.status(500).json({ error: err.message });
  }
};

// Actualizar estudiante
const updateEstudiante = async (req, res) => {
  const { cedula } = req.params;
  const { nombre, apellido, grado, seccion } = req.body;
  console.log(`✏️ [estudiantes] PUT /${cedula} - Actualizando`);
  
  try {
    const { data, error } = await supabase
      .from('estudiantes')
      .update({ nombre, apellido, grado, seccion })
      .eq('cedula', cedula)
      .select();
    
    if (error) {
      console.error('❌ Error en updateEstudiante:', error.message);
      return res.status(400).json({ error: error.message });
    }
    res.json(data[0]);
  } catch (err) {
    console.error('❌ Excepción en updateEstudiante:', err.message);
    console.error('❌ Causa:', err.cause);
    console.error('❌ Código:', err.cause?.code);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// Eliminar estudiante
const deleteEstudiante = async (req, res) => {
  const { cedula } = req.params;
  console.log(`🗑️ [estudiantes] DELETE /${cedula} - Eliminando`);
  
  try {
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
    console.error('❌ Causa:', err.cause);
    console.error('❌ Código:', err.cause?.code);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

module.exports = {
  getEstudiantes,
  getEstudianteByCedula,
  createEstudiante,
  bulkUploadEstudiantes,
  updateEstudiante,
  deleteEstudiante
};