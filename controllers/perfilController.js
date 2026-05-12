// perfilController.js
const supabase = require('../config/supabase');

const getPerfil = async (req, res) => {
  const userId = req.user.id;
  
  // Obtener profesor junto con su institución
  const { data, error } = await supabase
    .from('profesores')
    .select(`
      id,
      nombre,
      email,
      rol,
      institucion_id,
      instituciones (
        id,
        nombre,
        codigo,
        color_primario,
        color_secundario,
        logo_url,
        plan
      )
    `)
    .eq('id', userId)
    .single();
    
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Perfil no encontrado' });
  
  res.json({
    usuario: {
      id: data.id,
      nombre: data.nombre,
      email: data.email,
      rol: data.rol
    },
    institucion: data.instituciones
  });
};

module.exports = { getPerfil };