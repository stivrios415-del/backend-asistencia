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
// Sin esto, req.ip devuelve la IP del proxy interno
// de Render, NO la IP real del cliente. Esto rompe
// por completo el rate limiting y la deteccion de
// abuso: todas las peticiones parecerian venir de
// la misma IP (o de una IP interna), haciendo que
// el bloqueo por IP nunca funcione como se espera.
// '1' = confiar en el primer proxy delante de la app
// (correcto para Render, que pone un solo proxy).
// ============================================
app.set('trust proxy', 1);

// ============================================
// SEGURIDAD: HEADERS HTTP (Helmet manual)
// Protege contra XSS, clickjacking, sniffing,
// fugas de referrer y de origen cruzado.
// ============================================
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options',    'nosniff');
  res.setHeader('X-Frame-Options',           'DENY');
  res.setHeader('X-XSS-Protection',          '1; mode=block');
  res.setHeader('Referrer-Policy',           'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy',        'camera=(), microphone=(), geolocation=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Evita que el navegador precargue DNS de enlaces externos (fuga leve de privacidad)
  res.setHeader('X-DNS-Prefetch-Control',    'off');
  // Bloquea que otras ventanas del mismo origen accedan a esta via window.opener
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // Evita que otros origenes incluyan tus recursos (imagenes, JSON) directamente
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  // Bloquea politicas de Flash/PDF cross-domain (legacy, pero gratis de cerrar)
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  // CSP minima: como esta API sirve JSON (no HTML dinamico), se restringe todo
  // por defecto. Si en el futuro sirves HTML propio desde /public, ajusta esto.
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.removeHeader('X-Powered-By'); // No revelar que es Express
  next();
});

// ============================================
// SEGURIDAD: CORS estricto
// Solo permite origenes conocidos — antes esta
// funcion ignoraba por completo la lista blanca
// y aceptaba CUALQUIER origen (bug critico).
// ============================================
const origenesPermitidos = [
  'https://backend-asistencia-nhny.onrender.com',
  'exp://',       // Expo Go
  'kairos://',    // Deep link de la app
  'http://localhost:5173',          // desarrollo web
   'http://127.0.0.1:5173',
  'https://kairos-six-omega.vercel.app',
];

app.use(cors({
  origin: (origin, callback) => {
    // Apps nativas (RN/Expo) y herramientas como curl/Postman no mandan
    // header Origin — se permiten porque no representan un navegador
    // ejecutando JS de un sitio de terceros.
    if (!origin) return callback(null, true);

    const permitido = origenesPermitidos.some((o) => origin.startsWith(o));
    if (permitido) return callback(null, true);

    console.warn(`🚨 CORS bloqueado para origen no autorizado: ${origin}`);
    return callback(new Error('No permitido por CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  // ✅ NUEVO: Se agregó 'X-Institucion-Id' a los headers permitidos
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Institucion-Id'],
  exposedHeaders: ['X-Cache', 'X-Request-ID'],
  credentials: true,
  maxAge: 86400,
}));

// ============================================
// SEGURIDAD: SANITIZAR INPUT
// Antes solo se sanitizaba req.query. Los campos
// de req.body (nombre, descripcion, etc.) llegaban
// sin filtrar — un profesor podria guardar un
// <script> en el nombre de una clase, que luego se
// renderiza en el panel admin (XSS almacenado) o en
// el Excel exportado.
// ============================================
const sanitizarString = (str) => {
  if (typeof str !== 'string') return str;
  return str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/[<>]/g, '')
    .trim()
    .substring(0, 500);
};

// Sanitiza recursivamente objetos/arrays anidados en el body,
// sin tocar tipos que no son string (numeros, booleanos, null).
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
// Ahora que 'trust proxy' esta configurado arriba,
// req.ip refleja la IP real del cliente y no la
// del proxy de Render — esto es lo que hace que
// este bloque realmente funcione en produccion.
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
// RATE LIMIT ESPECIAL: Auth endpoints
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

// Sanitizacion profunda del body — se aplica DESPUES del parser,
// porque antes de este punto req.body todavia no existe.
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
// Defensa en profundidad — Supabase ya usa
// queries parametrizadas, asi que esto es una
// capa extra, no la unica proteccion.
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
// HEALTH CHECK (sin datos sensibles)
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
// ✅ NUEVA RUTA: Importación de estudianteFotos
const estudianteFotosRoutes        = require('./routes/estudianteFotos'); 
const asistenciaRoutes             = require('./routes/asistencia');
const adminRoutes                  = require('./routes/admin');
const materiasRoutes               = require('./routes/materias');
const institucionesRoutes          = require('./routes/instituciones');
const authPadreRoutes              = require('./routes/authPadre');
const padresRoutes                 = require('./routes/padres');
const excusasRoutes                = require('./routes/excusas');
const profesorIndependienteRoutes  = require('./routes/profesorIndependiente');
const masterAdminRoutes            = require('./routes/masterAdmin'); // panel del dueno de la app (distinto del admin institucional)
// ✅ NUEVA RUTA: Importación de redRoutes
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
// ✅ NUEVA RUTA: Uso del endpoint estudiante-fotos
app.use('/api/estudiante-fotos', limitNormal, estudianteFotosRoutes); 
// ✅ NUEVA RUTA: Uso del endpoint red
app.use('/api/red', limitPub, redRoutes);

// Endpoints privados
app.use('/api/asistencia',    limitNormal, asistenciaRoutes);
app.use('/api/admin',         limitNormal, adminRoutes); // admin institucional (rol 'admin' en profesores)
app.use('/api/materias',      limitNormal, materiasRoutes);
app.use('/api/padres',        limitNormal, padresRoutes);
app.use('/api/excusas',       limitNormal, excusasRoutes);

// Rutas del profesor independiente (registro con rate limit auth, resto normal)
app.use('/api/profesor-independiente', limitNormal, profesorIndependienteRoutes);

// Panel del master admin (tu) — codigo secreto propio, prefijo separado.
// Este endpoint deberia tener rate limit MAS estricto que el normal,
// ya que un acceso exitoso da control total sobre instituciones.
app.use('/api/master-admin', limitAuth, masterAdminRoutes);

// PDF con rate limit de exportacion
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
// Se coloca ANTES del manejador de errores, siguiendo
// la convencion de Express: primero se agota la busqueda
// de rutas validas, y solo despues entra el manejo de errores.
// ============================================
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// ============================================
// MANEJO DE ERRORES GLOBAL
// Debe ser el ULTIMO app.use() del archivo.
// ============================================
app.use((err, req, res, next) => {
  const esProduccion = process.env.NODE_ENV === 'production';

  // El mensaje de CORS bloqueado no deberia tratarse como error 500
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
