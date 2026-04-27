const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

// Validación y logs más detallados
if (!supabaseUrl) {
  console.error('❌ FALTA: SUPABASE_URL no está definida en el archivo .env');
  process.exit(1);
}
if (!supabaseKey) {
  console.error('❌ FALTA: SUPABASE_KEY no está definida en el archivo .env');
  process.exit(1);
}

console.log('🔌 Conectando a Supabase...');
console.log(`📡 URL: ${supabaseUrl}`);
console.log(`🔑 Key: ${supabaseKey.substring(0, 15)}... (${supabaseKey.length} caracteres)`);

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,    // No guardar sesión en backend
    autoRefreshToken: false,  // No refrescar token automáticamente
    detectSessionInUrl: false
  },
  global: {
    headers: { 'x-application-name': 'asistencia-backend' }
  }
});

// Verificación rápida de conectividad (opcional)
(async () => {
  const { error } = await supabase.from('estudiantes').select('count', { count: 'exact', head: true });
  if (error) {
    console.error('⚠️ No se pudo conectar a Supabase. Verifica URL y KEY.');
    console.error('   Detalle:', error.message);
  } else {
    console.log('✅ Conexión a Supabase exitosa');
  }
})();

module.exports = supabase;