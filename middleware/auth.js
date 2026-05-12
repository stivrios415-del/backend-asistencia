const { supabase } = require('../config/supabase');

// Verificar token y obtener usuario
const verificarToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No autorizado - Token no proporcionado' });
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }

    // Obtener rol del usuario desde la tabla usuarios
    const { data: usuarioDB, error: dbError } = await supabase
      .from('usuarios')
      .select('id, rol, institucion_id')
      .eq('email', user.email)
      .single();

    if (dbError || !usuarioDB) {
      return res.status(401).json({ error: 'Usuario no registrado en el sistema' });
    }

    req.user = {
      id: usuarioDB.id,
      email: user.email,
      rol: usuarioDB.rol,
      institucion_id: usuarioDB.institucion_id
    };

    next();
  } catch (error) {
    console.error('Error en verificarToken:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// Verificar que sea administrador
const verificarAdmin = (req, res, next) => {
  if (req.user.rol !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de administrador.' });
  }
  next();
};

// Verificar que sea profesor
const verificarProfesor = (req, res, next) => {
  if (req.user.rol !== 'profesor') {
    return res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de profesor.' });
  }
  next();
};

// Verificar que sea padre
const verificarPadre = (req, res, next) => {
  if (req.user.rol !== 'padre') {
    return res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de padre.' });
  }
  next();
};

// Verificar rol específico
const verificarRol = (rolesPermitidos) => {
  return (req, res, next) => {
    if (!rolesPermitidos.includes(req.user.rol)) {
      return res.status(403).json({ 
        error: `Acceso denegado. Roles permitidos: ${rolesPermitidos.join(', ')}` 
      });
    }
    next();
  };
};

module.exports = {
  verificarToken,
  verificarAdmin,
  verificarProfesor,
  verificarPadre,
  verificarRol
};
