const { supabase } = require('../config/supabase');

// Función auxiliar: obtener rol e institución del usuario
async function getPerfil(userId) {
  const { data, error } = await supabase
    .from('profesores')
    .select('rol, institucion_id')
    .eq('id', userId)
    .single();
  if (error) return { rol: null, institucion_id: null };
  return { rol: data?.rol || null, institucion_id: data?.institucion_id || null };
}

// Obtener materias (todas si es admin sin institución, solo las suyas o de su institución)
const getMaterias = async (req, res) => {
  try {
    const userId = req.user.id;
    const { rol, institucion_id } = await getPerfil(userId);
    
    let query = supabase.from('materias').select('*');
    
    // Filtro por institución (si el usuario tiene una institución asignada)
    if (institucion_id) {
      query = query.eq('institucion_id', institucion_id);
    }
    
    // Si no es administrador, también filtrar por profesor_id (solo sus materias)
    if (rol !== 'admin') {
      query = query.eq('profesor_id', userId);
    }
    
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Crear materia (asignar profesor_id y institucion_id)
const createMateria = async (req, res) => {
  const { nombre, descripcion, grado, seccion, carrera, ciclo, profesor_id } = req.body;
  const userId = req.user.id;
  const { rol, institucion_id } = await getPerfil(userId);
  
  // Determinar a quién se asigna la materia (solo admin puede asignar a otro profesor)
  let asignadoA = profesor_id;
  if (rol !== 'admin') {
    asignadoA = userId;                      // profesor común: solo para sí mismo
  } else if (!asignadoA) {
    asignadoA = null;                       // admin no especificó: queda sin profesor
  }
  
  // Validar que el profesor asignado (si existe) pertenezca a la misma institución
  if (asignadoA) {
    const { data: prof, error: errProf } = await supabase
      .from('profesores')
      .select('institucion_id')
      .eq('id', asignadoA)
      .single();
    if (errProf || (institucion_id && prof.institucion_id !== institucion_id)) {
      return res.status(403).json({ error: 'No puedes asignar materias a profesores de otra institución' });
    }
  }
  
  try {
    const { data, error } = await supabase
      .from('materias')
      .insert([{ 
        profesor_id: asignadoA,
        institucion_id: institucion_id,      // siempre se asigna la institución del usuario autenticado
        nombre,
        descripcion,
        grado,
        seccion,
        carrera,
        ciclo: ciclo || null
      }])
      .select();
    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Actualizar materia (admin puede actualizar cualquier materia de su institución, profesor solo la suya)
const updateMateria = async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const userId = req.user.id;
  const { rol, institucion_id } = await getPerfil(userId);
  
  try {
    let query = supabase.from('materias').update(updates).eq('id', id);
    
    // Filtros de seguridad
    if (institucion_id) {
      query = query.eq('institucion_id', institucion_id);
    }
    if (rol !== 'admin') {
      query = query.eq('profesor_id', userId);
    }
    
    const { data, error } = await query.select();
    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(403).json({ error: 'No tienes permiso para modificar esta materia' });
    }
    res.json(data[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Eliminar materia (misma lógica de permisos)
const deleteMateria = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const { rol, institucion_id } = await getPerfil(userId);
  
  try {
    let query = supabase.from('materias').delete().eq('id', id);
    if (institucion_id) {
      query = query.eq('institucion_id', institucion_id);
    }
    if (rol !== 'admin') {
      query = query.eq('profesor_id', userId);
    }
    const { error } = await query;
    if (error) throw error;
    res.json({ message: 'Materia eliminada' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ================= Funciones para gestionar estudiantes en materias =================
// (Verificar que la materia pertenezca a la institución del usuario)

const getEstudiantesByMateria = async (req, res) => {
  const { id } = req.params;
  const { institucion_id } = await getPerfil(req.user.id);
  
  // Verificar que la materia pertenezca a la institución del usuario
  const { data: materia, error: errMat } = await supabase
    .from('materias')
    .select('institucion_id')
    .eq('id', id)
    .single();
  if (errMat || (institucion_id && materia.institucion_id !== institucion_id)) {
    return res.status(403).json({ error: 'No tienes acceso a esta materia' });
  }
  
  try {
    const { data, error } = await supabase
      .from('materia_estudiantes')
      .select('estudiante_cedula, estudiantes(*)')
      .eq('materia_id', id);
    if (error) throw error;
    res.json(data.map(item => item.estudiantes));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const addEstudiantesToMateria = async (req, res) => {
  const { id } = req.params;
  const { cedulas } = req.body;
  const { institucion_id } = await getPerfil(req.user.id);
  
  // Verificar que la materia pertenezca a la institución del usuario
  const { data: materia, error: errMat } = await supabase
    .from('materias')
    .select('institucion_id')
    .eq('id', id)
    .single();
  if (errMat || (institucion_id && materia.institucion_id !== institucion_id)) {
    return res.status(403).json({ error: 'No tienes acceso a esta materia' });
  }
  
  try {
    const inserts = cedulas.map(cedula => ({ materia_id: id, estudiante_cedula: cedula }));
    const { error } = await supabase.from('materia_estudiantes').insert(inserts);
    if (error) throw error;
    res.json({ message: 'Estudiantes agregados' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const removeEstudianteFromMateria = async (req, res) => {
  const { id, cedula } = req.params;
  const { institucion_id } = await getPerfil(req.user.id);
  
  // Verificar que la materia pertenezca a la institución del usuario
  const { data: materia, error: errMat } = await supabase
    .from('materias')
    .select('institucion_id')
    .eq('id', id)
    .single();
  if (errMat || (institucion_id && materia.institucion_id !== institucion_id)) {
    return res.status(403).json({ error: 'No tienes acceso a esta materia' });
  }
  
  try {
    const { error } = await supabase
      .from('materia_estudiantes')
      .delete()
      .eq('materia_id', id)
      .eq('estudiante_cedula', cedula);
    if (error) throw error;
    res.json({ message: 'Estudiante removido' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getMaterias,
  createMateria,
  updateMateria,
  deleteMateria,
  getEstudiantesByMateria,
  addEstudiantesToMateria,
  removeEstudianteFromMateria
};
