const { supabase } = require('../config/supabase');

// ========== OBTENER INSTITUCIÓN POR CÓDIGO ==========
const getInstitucionPorCodigo = async (req, res) => {
  const { codigo } = req.params;

  if (!codigo) {
    return res.status(400).json({ error: 'Código requerido' });
  }

  try {
    const codigoLimpio = codigo.toUpperCase().trim();
    console.log('🔍 Buscando institución con código:', codigoLimpio);

    const { data, error } = await supabase
      .from('instituciones')
      .select('id, nombre, codigo, color_primario, color_secundario, logo_url, plan, activa')
      .eq('codigo', codigoLimpio)
      .maybeSingle();

    if (error) {
      console.error('❌ Error Supabase en getInstitucionPorCodigo:', error.message);
      return res.status(500).json({ error: error.message });
    }

    if (!data) {
      console.log(`⚠️ Institución con código "${codigoLimpio}" no encontrada`);
      return res.status(404).json({ error: 'Institución no encontrada' });
    }

    if (data.activa === false) {
      console.log(`⚠️ Institución "${codigoLimpio}" está inactiva`);
      return res.status(403).json({ error: 'Esta institución está inactiva' });
    }

    console.log(`✅ Institución encontrada: ${data.nombre}`);
    res.json({
      id: data.id,
      nombre: data.nombre,
      codigo: data.codigo,
      color_primario: data.color_primario || '#143C65',
      color_secundario: data.color_secundario || '#256D5B',
      logo_url: data.logo_url || null,
      plan: data.plan || 'basico',
    });
  } catch (err) {
    console.error('❌ Excepción en getInstitucionPorCodigo:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ========== LISTAR TODAS LAS INSTITUCIONES ==========
const listarInstituciones = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('instituciones')
      .select('*')
      .order('nombre', { ascending: true });

    if (error) {
      console.error('❌ Error en listarInstituciones:', error.message);
      throw error;
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ========== CREAR INSTITUCIÓN ==========
const crearInstitucion = async (req, res) => {
  const { nombre, codigo, color_primario, color_secundario, logo_url, plan } = req.body;

  if (!nombre || !codigo) {
    return res.status(400).json({ error: 'Nombre y código son obligatorios' });
  }

  try {
    const codigoLimpio = codigo.toUpperCase().trim();

    const { data: existente } = await supabase
      .from('instituciones')
      .select('id')
      .eq('codigo', codigoLimpio)
      .single();

    if (existente) {
      return res.status(400).json({ error: 'Ya existe una institución con ese código' });
    }

    const { data, error } = await supabase
      .from('instituciones')
      .insert([{
        nombre,
        codigo: codigoLimpio,
        color_primario: color_primario || '#143C65',
        color_secundario: color_secundario || '#256D5B',
        logo_url: logo_url || null,
        plan: plan || 'basico',
        activa: true,
      }])
      .select()
      .single();

    if (error) {
      console.error('❌ Error en crearInstitucion:', error.message);
      throw error;
    }

    console.log(`✅ Institución creada: ${nombre} (${codigoLimpio})`);
    res.json({ success: true, institucion: data });
  } catch (err) {
    console.error('❌ Excepción en crearInstitucion:', err.message);
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getInstitucionPorCodigo,
  listarInstituciones,
  crearInstitucion,
};
