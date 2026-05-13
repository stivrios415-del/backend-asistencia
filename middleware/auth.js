const { supabase } = require('../config/supabase');

// ============================================
// VERIFICAR TOKEN
// Busca el usuario en profesores primero,
// luego en usuarios (padres), para soportar ambos roles.
// ============================================
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

    // 1. Buscar en tabla profesores (admin y profesores)
    const { data: profesorDB } = await supabase
      .from('profesores')
      .select('id, rol, institucion_id')
      .eq('id', user.id)
      .maybeSingle();

    if (profesorDB) {
      req.user = {
        id: profesorDB.id,
        email: user.email,
        rol: profesorDB.rol,
        institucion_id: profesorDB.institucion_id
      };
      return next();
    }

    // 2. Buscar en tabla usuarios (padres y otros)
    const { data: usuarioDB } = await supabase
      .from('usuarios')
      .select('id, rol, institucion_id')
      .eq('id', user.id)
      .maybeSingle();

    if (usuarioDB) {
      req.user = {
        id: usuarioDB.id,
        email: user.email,
        rol: usuarioDB.rol,
        institucion_id: usuarioDB.institucion_id
      };
      return next();
    }

    return res.status(401).json({ error: 'Usuario no registrado en el sistema' });

  } catch (error) {
    console.error('Error en verificarToken:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ============================================
// VERIFICAR ADMIN (incluye verificarToken)
// ============================================
const verificarAdmin = async (req, res, next) => {
  await verificarToken(req, res, () => {
    if (req.user?.rol !== 'admin') {
      return res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de administrador.' });
    }
    next();
  });
};

// ============================================
// VERIFICAR PROFESOR (incluye verificarToken)
// Permite admin y profesor
// ============================================
const verificarProfesor = async (req, res, next) => {
  await verificarToken(req, res, () => {
    if (req.user?.rol !== 'profesor' && req.user?.rol !== 'admin') {
      return res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de profesor.' });
    }
    next();
  });
};

// ============================================
// VERIFICAR PADRE (solo verifica rol, token va aparte)
// ============================================
const verificarPadre = (req, res, next) => {
  if (req.user?.rol !== 'padre') {
    return res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de padre.' });
  }
  next();
};

// ============================================
// VERIFICAR ROL ESPECÍFICO
// ============================================
const verificarRol = (rolesPermitidos) => {
  return (req, res, next) => {
    if (!rolesPermitidos.includes(req.user?.rol)) {
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
