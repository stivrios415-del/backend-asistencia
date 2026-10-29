require('dotenv').config();
process.env.TZ = 'America/Tegucigalpa';

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

// ============================================
// FAIL-FAST: variables de entorno criticas
// Si falta una clave critica, el servidor NO arranca.
// Mejor un crash claro en el deploy que un servidor
// corriendo a medias con Supabase mal configurado.
// ============================================
const ENV_REQUERIDAS = ['SUPABASE_URL', 'SUPABASE_KEY'];
const faltantes = ENV_REQUERIDAS.filter((k) => !process.env[k]);
if (faltantes.length > 0) {
  console.error(`❌ Faltan variables de entorno criticas: ${faltantes.join(', ')}`);
  process.exit(1);
}
if (!process.env.SUPABASE_SERVICE_KEY) {
  console.warn('⚠️ SUPABASE_SERVICE_KEY no configurada — funciones de administrador (crear profesores, etc.) fallaran.');
}

// ============================================
// CONFIAR EN EL PROXY DE RENDER
// ============================================
app.set('trust proxy', 1);

// ============================================
// SEGURIDAD: HEADERS HTTP (Helmet manual)
// ============================================
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options',    'nosniff');
  res.setHeader('X-Frame-Options',           'DENY');
  res.setHeader('X-XSS-Protection',          '1; mode=block');
  res.setHeader('Referrer-Policy',           'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy',        'camera=(), microphone=(), geolocation=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-DNS-Prefetch-Control',    'off');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.removeHeader('X-Powered-By');
  next();
});

// ============================================
// SEGURIDAD: CORS estricto
// ============================================
const origenesPermitidos = [
  'https://backend-asistencia-nhny.onrender.com',
  'exp://',
  'kairos://',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://kairos-six-omega.vercel.app',
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const permitido = origenesPermitidos.some((o) => origin.startsWith(o));
    if (permitido) return callback(null, true);
    console.warn(`🚨 CORS bloqueado para origen no autorizado: ${origin}`);
    return callback(new Error('No permitido por CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Institucion-Id'],
  exposedHeaders: ['X-Cache', 'X-Request-ID'],
  credentials: true,
  maxAge: 86400,
}));

// ============================================
// SEGURIDAD: SANITIZAR INPUT
// ============================================
const sanitizarString = (str) => {
  if (typeof str !== 'string') return str;
  return str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/[<>]/g, '')
    .trim()
    .substring(0, 500);
};

const sanitizarProfundo = (valor) => {
  if (typeof valor === 'string') return sanitizarString(valor);
  if (Array.isArray(valor)) return valor.map(sanitizarProfundo);
  if (valor && typeof valor === 'object') {
    const limpio = {};
    for (const key of Object.keys(valor)) {
      limpio[key] = sanitizarProfundo(valor[key]);
    }
    return limpio;
  }
  return valor;
};

app.use((req, res, next) => {
  for (const key of Object.keys(req.query)) {
    if (typeof req.query[key] === 'string') {
      req.query[key] = sanitizarString(req.query[key]);
    }
  }
  next();
});

// ============================================
// SEGURIDAD: REQUEST ID para trazabilidad
// ============================================
app.use((req, res, next) => {
  const requestId = crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
});

// ============================================
// CACHE EN MEMORIA
// ============================================
const cache = new Map();
const cacheGet = (key) => {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expira) { cache.delete(key); return null; }
  return item.valor;
};
const cacheSet = (key, valor, seg = 30) => {
  cache.set(key, { valor, expira: Date.now() + seg * 1000 });
};
const cacheDel = (prefix) => {
  for (const key of cache.keys()) { if (key.startsWith(prefix)) cache.delete(key); }
};
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache.entries()) { if (now > v.expira) cache.delete(k); }
}, 5 * 60 * 1000);
app.locals.cache = { get: cacheGet, set: cacheSet, del: cacheDel };

// ============================================
// RATE LIMITING con deteccion de abuso
// ============================================
const rateLimitMap  = new Map();
const abusoMap      = new Map();
const BLOQUEO_MS    = 15 * 60 * 1000;

const rateLimit = (maxReq = 100, ventanaMs = 60000) => (req, res, next) => {
  const ip  = req.ip || req.connection.remoteAddress;
  const key = ip + ':' + req.path;
  const now = Date.now();

  const bloqueo = abusoMap.get(ip);
  if (bloqueo && now < bloqueo) {
    return res.status(429).json({
      error: 'IP bloqueada temporalmente por exceso de peticiones.',
      reintentarEn: Math.ceil((bloqueo - now) / 1000) + ' segundos'
    });
  }

  const registro = rateLimitMap.get(key) || { count: 0, reset: now + ventanaMs };
  if (now > registro.reset) { registro.count = 0; registro.reset = now + ventanaMs; }
  registro.count++;
  rateLimitMap.set(key, registro);

  if (registro.count > maxReq * 3) {
    abusoMap.set(ip, now + BLOQUEO_MS);
    console.warn(`🚨 IP bloqueada por abuso: ${ip} (${registro.count} peticiones)`);
    return res.status(429).json({ error: 'IP bloqueada por abuso. Intenta en 15 minutos.' });
  }

  if (registro.count > maxReq) {
    res.setHeader('Retry-After', Math.ceil(ventanaMs / 1000));
    return res.status(429).json({
      error: 'Demasiadas peticiones. Intenta en un momento.',
      reintentarEn: Math.ceil((registro.reset - now) / 1000) + ' segundos'
    });
  }

  next();
};

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitMap.entries()) { if (now > v.reset) rateLimitMap.delete(k); }
  for (const [k, v] of abusoMap.entries())     { if (now > v) abusoMap.delete(k); }
}, 5 * 60 * 1000);

// ============================================
// RATE LIMIT ESPECIAL
// ============================================
const limitAuth   = rateLimit(5,   60000);
const limitExcel  = rateLimit(10,  60000);
const limitNormal = rateLimit(200, 60000);
const limitPub    = rateLimit(50,  60000);

// ============================================
// BODY PARSER con limites de tamano
// ============================================
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizarProfundo(req.body);
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// LOGGER mejorado con IP y Request ID
// ============================================
app.use((req, res, next) => {
  const ip    = req.ip || req.connection.remoteAddress;
  const start = Date.now();
  res.on('finish', () => {
    const ms     = Date.now() - start;
    const status = res.statusCode;
    const color  = status >= 500 ? '❌' : status >= 400 ? '⚠️' : '📢';
    console.log(`${color} [${new Date().toISOString()}] ${req.method} ${req.url} ${status} ${ms}ms IP:${ip} ID:${req.requestId}`);
  });
  next();
});

// ============================================
// SEGURIDAD: Detectar inyeccion SQL basica
// ============================================
const patronesSQL = [
  /(\bUNION\b|\bSELECT\b|\bDROP\b|\bINSERT\b|\bDELETE\b|\bUPDATE\b)/i,
  /(--|;|\/\*|\*\/)/,
  /(\bOR\b|\bAND\b)\s+[\d'"]+=[\d'"]+/i,
];
app.use((req, res, next) => {
  const contenido = JSON.stringify({ ...req.query, ...req.body });
  for (const patron of patronesSQL) {
    if (patron.test(contenido)) {
      console.warn(`🚨 Posible inyeccion SQL detectada — IP: ${req.ip} URL: ${req.url}`);
      return res.status(400).json({ error: 'Peticion invalida' });
    }
  }
  next();
});

// ============================================
// SEGURIDAD: No Cache en respuestas sensibles
// ============================================
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (data) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    return originalJson(data);
  };
  next();
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

// ============================================
// RUTAS
// ============================================
const estudiantesRoutes            = require('./routes/estudiantes');
const estudianteFotosRoutes        = require('./routes/estudianteFotos'); 
const asistenciaRoutes             = require('./routes/asistencia');
const adminRoutes                  = require('./routes/admin');
const materiasRoutes               = require('./routes/materias');
const institucionesRoutes          = require('./routes/instituciones');
const authPadreRoutes              = require('./routes/authPadre');
const padresRoutes                 = require('./routes/padres');
const excusasRoutes                = require('./routes/excusas');
const profesorIndependienteRoutes  = require('./routes/profesorIndependiente');
const masterAdminRoutes            = require('./routes/masterAdmin');
const redRoutes                    = require('./routes/red'); 

let reportesPdfRoutes = null;
try {
  reportesPdfRoutes = require('./routes/reportesPdf');
} catch (e) {
  console.warn('⚠️ reportesPdf no disponible:', e.message);
}

// Auth con rate limit estricto
app.use('/api/auth-padre',    limitAuth,   authPadreRoutes);

// Endpoints publicos
app.use('/api/instituciones', limitPub,    institucionesRoutes);
app.use('/api/estudiantes',   limitNormal, estudiantesRoutes);
app.use('/api/estudiante-fotos', limitNormal, estudianteFotosRoutes); 

// ✅ AQUÍ ESTÁ EL CAMBIO: limitPub -> limitNormal
app.use('/api/red', limitNormal, redRoutes);

// Endpoints privados
app.use('/api/asistencia',    limitNormal, asistenciaRoutes);
app.use('/api/admin',         limitNormal, adminRoutes);
app.use('/api/materias',      limitNormal, materiasRoutes);
app.use('/api/padres',        limitNormal, padresRoutes);
app.use('/api/excusas',       limitNormal, excusasRoutes);

app.use('/api/profesor-independiente', limitNormal, profesorIndependienteRoutes);
app.use('/api/master-admin', limitAuth, masterAdminRoutes);

if (reportesPdfRoutes) {
  app.use('/api/reportes-pdf', limitExcel, reportesPdfRoutes);
}

// ============================================
// JOB DIARIO DE FALTAS
// ============================================
try {
  const { iniciarJobFaltas } = require('./jobs/notificarFaltasDiarias');
  iniciarJobFaltas();
} catch (e) { console.warn('⚠️ Job de faltas no iniciado:', e.message); }

// ============================================
// 404 — rutas no encontradas
// ============================================
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// ============================================
// MANEJO DE ERRORES GLOBAL
// ============================================
app.use((err, req, res, next) => {
  const esProduccion = process.env.NODE_ENV === 'production';
  const status = err.status || (err.message === 'No permitido por CORS' ? 403 : 500);

  console.error(`❌ Error [${req.requestId}]:`, err.message, esProduccion ? '' : err.stack);
  res.status(status).json({
    error: esProduccion ? 'Error interno del servidor' : err.message,
    requestId: req.requestId,
  });
});

// ============================================
// INICIAR SERVIDOR
// ============================================
app.listen(PORT, () => {
  console.log(`\n🚀 Servidor en puerto ${PORT}`);
  console.log(`🔒 Modo: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📋 Rutas: estudiantes | asistencia | admin | materias`);
  console.log(`         instituciones | auth-padre | padres | excusas | profesor-independiente | master-admin | red\n`);
});
