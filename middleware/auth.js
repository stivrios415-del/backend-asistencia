const crypto = require('crypto');
const { supabase, supabaseAuth } = require('../config/supabase');

// ============================================
// SEGURIDAD: Cache de tokens validados
// TTL 5 minutos. Clave = hash SHA-256 del token
// completo (nunca un prefijo — ver nota historica
// mas abajo).
// ============================================
const tokenCache = new Map();
const TOKEN_CACHE_TTL = 5 * 60 * 1000;

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of tokenCache.entries()) {
    if (now > v.expira) tokenCache.delete(k);
  }
}, 2 * 60 * 1000);

// ============================================
// VERIFICAR TOKEN
//
// FIX CRITICO (2026-08-05): antes esta funcion buscaba
// el perfil del usuario en la tabla 'usuarios', pero esa
// tabla es una tabla vieja/distinta — las cuentas reales
// (admin, profesores) viven en la tabla 'profesores'.
// Por eso CUALQUIER ruta protegida con verificarToken
// devolvia 401 siempre, mientras que las rutas de
// routes/admin.js (que tenian su propia logica separada
// consultando 'profesores') si funcionaban.
//
// Ahora verificarToken consulta 'profesores', que es la
// fuente de verdad real, unificando el comportamiento en
// TODAS las rutas protegidas.
// ============================================
const verificarToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No autorizado - Token no proporcionado' });
    }

    const token = authHeader.split(' ')[1];

    if (!token || token.length < 20 || token.split('.').length !== 3) {
      return res.status(401).json({ error: 'Token invalido' });
    }

    // -- Verificar cache primero (clave = hash del token completo) --
    const tokenKey = hashToken(token);
    const cached   = tokenCache.get(tokenKey);
    if (cached && Date.now() < cached.expira) {
      req.user = cached.user;
      return next();
    }

    // -- Verificar con Supabase (cliente anon, NO service_role) --
    const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Token invalido o expirado' });
    }

    // -- Verificar perfil en la tabla 'profesores' (fuente real) --
    // Nota: se busca por id (uuid de Supabase Auth), no por email,
    // igual que hacia routes/admin.js — es mas robusto ante cambios
    // de email y evita ambiguedad si dos filas compartieran email.
    const { data: perfilDB, error: perfilError } = await supabase
      .from('profesores')
      .select('id, rol, institucion_id, activo')
      .eq('id', user.id)
      .single();

    if (perfilError || !perfilDB) {
      return res.status(401).json({ error: 'Usuario no registrado en el sistema' });
    }

    if (perfilDB.activo === false) {
      return res.status(403).json({ error: 'Cuenta desactivada. Contacta al administrador.' });
    }

    const userData = {
      id:             perfilDB.id,
      email:          user.email,
      rol:            perfilDB.rol,
      institucion_id: perfilDB.institucion_id,
    };

    tokenCache.set(tokenKey, { user: userData, expira: Date.now() + TOKEN_CACHE_TTL });

    req.user = userData;
    next();
  } catch (error) {
    console.error('Error en verificarToken:', error.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ============================================
// VERIFICAR ADMIN
// ============================================
const verificarAdmin = (req, res, next) => {
  if (req.user?.rol !== 'admin') {
    console.warn(`🚨 Acceso denegado admin — usuario: ${req.user?.email} rol: ${req.user?.rol}`);
    return res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de administrador.' });
  }
  next();
};

// ============================================
// VERIFICAR PROFESOR
// ============================================
const verificarProfesor = [
  verificarToken,
  (req, res, next) => {
    if (req.user?.rol !== 'profesor' && req.user?.rol !== 'admin') {
      console.warn(`🚨 Acceso denegado profesor — usuario: ${req.user?.email} rol: ${req.user?.rol}`);
      return res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de profesor.' });
    }
    next();
  }
];

// ============================================
// VERIFICAR PADRE
// ============================================
const verificarPadre = (req, res, next) => {
  if (req.user?.rol !== 'padre') {
    console.warn(`🚨 Acceso denegado padre — usuario: ${req.user?.email} rol: ${req.user?.rol}`);
    return res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de padre.' });
  }
  next();
};

// ============================================
// VERIFICAR MISMA INSTITUCION
// ============================================
const verificarInstitucion = (req, res, next) => {
  const institucionReq = req.params.institucion_id || req.query.institucion_id || req.body.institucion_id;
  if (institucionReq && req.user?.institucion_id &&
      institucionReq !== req.user.institucion_id) {
    console.warn(`🚨 Intento de acceso a otra institucion — usuario: ${req.user?.email}`);
    return res.status(403).json({ error: 'Acceso denegado. No puedes acceder a datos de otra institucion.' });
  }
  next();
};

// ============================================
// VERIFICAR ROL ESPECIFICO
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

// ============================================
// INVALIDAR TOKEN DEL CACHE
// ============================================
const invalidarTokenCache = (token) => {
  if (token) {
    tokenCache.delete(hashToken(token));
  }
};

module.exports = {
  verificarToken,
  verificarAdmin,
  verificarProfesor,
  verificarPadre,
  verificarInstitucion,
  verificarRol,
  invalidarTokenCache,
};
