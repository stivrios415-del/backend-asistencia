const crypto = require('crypto');
const { supabase, supabaseAuth } = require('../config/supabase');

// ============================================
// SEGURIDAD: Cache de tokens validados
// Evita verificar el mismo token en cada req
// TTL 5 minutos
//
// FIX CRITICO: antes la clave de cache era
// token.substring(0, 32) — los primeros 32
// caracteres de un JWT son casi siempre el
// header codificado (alg + typ), que es IDENTICO
// para todos los usuarios de un mismo proyecto
// Supabase. Eso causaba colisiones: el token de
// un usuario podia recibir los datos cacheados
// de OTRO usuario (incluyendo su rol e institucion).
//
// Ahora se usa un hash SHA-256 del token COMPLETO
// como clave. Es unico por token, de largo fijo, y
// ademas evita guardar el token crudo en memoria.
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
// ============================================
const verificarToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // Validar formato del header
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No autorizado - Token no proporcionado' });
    }

    const token = authHeader.split(' ')[1];

    // Validar que el token no este vacio, sea demasiado corto,
    // o no tenga la estructura basica de un JWT (header.payload.firma)
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

    // -- Verificar con Supabase --
    // Usa supabaseAuth (anon key), NO supabase (service_role), para
    // validar el JWT del usuario. Mezclar service_role con auth.getUser()
    // puede causar fallos de validacion incorrectos.
    const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Token invalido o expirado' });
    }

    // -- Verificar en base de datos --
    // Aqui SI se usa 'supabase' (service_role): es una lectura de datos,
    // no una validacion de identidad, y necesita bypasear RLS.
    const { data: usuarioDB, error: dbError } = await supabase
      .from('usuarios')
      .select('id, rol, institucion_id, activo')
      .eq('email', user.email)
      .single();

    if (dbError || !usuarioDB) {
      return res.status(401).json({ error: 'Usuario no registrado en el sistema' });
    }

    // -- Verificar si el usuario esta activo --
    if (usuarioDB.activo === false) {
      return res.status(403).json({ error: 'Cuenta desactivada. Contacta al administrador.' });
    }

    const userData = {
      id:             usuarioDB.id,
      email:          user.email,
      rol:            usuarioDB.rol,
      institucion_id: usuarioDB.institucion_id,
    };

    // Guardar en cache bajo la clave unica (hash del token completo)
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
// Previene que un usuario acceda a datos
// de otra institucion aunque tenga token valido
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
// Llamar cuando el usuario hace logout
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
