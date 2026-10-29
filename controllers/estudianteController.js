const { supabase } = require('../config/supabase');
const { parseExcel } = require('../utils/excelParser');

// ========== CONSULTA PÚBLICA — para credencial del estudiante ==========
const getEstudiantePublico = async (req, res) => {
  const { cedula } = req.params;
  const { institucion_id } = req.query; 

  try {
    let query = supabase
      .from('estudiantes')
      .select('cedula, nombre, apellido, grado, seccion, carrera, foto_url, institucion_id')
      .eq('cedula', cedula);

    if (institucion_id) {
      query = query.eq('institucion_id', institucion_id);
    }

    const { data, error } = await query.maybeSingle();

    if (error) return res.status(500).json({ error: 'Error al buscar estudiante' });
    if (!data) return res.status(404).json({ error: 'Estudiante no encontrado' });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ========== OBTENER TODOS LOS ESTUDIANTES ==========
const getEstudiantes = async (req, res) => {
  try {
    // ✅ USAMOS DIRECTAMENTE req.user.institucion_id
    const institucion_id = req.user.institucion_id;
    
    // Seguridad extra: si no hay institución, no mostramos nada
    if (!institucion_id) {
      return res.status(403).json({ error: 'No tienes una institución asignada.' });
    }

    const { data, error } = await supabase
      .from('estudiantes')
      .select('*')
      .eq('institucion_id', institucion_id) // ✅ Filtro estricto
      .order('apellido', { ascending: true });

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ========== BUSCAR ESTUDIANTE POR CÉDULA (protegido) ==========
const getEstudianteByCedula = async (req, res) => {
  const { cedula } = req.params;
  try {
    const institucion_id = req.user.institucion_id;
    
    let query = supabase.from('estudiantes').select('*').eq('cedula', cedula);
    if (institucion_id) {
      query = query.eq('institucion_id', institucion_id);
    }
    
    const { data, error } = await query.maybeSingle();

    if (error) return res.status(500).json({ error: 'Error al buscar estudiante' });
    if (!data) return res.status(404).json({ error: 'Estudiante no encontrado' });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ========== CREAR ESTUDIANTE INDIVIDUAL ==========
const createEstudiante = async (req, res) => {
  const { cedula, nombre, apellido, grado, seccion, carrera } = req.body;

  try {
    const rol = req.user.rol;
    const institucion_id = req.user.institucion_id;

    if (rol !== 'admin') {
      return res.status(403).json({ error: 'No tienes permiso para crear estudiantes' });
    }

    const { data, error } = await supabase
      .from('estudiantes')
      .insert([{ cedula, nombre, apellido, grado, seccion, carrera, institucion_id }])
      .select();

    if (error) return res.status(400).json({ error: error.message });
    res.json(data[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ========== CARGA MASIVA DESDE EXCEL ==========
const bulkUploadEstudiantes = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo' });
    }

    const rol = req.user.rol;
    const institucion_id = req.user.institucion_id;

    if (rol !== 'admin') {
      return res.status(403).json({ error: 'No tienes permiso para realizar carga masiva' });
    }

    const estudiantes = await parseExcel(req.file.buffer);
    const resultados = { exitosos: [], fallidos: [] };

    for (const estudiante of estudiantes) {
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
    res.status(500).json({ error: err.message });
  }
};

// ========== ACTUALIZAR ESTUDIANTE ==========
const updateEstudiante = async (req, res) => {
  const { cedula } = req.params;
  const { nombre, apellido, grado, seccion, carrera } = req.body;

  try {
    const rol = req.user.rol;
    const institucion_id = req.user.institucion_id;

    if (rol !== 'admin') {
      return res.status(403).json({ error: 'No tienes permiso para modificar estudiantes' });
    }

    // Verificar que el estudiante pertenece a la institución actual
    let checkQuery = supabase.from('estudiantes').select('institucion_id').eq('cedula', cedula);
    if (institucion_id) {
      checkQuery = checkQuery.eq('institucion_id', institucion_id);
    }
    const { data: existing } = await checkQuery.maybeSingle();
    if (!existing) {
      return res.status(403).json({ error: 'No tienes permiso para modificar este estudiante' });
    }

    const { data, error } = await supabase
      .from('estudiantes')
      .update({ nombre, apellido, grado, seccion, carrera })
      .eq('cedula', cedula)
      .select();

    if (error) return res.status(400).json({ error: error.message });
    res.json(data[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ========== ELIMINAR ESTUDIANTE ==========
const deleteEstudiante = async (req, res) => {
  const { cedula } = req.params;

  try {
    const rol = req.user.rol;
    const institucion_id = req.user.institucion_id;

    if (rol !== 'admin') {
      return res.status(403).json({ error: 'No tienes permiso para eliminar estudiantes' });
    }

    let checkQuery = supabase.from('estudiantes').select('institucion_id').eq('cedula', cedula);
    if (institucion_id) {
      checkQuery = checkQuery.eq('institucion_id', institucion_id);
    }
    const { data: existing } = await checkQuery.maybeSingle();
    if (!existing) {
      return res.status(403).json({ error: 'No tienes permiso para eliminar este estudiante' });
    }

    const { error } = await supabase
      .from('estudiantes')
      .delete()
      .eq('cedula', cedula);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Estudiante eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ========== OBTENER GRADOS Y SECCIONES ÚNICOS ==========
const getGradosSecciones = async (req, res) => {
  try {
    const institucion_id = req.user.institucion_id;

    let query = supabase.from('estudiantes').select('grado, seccion');
    if (institucion_id) {
      query = query.eq('institucion_id', institucion_id);
    }
    
    const { data, error } = await query
      .order('grado', { ascending: true })
      .order('seccion', { ascending: true });

    if (error) return res.status(400).json({ error: error.message });

    const uniqueMap = new Map();
    data.forEach(item => {
      const key = `${item.grado}|${item.seccion}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, { grado: item.grado, seccion: item.seccion });
      }
    });
    const gradosSecciones = Array.from(uniqueMap.values());
    res.json(gradosSecciones);
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

module.exports = {
  getEstudiantePublico,
  getEstudiantes,
  getEstudianteByCedula,
  createEstudiante,
  bulkUploadEstudiantes,
  updateEstudiante,
  deleteEstudiante,
  getGradosSecciones,
};
