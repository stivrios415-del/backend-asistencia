const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { supabase } = require('../config/supabase'); // ← fix aquí

const verificarAdmin = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'No autorizado' });

  const { data: perfil, error: perfilError } = await supabase
    .from('profesores')
    .select('rol, institucion_id')
    .eq('id', user.id)
    .single();

  if (perfilError || perfil?.rol !== 'admin') {
    return res.status(403).json({ error: 'Se requiere rol de administrador' });
  }

  req.user = user;
  req.user.rol = perfil.rol;
  req.user.institucion_id = perfil.institucion_id;
  next();
};

router.get('/profesores', verificarAdmin, adminController.getProfesores);
router.post('/profesores', verificarAdmin, adminController.registrarProfesor);
router.put('/profesores/:id/toggle', verificarAdmin, adminController.toggleActivoProfesor);

module.exports = router;
