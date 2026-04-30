const supabase = require('../config/supabase');

const verificarProfesor = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'No autorizado' });
  
  const { data: perfil, error: perfilError } = await supabase
    .from('profesores')
    .select('rol')
    .eq('id', user.id)
    .single();
  
  if (perfilError || (perfil?.rol !== 'profesor' && perfil?.rol !== 'admin')) {
    return res.status(403).json({ error: 'Se requiere rol de profesor' });
  }
  req.user = user;
  next();
};

module.exports = { verificarProfesor };
