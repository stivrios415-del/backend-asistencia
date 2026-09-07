// routes/reportesPdf.js
const express = require('express');
const router = express.Router();

const {
  exportarReportePDF,
  exportarReportePDFRango
} = require('../controllers/reportesPdfController');

// Ajusta esta línea al nombre real de tu middleware de autenticación
// (el que le pone req.user.institucion_id a la request)
const { verificarToken } = require('../middleware/auth');

// GET /api/reportes-pdf/diario?fecha=YYYY-MM-DD&profesorEmail=...&nombreProfesor=...
router.get('/diario', verificarToken, exportarReportePDF);

// GET /api/reportes-pdf/rango?fechaInicio=...&fechaFin=...&profesorEmail=...
router.get('/rango', verificarToken, exportarReportePDFRango);

module.exports = router;