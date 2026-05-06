const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_KEY;        // ← usamos la variable SUPABASE_KEY como anon key
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Faltan variables de entorno: SUPABASE_URL o SUPABASE_KEY');
  process.exit(1);
}
if (!supabaseServiceKey) {
  console.warn('⚠️ SUPABASE_SERVICE_KEY no definida. No se podrán crear usuarios desde el panel de admin.');
}

console.log('🔌 Conectando a Supabase...');
console.log(`📡 URL: ${supabaseUrl}`);

// Cliente normal (anon) – para consultas de todos los controladores
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { headers: { 'x-application-name': 'asistencia-backend' } }
});

// Cliente de administración (service_role) – solo para crear usuarios
let supabaseAdmin = null;
if (supabaseServiceKey) {
  supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-application-name': 'asistencia-backend-admin' } }
  });
}

// Verificación rápida (opcional)
(async () => {
  const { error } = await supabase.from('estudiantes').select('count', { count: 'exact', head: true });
  if (error) {
    console.error('⚠️ No se pudo conectar a Supabase. Verifica URL y KEY.');
    console.error('   Detalle:', error.message);
  } else {
    console.log('✅ Conexión a Supabase exitosa');
  }
})();

module.exports = { supabase, supabaseAdmin };
