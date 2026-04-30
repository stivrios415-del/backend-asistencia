const supabase = require('../config/supabase');

// Obtener todas las materias del profesor autenticado
const getMaterias = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('materias')
      .select('*')
      .eq('profesor_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Crear nueva materia
const createMateria = async (req, res) => {
  const { nombre, descripcion, grado, seccion, carrera } = req.body;
  try {
    const { data, error } = await supabase
      .from('materias')
      .insert([{ profesor_id: req.user.id, nombre, descripcion, grado, seccion, carrera }])
      .select();
    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Actualizar materia
const updateMateria = async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  try {
    const { data, error } = await supabase
      .from('materias')
      .update(updates)
      .eq('id', id)
      .eq('profesor_id', req.user.id)
      .select();
    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Eliminar materia
const deleteMateria = async (req, res) => {
  const { id } = req.params;
  try {
    const { error } = await supabase
      .from('materias')
      .delete()
      .eq('id', id)
      .eq('profesor_id', req.user.id);
    if (error) throw error;
    res.json({ message: 'Materia eliminada' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Obtener estudiantes de una materia
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

// Agregar estudiantes a una materia
const addEstudiantesToMateria = async (req, res) => {
  const { id } = req.params;
  const { cedulas } = req.body; // array de cédulas
  try {
    const inserts = cedulas.map(cedula => ({ materia_id: id, estudiante_cedula: cedula }));
    const { error } = await supabase.from('materia_estudiantes').insert(inserts);
    if (error) throw error;
    res.json({ message: 'Estudiantes agregados' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Remover estudiante de una materia
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