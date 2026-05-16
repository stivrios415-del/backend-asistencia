require('dotenv').config();
process.env.TZ = 'America/Tegucigalpa';

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// MIDDLEWARES GLOBALES (orden correcto)
// ============================================
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Logger
app.use((req, res, next) => {
  console.log(`📢 [${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ============================================
// HEALTH CHECK (única definición)
// ============================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// IMPORTAR RUTAS
// ============================================
const estudiantesRoutes   = require('./routes/estudiantes');
const asistenciaRoutes    = require('./routes/asistencia');
const adminRoutes         = require('./routes/admin');
const materiasRoutes      = require('./routes/materias');
const institucionesRoutes = require('./routes/instituciones');
const authPadreRoutes     = require('./routes/authPadre');
const padresRoutes        = require('./routes/padres');
const excusasRoutes        = require('./routes/excusas');

// ============================================
// RUTAS
// ============================================
app.use('/api/estudiantes',  estudiantesRoutes);
app.use('/api/asistencia',   asistenciaRoutes);
app.use('/api/admin',        adminRoutes);
app.use('/api/materias',     materiasRoutes);
app.use('/api/instituciones',institucionesRoutes);
app.use('/api/auth-padre',   authPadreRoutes);
app.use('/api/padres',       padresRoutes);
app.use('/api/excusas', excusasRoutes);

// ============================================
// MANEJO DE ERRORES
// ============================================
app.use((err, req, res, next) => {
  console.error('❌ Error no manejado:', err.message);
  console.error(err.stack);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// Ruta no encontrada
app.use('*', (req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.originalUrl}` });
});

// ============================================
// INICIAR SERVIDOR
// ============================================
app.listen(PORT, () => {
  console.log(`\n🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📱 API disponible en: http://localhost:${PORT}/api`);
  console.log(`\n👨‍👩‍👧 Rutas de padres registradas:`);
  console.log(`   POST  /api/auth-padre/registro`);
  console.log(`   POST  /api/auth-padre/vincular-estudiante`);
  console.log(`   GET   /api/auth-padre/buscar-estudiante`);
  console.log(`   GET   /api/auth-padre/mis-estudiantes`);
  console.log(`   GET   /api/padres/hijos`);
  console.log(`   GET   /api/padres/asistencia/:estudianteId`);
  console.log(`   GET   /api/padres/estadisticas/:estudianteId`);
  console.log(`   GET   /api/padres/horarios/:estudianteId`);
  console.log(`   GET   /api/padres/alertas/:estudianteId`);
  console.log(`   PUT   /api/padres/alertas/:alertaId/leer`);
  console.log(`   GET   /api/padres/reporte/:estudianteId\n`);
});
