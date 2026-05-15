const express = require('express');
const router = express.Router();
const { verificarToken, verificarPadre, verificarProfesor } = require('../middleware/auth');
const {
  subirExcusa,
  getMisExcusas,
  getExcusasAdmin,
  actualizarEstadoExcusa
} = require('../controllers/excusasController');

// ── Rutas para padres ──────────────────────
router.post('/',     verificarToken, verificarPadre, subirExcusa);
router.get('/mias',  verificarToken, verificarPadre, getMisExcusas);

// ── Rutas para admin/profesor ──────────────
router.get('/',          verificarProfesor, getExcusasAdmin);
router.put('/:id/estado', verificarProfesor, actualizarEstadoExcusa);

module.exports = router;