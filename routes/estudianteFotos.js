const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const router = express.Router();
const { supabase } = require('../config/supabase');
const { verificarToken, verificarAdmin } = require('../middleware/auth');

const BUCKET = 'fotos-estudiantes';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 1 } });

router.use(verificarToken, verificarAdmin);

router.post('/:cedula', (req, res, next) => {
  upload.single('foto')(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        error: err.code === 'LIMIT_FILE_SIZE' ? 'La foto pesa demasiado (máx. 1 MB)' : 'No se pudo leer la foto',
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    const { cedula } = req.params;
    if (!/^\d{5,20}$/.test(cedula)) return res.status(400).json({ error: 'Cédula inválida' });

    const f = req.file;
    if (!f) return res.status(400).json({ error: 'Falta la foto' });
    const esJpeg = f.buffer.length > 3 && f.buffer[0] === 0xFF && f.buffer[1] === 0xD8 && f.buffer[2] === 0xFF;
    if (!esJpeg) return res.status(400).json({ error: 'La foto debe ser JPEG' });

    const { data: est } = await supabase.from('estudiantes')
      .select('cedula, institucion_id, foto_url').eq('cedula', cedula).single();
    if (!est) return res.status(404).json({ error: 'Estudiante no encontrado' });
    const inst = req.user.institucion_id;
    if (inst && est.institucion_id && est.institucion_id !== inst) {
      return res.status(403).json({ error: 'Este estudiante pertenece a otra institución' });
    }

    const path = `${est.institucion_id || 'sin-institucion'}/${cedula}-${crypto.randomUUID()}.jpg`;
    const { error: errUp } = await supabase.storage.from(BUCKET)
      .upload(path, f.buffer, { contentType: 'image/jpeg', cacheControl: '31536000' });
    if (errUp) return res.status(500).json({ error: 'No se pudo guardar la foto: ' + errUp.message });

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    const { error: errUpd } = await supabase.from('estudiantes')
      .update({ foto_url: pub.publicUrl }).eq('cedula', cedula);
    if (errUpd) {
      await supabase.storage.from(BUCKET).remove([path]);
      return res.status(500).json({ error: 'No se pudo actualizar el estudiante: ' + errUpd.message });
    }

    // Borra la foto anterior si estaba en este bucket
    try {
      const marca = `/${BUCKET}/`;
      if (est.foto_url && est.foto_url.includes(marca)) {
        await supabase.storage.from(BUCKET).remove([decodeURIComponent(est.foto_url.split(marca)[1])]);
      }
    } catch { /* no es crítico */ }

    res.json({ success: true, foto_url: pub.publicUrl });
  } catch (e) {
    console.error('❌ foto estudiante:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;