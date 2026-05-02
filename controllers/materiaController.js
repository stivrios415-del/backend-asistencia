const supabase = require('../config/supabase');

// Función auxiliar para verificar si el usuario autenticado es administrador
async function esAdmin(userId) {
  const { data, error } = await supabase
    .from('profesores')
    .select('rol')
    .eq('id', userId)
    .single();
  if (error) return false;
  return data?.rol === 'admin';
}

// Obtener materias (todas si es admin, solo las suyas si es profesor)
const getMaterias = async (req, res) => {
  try {
    const userId = req.user.id;
    const admin = await esAdmin(userId);
    
    let query = supabase.from('materias').select('*');
    if (!admin) {
      query = query.eq('profesor_id', userId);
    }
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Crear materia (permitir asignar profesor_id si es admin)
const createMateria = async (req, res) => {
  const { nombre, descripcion, grado, seccion, carrera, ciclo, profesor_id } = req.body;
  const userId = req.user.id;
  const admin = await esAdmin(userId);
  
  // Determinar a quién se asigna la materia
  let asignadoA = profesor_id;
  if (!admin) {
    // Un profesor común solo puede crear materias para sí mismo
    asignadoA = userId;
  } else if (!asignadoA) {
    // Admin no especificó profesor_id: asignar a sí mismo? Lo dejamos vacío (sin profesor)
    asignadoA = null;
  }
  
  try {
    const { data, error } = await supabase
      .from('materias')
      .insert([{ 
        profesor_id: asignadoA, 
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

// Actualizar materia (admin puede actualizar cualquier materia, profesor solo la suya)
const updateMateria = async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const userId = req.user.id;
  const admin = await esAdmin(userId);
  
  try {
    let query = supabase.from('materias').update(updates).eq('id', id);
    if (!admin) {
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

// Eliminar materia (admin puede eliminar cualquier materia, profesor solo la suya)
const deleteMateria = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const admin = await esAdmin(userId);
  
  try {
    let query = supabase.from('materias').delete().eq('id', id);
    if (!admin) {
      query = query.eq('profesor_id', userId);
    }
    const { error } = await query;
    if (error) throw error;
    res.json({ message: 'Materia eliminada' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Las siguientes funciones no necesitan cambios (gestionan estudiantes por materia)
const getEstudiantesByMateria = async (req, res) => {
  const { id } = req.params;
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
