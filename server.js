require('dotenv').config();
process.env.TZ = 'America/Tegucigalpa';

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// MIDDLEWARES GLOBALES
// ============================================
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Logger
app.use((req, res, next) => {
  console.log(`📢 [${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// RUTAS
// ============================================
app.use('/api/estudiantes',   require('./routes/estudiantes'));
app.use('/api/asistencia',    require('./routes/asistencia'));
app.use('/api/admin',         require('./routes/admin'));
app.use('/api/materias',      require('./routes/materias'));
app.use('/api/instituciones', require('./routes/instituciones'));
app.use('/api/auth-padre',    require('./routes/authPadre'));
app.use('/api/padres',        require('./routes/padres'));
app.use('/api/excusas',       require('./routes/excusas'));

// ============================================
// JOB DIARIO DE FALTAS
// ============================================
try {
  const { iniciarJobFaltas } = require('./jobs/notificarFaltasDiarias');
  iniciarJobFaltas();
} catch (e) {
  console.warn('⚠️ Job de faltas no iniciado:', e.message);
}

// ============================================
// MANEJO DE ERRORES
// ============================================
app.use((err, req, res, next) => {
  console.error('❌ Error no manejado:', err.message);
  console.error(err.stack);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// 404 sin wildcard (Express 5 no lo soporta)
app.use((req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.originalUrl}` });
});

// ============================================
// INICIAR SERVIDOR
// ============================================
app.listen(PORT, () => {
  console.log(`\n🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📱 API disponible en: http://localhost:${PORT}/api`);
  console.log(`\n📋 Rutas: estudiantes | asistencia | admin | materias`);
  console.log(`         instituciones | auth-padre | padres | excusas\n`);
});
