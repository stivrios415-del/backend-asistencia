const supabase = require('../config/supabase');

// ========== OBTENER INSTITUCIÓN POR CÓDIGO ==========
const getInstitucionPorCodigo = async (req, res) => {
  const { codigo } = req.params;

  if (!codigo) {
    return res.status(400).json({ error: 'Código requerido' });
  }

  try {
    console.log('🔍 Buscando institución con código:', codigo.toUpperCase().trim());

    const { data, error } = await supabase
      .from('instituciones')
      .select('id, nombre, codigo, color_primario, color_secundario, logo_url, plan, activa')
      .eq('codigo', codigo.toUpperCase().trim())
      .single();

    console.log('📦 Resultado Supabase - data:', JSON.stringify(data));
    console.log('❌ Resultado Supabase - error:', JSON.stringify(error));

    if (error || !data) {
      return res.status(404).json({ error: 'Institución no encontrada', supabaseError: error?.message });
    }

    // Si tiene campo activa y está en false, rechazar
    if (data.activa === false) {
      return res.status(403).json({ error: 'Esta institución está inactiva' });
    }

    res.json({
      id: data.id,
      nombre: data.nombre,
      codigo: data.codigo,
      color_primario: data.color_primario || '#143C65',
      color_secundario: data.color_secundario || '#256D5B',
      logo_url: data.logo_url || null,
      plan: data.plan || 'basico',
    });
  } catch (error) {
    console.error('Error buscando institución:', error);
    res.status(500).json({ error: error.message });
  }
};

// ========== LISTAR TODAS LAS INSTITUCIONES (solo admin sistema) ==========
const listarInstituciones = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('instituciones')
      .select('*')
      .order('nombre', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ========== CREAR INSTITUCIÓN (solo admin sistema) ==========
const crearInstitucion = async (req, res) => {
  const { nombre, codigo, color_primario, color_secundario, logo_url, plan } = req.body;

  if (!nombre || !codigo) {
    return res.status(400).json({ error: 'Nombre y código son obligatorios' });
  }

  try {
    // Verificar que el código no exista
    const { data: existente } = await supabase
      .from('instituciones')
      .select('id')
      .eq('codigo', codigo.toUpperCase().trim())
      .single();

    if (existente) {
      return res.status(400).json({ error: 'Ya existe una institución con ese código' });
    }

    const { data, error } = await supabase
      .from('instituciones')
      .insert([{
        nombre,
        codigo: codigo.toUpperCase().trim(),
        color_primario: color_primario || '#143C65',
        color_secundario: color_secundario || '#256D5B',
        logo_url: logo_url || null,
        plan: plan || 'basico',
        activa: true,
      }])
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, institucion: data });
  } catch (error) {
    console.error('Error creando institución:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getInstitucionPorCodigo,
  listarInstituciones,
  crearInstitucion,
};
