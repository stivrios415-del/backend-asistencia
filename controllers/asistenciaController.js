const { supabase } = require('../config/supabase');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { notificarTardanza } = require('../services/notificacionService');

const HORA_LIMITE_TARDANZA = '07:30';

// ========== HELPER: escapar XML ==========
function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ========== HELPER: obtener datos de institución ==========
async function obtenerInstitucion(institucion_id) {
  if (!institucion_id) return { nombre: 'Sistema de Asistencia', color_primario: '#143C65', color_secundario: '#256D5B' };
  const { data, error } = await supabase.from('instituciones')
    .select('nombre, color_primario, color_secundario, logo_url').eq('id', institucion_id).single();
  if (error || !data) return { nombre: 'Sistema de Asistencia', color_primario: '#143C65', color_secundario: '#256D5B' };
  return data;
}

function hexToArgb(hex) { return `FF${hex.replace('#', '').toUpperCase()}`; }

// ========== HELPER: gráfica de barras ==========
function generarChartBarrasXml(series, titulo, colorPrimario = '143C65', colorSecundario = '256D5B') {
  const colores = [colorPrimario, 'E53E3E', colorSecundario, 'F18F01', 'A23B72'];
  const seriesXml = series.map((s, sIdx) => {
    const color = colores[sIdx % colores.length];
    const ptsCat = s.categorias.map((c, i) => `<c:pt idx="${i}"><c:v>${escapeXml(String(c))}</c:v></c:pt>`).join('');
    const ptsVal = s.valores.map((v, i) => `<c:pt idx="${i}"><c:v>${Number(v)}</c:v></c:pt>`).join('');
    return `<c:ser><c:idx val="${sIdx}"/><c:order val="${sIdx}"/>
      <c:tx><c:strRef><c:f/><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${escapeXml(s.nombre)}</c:v></c:pt></c:strCache></c:strRef></c:tx>
      <c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>
      <c:invertIfNegative val="0"/>
      <c:cat><c:strRef><c:f/><c:strCache><c:ptCount val="${s.categorias.length}"/>${ptsCat}</c:strCache></c:strRef></c:cat>
      <c:val><c:numRef><c:f/><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${s.valores.length}"/>${ptsVal}</c:numCache></c:numRef></c:val>
    </c:ser>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/>
    <a:p><a:pPr><a:defRPr b="1" sz="1400"/></a:pPr><a:r><a:rPr b="1"/><a:t>${escapeXml(titulo)}</a:t></a:r></a:p>
  </c:rich></c:tx><c:overlay val="0"/></c:title>
  <c:autoTitleDeleted val="0"/>
  <c:plotArea><c:layout/>
    <c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/><c:gapWidth val="150"/>
      ${seriesXml}<c:axId val="10001"/><c:axId val="10002"/>
    </c:barChart>
    <c:catAx><c:axId val="10001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/>
      <c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="0"/><c:tickLblPos val="nextTo"/>
      <c:spPr><a:ln><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></c:spPr>
      <c:txPr><a:bodyPr rot="-2700000" vert="horz"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900" b="0"/></a:pPr></a:p></c:txPr>
      <c:crossAx val="10002"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/>
    </c:catAx>
    <c:valAx><c:axId val="10002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/>
      <c:axPos val="l"/><c:numFmt formatCode="General" sourceLinked="0"/><c:tickLblPos val="nextTo"/>
      <c:crossAx val="10001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/>
    </c:valAx>
  </c:plotArea>
  <c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>
  <c:plotVisOnly val="1"/><c:dispBlanksAs val="zero"/>
  </c:chart></c:chartSpace>`;
}

// ========== HELPER: gráfica de pie ==========
function generarChartPieXml(categorias, valores, titulo) {
  const ptsCat = categorias.map((c, i) => `<c:pt idx="${i}"><c:v>${escapeXml(String(c))}</c:v></c:pt>`).join('');
  const ptsVal = valores.map((v, i) => `<c:pt idx="${i}"><c:v>${Number(v)}</c:v></c:pt>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/>
    <a:p><a:pPr><a:defRPr b="1" sz="1400"/></a:pPr><a:r><a:rPr b="1"/><a:t>${escapeXml(titulo)}</a:t></a:r></a:p>
  </c:rich></c:tx><c:overlay val="0"/></c:title>
  <c:autoTitleDeleted val="0"/>
  <c:plotArea><c:layout/>
    <c:pieChart><c:varyColors val="1"/>
      <c:ser><c:idx val="0"/><c:order val="0"/>
        <c:dLbls><c:numFmt formatCode="0%" sourceLinked="0"/><c:spPr><a:noFill/></c:spPr>
          <c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="1"/>
          <c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/><c:separator> - </c:separator>
        </c:dLbls>
        <c:cat><c:strRef><c:f/><c:strCache><c:ptCount val="${categorias.length}"/>${ptsCat}</c:strCache></c:strRef></c:cat>
        <c:val><c:numRef><c:f/><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${valores.length}"/>${ptsVal}</c:numCache></c:numRef></c:val>
      </c:ser>
    </c:pieChart>
  </c:plotArea>
  <c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend>
  <c:plotVisOnly val="1"/><c:dispBlanksAs val="zero"/>
  </c:chart></c:chartSpace>`;
}

// ========== HELPER: inyectar gráficas en xlsx ==========
async function inyectarGraficasEnXlsx(workbookBuffer, graficas) {
  const zip = await JSZip.loadAsync(workbookBuffer);
  let wbXml = await zip.file('xl/workbook.xml').async('string');
  let wbRels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  let contentTypes = await zip.file('[Content_Types].xml').async('string');
  const sheetMatches = wbXml.match(/<sheet /g) || [];
  let sheetCount = sheetMatches.length;
  let maxRId = (wbRels.match(/Id="rId(\d+)"/g) || []).reduce((max, m) => { const n = parseInt(m.match(/\d+/)[0]); return n > max ? n : max; }, 0);
  graficas.forEach((grafica, idx) => {
    sheetCount++; maxRId++;
    const chartId = idx + 1, drawingId = idx + 1, sheetId = sheetCount, rId = `rId${maxRId}`;
    const nombre = grafica.nombre || `Grafica${chartId}`;
    const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData/><drawing r:id="rId1"/></worksheet>`;
    const drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:absoluteAnchor><xdr:pos x="228600" y="228600"/><xdr:ext cx="9144000" cy="6858000"/><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${chartId+2}" name="Chart ${chartId}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="228600" y="228600"/><a:ext cx="9144000" cy="6858000"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:absoluteAnchor></xdr:wsDr>`;
    const drawingRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartId}.xml"/></Relationships>`;
    const sheetRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingId}.xml"/></Relationships>`;
    zip.file(`xl/charts/chart${chartId}.xml`, grafica.chartXml);
    zip.file(`xl/drawings/drawing${drawingId}.xml`, drawingXml);
    zip.file(`xl/drawings/_rels/drawing${drawingId}.xml.rels`, drawingRelsXml);
    zip.file(`xl/worksheets/sheet${sheetId}.xml`, sheetXml);
    zip.file(`xl/worksheets/_rels/sheet${sheetId}.xml.rels`, sheetRelsXml);
    wbXml = wbXml.replace('</sheets>', `<sheet name="${nombre}" sheetId="${sheetId}" r:id="${rId}"/></sheets>`);
    wbRels = wbRels.replace('</Relationships>', `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheetId}.xml"/></Relationships>`);
    contentTypes = contentTypes.replace('</Types>',
      `<Override PartName="/xl/worksheets/sheet${sheetId}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/charts/chart${chartId}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>` +
      `<Override PartName="/xl/drawings/drawing${drawingId}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
  });
  zip.file('xl/workbook.xml', wbXml); zip.file('xl/_rels/workbook.xml.rels', wbRels); zip.file('[Content_Types].xml', contentTypes);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function normalizarTexto(str) {
  if (!str) return '';
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

async function contarFaltasEnMes(cedula, año, mes) {
  const primerDia = new Date(año, mes - 1, 1).toISOString().split('T')[0];
  const hoy = new Date();
  const ultimoDia = (año === hoy.getFullYear() && mes === hoy.getMonth() + 1)
    ? hoy.toISOString().split('T')[0]
    : new Date(año, mes, 0).toISOString().split('T')[0];
  const { data, error } = await supabase.from('asistencia').select('fecha').eq('cedula', cedula)
    .gte('fecha', primerDia).lte('fecha', ultimoDia);
  if (error) return 0;
  const diasTotales = Math.ceil((new Date(ultimoDia) - new Date(primerDia)) / 86400000) + 1;
  const faltas = diasTotales - data.length;
  return faltas > 0 ? faltas : 0;
}

async function obtenerFiltrosProfesor(profesorEmail, institucion_id) {
  if (!profesorEmail || profesorEmail === 'all' || profesorEmail === '') return null;
  let { data: profesor } = await supabase.from('profesores').select('id, nombre').eq('email', profesorEmail.trim().toLowerCase()).single();
  if (!profesor) { const { data: p2 } = await supabase.from('profesores').select('id, nombre').eq('email', profesorEmail.trim()).single(); profesor = p2; }
  if (!profesor) return [];
  const { data: asignaciones } = await supabase.from('profesor_asignaciones').select('grado, carrera').eq('profesor_id', profesor.id);
  return asignaciones || [];
}

async function obtenerIdsMateriaProfesor(profesorEmail, institucion_id) {
  if (!profesorEmail || profesorEmail === 'all' || profesorEmail === '') return null;
  let { data: profesor } = await supabase.from('profesores').select('id').eq('email', profesorEmail.trim()).single();
  if (!profesor) { const { data: p2 } = await supabase.from('profesores').select('id').eq('email', profesorEmail.trim().toLowerCase()).single(); profesor = p2; }
  if (!profesor) return [];
  let q = supabase.from('materias').select('id').eq('profesor_id', profesor.id);
  if (institucion_id) q = q.eq('institucion_id', institucion_id);
  const { data: materias } = await q;
  return materias ? materias.map(m => m.id) : [];
}

async function obtenerEstudiantesFiltrados(filtros, institucion_id) {
  let q = supabase.from('estudiantes').select('cedula, nombre, apellido, grado, seccion, carrera').order('apellido', { ascending: true });
  if (institucion_id) q = q.eq('institucion_id', institucion_id);
  const { data, error } = await q;
  if (error) throw error;
  if (filtros === null) return data.filter(est => est.carrera && est.carrera.trim() !== '');
  if (filtros.length === 0) return [];
  return data.filter(est => {
    if (!est.carrera || est.carrera.trim() === '') return false;
    return filtros.some(f => normalizarTexto(String(f.grado)) === normalizarTexto(String(est.grado)) && normalizarTexto(f.carrera) === normalizarTexto(est.carrera));
  });
}

// ========== REGISTRAR ASISTENCIA ==========
const registrarAsistencia = async (req, res) => {
  const { cedula, materiaId } = req.body;
  const institucion_id = req.user.institucion_id;
  if (!cedula) return res.status(400).json({ error: 'Cédula no proporcionada' });
  if (!materiaId) return res.status(400).json({ error: 'Debe especificar la materia/clase' });
  const { data: materia, error: errMateria } = await supabase.from('materias').select('grado, carrera').eq('id', materiaId).single();
  if (errMateria || !materia) return res.status(404).json({ error: 'La clase seleccionada no existe' });
  const { data: estudiante, error: errEstudiante } = await supabase.from('estudiantes')
    .select('cedula, nombre, apellido, grado, seccion, carrera, foto_url').eq('cedula', cedula).single();
  if (errEstudiante || !estudiante) return res.status(404).json({ error: 'Estudiante no encontrado' });
  if (normalizarTexto(String(estudiante.grado)) !== normalizarTexto(String(materia.grado)) ||
      normalizarTexto(estudiante.carrera) !== normalizarTexto(materia.carrera)) {
    return res.status(400).json({ error: `Este estudiante no pertenece a esta clase. Solo se permite para grado ${materia.grado} - ${materia.carrera}.` });
  }
  const hoy = new Date().toISOString().split('T')[0];
  const ahora = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const { data: yaRegistro } = await supabase.from('asistencia').select('id')
    .eq('cedula', cedula).eq('fecha', hoy).eq('materia_id', materiaId).maybeSingle();
  if (yaRegistro) return res.status(400).json({ error: 'Este estudiante ya registró asistencia en esta clase hoy', estudiante });
  const { error: errAsistencia } = await supabase.from('asistencia')
    .insert([{ cedula, fecha: hoy, hora: ahora, materia_id: materiaId, institucion_id, estado: 'presente' }]);
  if (errAsistencia) return res.status(500).json({ error: 'Error al registrar asistencia: ' + errAsistencia.message });
  res.json({
    message: 'Asistencia registrada exitosamente',
    estudiante: { cedula: estudiante.cedula, nombre: estudiante.nombre, apellido: estudiante.apellido, grado: estudiante.grado, seccion: estudiante.seccion, carrera: estudiante.carrera || 'No especificada', foto_url: estudiante.foto_url || null },
    hora: ahora
  });
  try {
    const [hLim, mLim] = HORA_LIMITE_TARDANZA.split(':').map(Number);
    const [hAhora, mAhora] = ahora.split(':').map(Number);
    if (hAhora > hLim || (hAhora === hLim && mAhora > mLim)) {
      notificarTardanza(cedula, hoy, ahora, HORA_LIMITE_TARDANZA).catch(console.error);
    }
  } catch (e) { console.error('Error verificando tardanza:', e.message); }
};

// ========== ASISTENCIA DEL DÍA ==========
const getAsistenciaHoy = async (req, res) => {
  const hoy = new Date().toISOString().split('T')[0];
  const añoActual = new Date().getFullYear();
  const mesActual = new Date().getMonth() + 1;
  const { profesorEmail } = req.query;
  const institucion_id = req.user.institucion_id;
  if (!profesorEmail) return res.status(400).json({ error: 'Se necesita el email del profesor' });
  const { data: profesor, error: errProf } = await supabase.from('profesores').select('id').eq('email', profesorEmail).single();
  if (errProf || !profesor) return res.status(404).json({ error: 'Profesor no encontrado' });
  let queryMaterias = supabase.from('materias').select('id').eq('profesor_id', profesor.id);
  if (institucion_id) queryMaterias = queryMaterias.eq('institucion_id', institucion_id);
  const { data: materias } = await queryMaterias;
  if (!materias || materias.length === 0) return res.json([]);
  let queryAsistencia = supabase.from('asistencia').select(`
    id, fecha, hora, materia_id, estado,
    estudiantes (cedula, nombre, apellido, grado, seccion, carrera, foto_url),
    materias (nombre)
  `).eq('fecha', hoy).in('materia_id', materias.map(m => m.id));
  if (institucion_id) queryAsistencia = queryAsistencia.eq('institucion_id', institucion_id);
  const { data, error } = await queryAsistencia;
  if (error) return res.status(400).json({ error: error.message });
  const result = await Promise.all(data.map(async item => ({
    id: item.id, fecha: item.fecha, hora: item.hora, estado: item.estado || 'presente',
    estudiante: item.estudiantes,
    materia_nombre: item.materias?.nombre || 'Sin materia',
    faltasEnMes: item.estudiantes?.cedula ? await contarFaltasEnMes(item.estudiantes.cedula, añoActual, mesActual) : 0
  })));
  res.json(result);
};

const getAsistenciaByFecha = async (req, res) => {
  const { fecha } = req.params; const institucion_id = req.user.institucion_id;
  let query = supabase.from('asistencia').select(`id, fecha, hora, estado, estudiantes (cedula, nombre, apellido, grado, seccion, carrera, foto_url)`).eq('fecha', fecha);
  if (institucion_id) query = query.eq('institucion_id', institucion_id);
  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

const getAsistenciaPorGrado = async (req, res) => {
  const { grado, seccion, fecha } = req.query; const institucion_id = req.user.institucion_id;
  const fechaFiltro = fecha || new Date().toISOString().split('T')[0];
  let query = supabase.from('asistencia').select(`id, fecha, hora, estado, estudiantes (cedula, nombre, apellido, grado, seccion, carrera, foto_url)`).eq('fecha', fechaFiltro);
  if (institucion_id) query = query.eq('institucion_id', institucion_id);
  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  let filtrados = data;
  if (grado) filtrados = filtrados.filter(a => a.estudiantes?.grado === grado);
  if (seccion) filtrados = filtrados.filter(a => a.estudiantes?.seccion === seccion);
  res.json(filtrados);
};

const limpiarAsistenciaHoy = async (req, res) => {
  const hoy = new Date().toISOString().split('T')[0]; const institucion_id = req.user.institucion_id;
  let query = supabase.from('asistencia').delete().eq('fecha', hoy).neq('estado', 'excusado');
  if (institucion_id) query = query.eq('institucion_id', institucion_id);
  const { error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Asistencia del día limpiada (excusados conservados)' });
};

const getReporteAsistencia = async (req, res) => {
  const { fechaInicio, fechaFin, profesorEmail } = req.query; const institucion_id = req.user.institucion_id;
  let query = supabase.from('asistencia').select(`id, fecha, hora, materia_id, estado, estudiantes (cedula, nombre, apellido, grado, seccion, carrera, foto_url), materias (nombre, grado, seccion, carrera, profesor_id)`);
  if (fechaInicio && fechaFin) query = query.gte('fecha', fechaInicio).lte('fecha', fechaFin);
  else if (fechaInicio) query = query.gte('fecha', fechaInicio);
  else if (fechaFin) query = query.lte('fecha', fechaFin);
  if (profesorEmail && profesorEmail !== 'all' && profesorEmail !== '') {
    const idsMaterias = await obtenerIdsMateriaProfesor(profesorEmail, institucion_id);
    if (!idsMaterias || idsMaterias.length === 0) return res.json([]);
    query = query.in('materia_id', idsMaterias);
  }
  if (institucion_id) query = query.eq('institucion_id', institucion_id);
  const { data, error } = await query.order('fecha', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  // Incluir estado en la respuesta para mostrar excusados en la lista
  res.json(data.map(item => ({
    ...item,
    materia_nombre: item.materias?.nombre || 'Sin materia',
    estado: item.estado || 'presente'
  })));
};

// ========== EXPORTAR EXCEL SIMPLE ==========
const exportarReporteExcel = async (req, res) => {
  const { fechaInicio, fechaFin, usuario } = req.query; const institucion_id = req.user.institucion_id;
  if (!fechaInicio || !fechaFin) return res.status(400).json({ error: 'Debe proporcionar fechaInicio y fechaFin' });
  let query = supabase.from('asistencia').select(`id, fecha, hora, estado, estudiantes (cedula, nombre, apellido, grado, seccion)`)
    .gte('fecha', fechaInicio).lte('fecha', fechaFin).order('fecha', { ascending: false });
  if (institucion_id) query = query.eq('institucion_id', institucion_id);
  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  const institucion = await obtenerInstitucion(institucion_id);
  const colorPrimario = hexToArgb(institucion.color_primario);
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Reporte Asistencia');
  ws.mergeCells('A1:H1'); ws.getCell('A1').value = institucion.nombre.toUpperCase();
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorPrimario } };
  ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' }; ws.getRow(1).height = 30;
  ws.mergeCells('A2:H2'); ws.getCell('A2').value = `Reporte de Asistencia — ${fechaInicio} al ${fechaFin}`;
  ws.getCell('A2').font = { italic: true, size: 11, color: { argb: 'FF555555' } };
  ws.getCell('A2').alignment = { horizontal: 'center' }; ws.addRow([]);
  const headerRow = ws.getRow(4);
  headerRow.values = ['Fecha', 'Hora', 'Cédula', 'Nombre', 'Apellido', 'Grado', 'Sección', 'Estado'];
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorPrimario } };
    cell.alignment = { horizontal: 'center' };
  });
  ws.columns = [
    { key: 'fecha', width: 12 }, { key: 'hora', width: 10 }, { key: 'cedula', width: 15 },
    { key: 'nombre', width: 20 }, { key: 'apellido', width: 20 }, { key: 'grado', width: 8 },
    { key: 'seccion', width: 8 }, { key: 'estado', width: 12 }
  ];
  data.forEach((item, idx) => {
    const esExcusado = item.estado === 'excusado';
    const row = ws.addRow({
      fecha: item.fecha, hora: esExcusado ? '—' : item.hora,
      cedula: item.estudiantes?.cedula || '', nombre: item.estudiantes?.nombre || '',
      apellido: item.estudiantes?.apellido || '', grado: item.estudiantes?.grado || '',
      seccion: item.estudiantes?.seccion || '', estado: esExcusado ? '🔵 Excusado' : '✅ Presente'
    });
    if (esExcusado) {
      row.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } }; });
      row.getCell(8).font = { bold: true, color: { argb: 'FF0EA5E9' } };
    } else if (idx % 2 !== 0) {
      row.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7FAFC' } }; });
    }
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const fileName = `reporte_${fechaInicio}_a_${fechaFin}_${Date.now()}.xlsx`;
  const { error: uploadError } = await supabase.storage.from('reportes').upload(fileName, buffer, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  if (uploadError) return res.status(500).json({ error: 'Error al guardar archivo' });
  const { data: urlData } = supabase.storage.from('reportes').getPublicUrl(fileName);
  await supabase.from('reportes_generados').insert([{ fecha_inicio: fechaInicio, fecha_fin: fechaFin, archivo_url: urlData.publicUrl, usuario: usuario || 'profesor', institucion_id }]);
  res.json({ success: true, url: urlData.publicUrl });
};

// ========== EXPORTAR REPORTE COMPLETO POR CLASE (CON EXCUSADOS) ==========
const exportarReporteCompletoExcel = async (req, res) => {
  const { fecha, usuario, nombreProfesor, grado, seccion, profesorEmail } = req.query;
  const institucion_id = req.user.institucion_id;
  if (!fecha) return res.status(400).json({ error: 'Debe proporcionar una fecha (YYYY-MM-DD)' });
  const institucion = await obtenerInstitucion(institucion_id);
  const colorPrimario = hexToArgb(institucion.color_primario);
  const colorSecundario = hexToArgb(institucion.color_secundario);
  const nombreInstitucion = institucion.nombre;
  const subirExcelVacio = async (mensaje) => {
    const wb = new ExcelJS.Workbook(); wb.addWorksheet(`Asistencia_${fecha}`).addRow([mensaje]);
    const buf = await wb.xlsx.writeBuffer(); const fn = `reporte_vacio_${fecha}_${Date.now()}.xlsx`;
    await supabase.storage.from('reportes').upload(fn, buf, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const { data: u } = supabase.storage.from('reportes').getPublicUrl(fn); return u.publicUrl;
  };
  try {
    // ── Query incluye estado para detectar excusados ──
    let queryAsistencias = supabase.from('asistencia').select(`
      cedula, hora, materia_id, estado,
      estudiantes (cedula, nombre, apellido, grado, seccion, carrera),
      materias (id, grado, seccion, carrera, nombre, profesor_id, profesores:profesor_id (nombre))
    `).eq('fecha', fecha);
    if (institucion_id) queryAsistencias = queryAsistencias.eq('institucion_id', institucion_id);
    const filtrarPorProfesor = profesorEmail && profesorEmail !== 'all' && profesorEmail !== '';
    if (filtrarPorProfesor) {
      const idsMaterias = await obtenerIdsMateriaProfesor(profesorEmail, institucion_id);
      if (!idsMaterias || idsMaterias.length === 0) { const url = await subirExcelVacio('No hay asistencias para este profesor en esta fecha.'); return res.json({ success: true, url }); }
      // Incluye registros de las materias del profesor (presentes Y excusados)
      queryAsistencias = queryAsistencias.in('materia_id', idsMaterias);
    }
    if (grado) queryAsistencias = queryAsistencias.filter('materias.grado', 'eq', grado);
    if (seccion) queryAsistencias = queryAsistencias.filter('materias.seccion', 'eq', seccion);
    const { data: asistencias, error: errAsistencias } = await queryAsistencias;
    if (errAsistencias) throw errAsistencias;

    const grupos = new Map();
    asistencias.forEach(asis => {
      const materia = asis.materias; if (!materia) return;
      if (!grupos.has(materia.id)) grupos.set(materia.id, { materia, asistencias: [] });
      grupos.get(materia.id).asistencias.push({ estudiante: asis.estudiantes, hora: asis.hora, estado: asis.estado || 'presente' });
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(`Asistencia_${fecha}`);
    const headerStyle = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: colorPrimario } }, alignment: { horizontal: 'center' } };
    const subHeaderStyle = { font: { bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBF8FF' } } };
    let currentRow = 1;

    worksheet.mergeCells(`A${currentRow}:I${currentRow}`);
    worksheet.getCell(`A${currentRow}`).value = nombreInstitucion.toUpperCase();
    worksheet.getCell(`A${currentRow}`).font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    worksheet.getCell(`A${currentRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorPrimario } };
    worksheet.getCell(`A${currentRow}`).alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(currentRow).height = 35; currentRow++;

    const fechaLegible = new Date(fecha + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Tegucigalpa' });
    worksheet.mergeCells(`A${currentRow}:I${currentRow}`);
    worksheet.getCell(`A${currentRow}`).value = `Reporte de Asistencia — ${fechaLegible}`;
    worksheet.getCell(`A${currentRow}`).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    worksheet.getCell(`A${currentRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorSecundario } };
    worksheet.getCell(`A${currentRow}`).alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(currentRow).height = 25; currentRow++;

    if (nombreProfesor) {
      worksheet.mergeCells(`A${currentRow}:I${currentRow}`);
      worksheet.getCell(`A${currentRow}`).value = `Generado por: ${nombreProfesor}`;
      worksheet.getCell(`A${currentRow}`).font = { italic: true, size: 10, color: { argb: 'FF555555' } };
      worksheet.getCell(`A${currentRow}`).alignment = { horizontal: 'center' }; currentRow++;
    }
    worksheet.addRow([]); currentRow++;

    if (grupos.size === 0) {
      worksheet.addRow(['No se registraron asistencias en esta fecha.']);
    } else {
      // ── RESUMEN DE CLASES ──
      worksheet.mergeCells(`A${currentRow}:I${currentRow}`);
      worksheet.getCell(`A${currentRow}`).value = 'RESUMEN DE CLASES';
      worksheet.getCell(`A${currentRow}`).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
      worksheet.getCell(`A${currentRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorPrimario } };
      worksheet.getCell(`A${currentRow}`).alignment = { horizontal: 'center' };
      worksheet.getRow(currentRow).height = 22; currentRow++;

      const resumenHeaders = worksheet.addRow(['Clase', 'Grado', 'Sección', 'Profesor', 'Presentes', 'Excusados', 'Total']);
      resumenHeaders.eachCell(cell => { cell.style = subHeaderStyle; }); currentRow++;

      const gruposOrdenadosResumen = Array.from(grupos.values()).sort((a, b) => {
        if (a.materia.grado !== b.materia.grado) return String(a.materia.grado).localeCompare(String(b.materia.grado));
        return String(a.materia.seccion).localeCompare(String(b.materia.seccion));
      });

      gruposOrdenadosResumen.forEach((grupo, idx) => {
        const mat = grupo.materia;
        const presentes = grupo.asistencias.filter(a => a.estado !== 'excusado').length;
        const excusados = grupo.asistencias.filter(a => a.estado === 'excusado').length;
        const row = worksheet.addRow([mat.nombre || mat.carrera || 'Clase', `${mat.grado}°`, mat.seccion, mat.profesores?.nombre || 'Sin profesor', presentes, excusados, presentes + excusados]);
        row.getCell(5).font = { bold: true, color: { argb: colorSecundario } };
        if (excusados > 0) row.getCell(6).font = { bold: true, color: { argb: 'FF0EA5E9' } };
        if (idx % 2 !== 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7FAFC' } };
        currentRow++;
      });

      const totPresentes = Array.from(grupos.values()).reduce((s, g) => s + g.asistencias.filter(a => a.estado !== 'excusado').length, 0);
      const totExcusados = Array.from(grupos.values()).reduce((s, g) => s + g.asistencias.filter(a => a.estado === 'excusado').length, 0);
      const totalRow = worksheet.addRow(['', '', '', 'TOTALES:', totPresentes, totExcusados, totPresentes + totExcusados]);
      totalRow.getCell(4).font = { bold: true };
      totalRow.getCell(5).font = { bold: true, color: { argb: colorPrimario } };
      if (totExcusados > 0) totalRow.getCell(6).font = { bold: true, color: { argb: 'FF0EA5E9' } };
      currentRow++;
      worksheet.addRow([]); currentRow++; worksheet.addRow([]); currentRow++;

      // ── DETALLE POR CLASE ──
      const gruposOrdenados = Array.from(grupos.values()).sort((a, b) => {
        if (a.materia.grado !== b.materia.grado) return String(a.materia.grado).localeCompare(String(b.materia.grado));
        return String(a.materia.seccion).localeCompare(String(b.materia.seccion));
      });

      for (const grupo of gruposOrdenados) {
        const mat = grupo.materia;
        const nombreProf = mat.profesores?.nombre || 'Sin profesor';
        const presentesClase = grupo.asistencias.filter(a => a.estado !== 'excusado').length;
        const excusadosClase = grupo.asistencias.filter(a => a.estado === 'excusado').length;

        worksheet.mergeCells(`A${currentRow}:I${currentRow}`);
        worksheet.getCell(`A${currentRow}`).value = `${mat.nombre || mat.carrera || 'Clase'} — Grado ${mat.grado}° Sección ${mat.seccion}`;
        worksheet.getCell(`A${currentRow}`).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
        worksheet.getCell(`A${currentRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorSecundario } };
        worksheet.getCell(`A${currentRow}`).alignment = { horizontal: 'left', indent: 1 };
        worksheet.getRow(currentRow).height = 22; currentRow++;

        worksheet.mergeCells(`A${currentRow}:I${currentRow}`);
        worksheet.getCell(`A${currentRow}`).value = `👤 Profesor: ${nombreProf}   |   ✅ Presentes: ${presentesClase}   |   🔵 Excusados: ${excusadosClase}`;
        worksheet.getCell(`A${currentRow}`).font = { italic: true, size: 10, color: { argb: 'FF555555' } };
        currentRow++;

        const colHeaders = worksheet.addRow(['Cédula', 'Nombre', 'Apellido', 'Grado', 'Sección', 'Carrera', 'Hora', 'Estado']);
        colHeaders.eachCell(cell => { cell.style = subHeaderStyle; }); currentRow++;

        for (const item of grupo.asistencias) {
          const est = item.estudiante;
          const esExcusado = item.estado === 'excusado';
          const dataRow = worksheet.addRow([
            est?.cedula || '', est?.nombre || '', est?.apellido || '',
            est?.grado || '', est?.seccion || '', est?.carrera || '',
            esExcusado ? '—' : (item.hora || ''),
            esExcusado ? '🔵 Excusado' : '✅ Presente'
          ]);
          if (esExcusado) {
            dataRow.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } }; cell.border = { bottom: { style: 'hair', color: { argb: 'FFB3E5FC' } } }; });
            dataRow.getCell(8).font = { bold: true, color: { argb: 'FF0EA5E9' } };
          } else {
            dataRow.eachCell(cell => { cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } }; });
          }
          currentRow++;
        }
        worksheet.addRow([]); currentRow++;
      }
    }

    [15, 20, 20, 10, 10, 18, 10, 14].forEach((w, i) => { if (worksheet.columns[i]) worksheet.columns[i].width = w; });

    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = `reporte_completo_${fecha}_${Date.now()}.xlsx`;
    const { error: uploadError } = await supabase.storage.from('reportes').upload(fileName, buffer, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    if (uploadError) throw uploadError;
    const { data: urlData } = supabase.storage.from('reportes').getPublicUrl(fileName);
    try { await supabase.from('reportes_generados').insert([{ fecha_inicio: fecha, fecha_fin: fecha, archivo_url: urlData.publicUrl, usuario: usuario || 'profesor', grado: grado || null, seccion: seccion || null, institucion_id }]); } catch (e) { console.warn('⚠️ Metadata no guardada:', e.message); }
    res.json({ success: true, url: urlData.publicUrl });
  } catch (error) { console.error('❌ Error en reporte completo:', error); res.status(500).json({ error: error.message }); }
};

const getReportesGenerados = async (req, res) => {
  const institucion_id = req.user.institucion_id;
  let query = supabase.from('reportes_generados').select('*').order('fecha_generacion', { ascending: false });
  if (institucion_id) query = query.eq('institucion_id', institucion_id);
  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// ========== ESTADÍSTICAS ==========
const getEstadisticas = async (req, res) => {
  try {
    const { fechaInicio, fechaFin, profesorEmail } = req.query; const institucion_id = req.user.institucion_id;
    let inicio, fin;
    if (fechaInicio && fechaFin) { inicio = fechaInicio; fin = fechaFin; }
    else { const hoy = new Date(); inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0]; fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().split('T')[0]; }
    const filtros = await obtenerFiltrosProfesor(profesorEmail, institucion_id);
    const estudiantes = await obtenerEstudiantesFiltrados(filtros, institucion_id);
    if (estudiantes.length === 0) return res.json({ masFaltas: [], mejorRecord: [], totalDias: 0, resumenGradoCarrera: [] });
    let asistencias = [];
    const idsMaterias = await obtenerIdsMateriaProfesor(profesorEmail, institucion_id);
    if (idsMaterias === null) {
      let q = supabase.from('asistencia').select('cedula, fecha, estado').gte('fecha', inicio).lte('fecha', fin);
      if (institucion_id) q = q.eq('institucion_id', institucion_id);
      const { data } = await q; asistencias = data || [];
    } else if (idsMaterias.length > 0) {
      let q = supabase.from('asistencia').select('cedula, fecha, estado').gte('fecha', inicio).lte('fecha', fin).in('materia_id', idsMaterias);
      if (institucion_id) q = q.eq('institucion_id', institucion_id);
      const { data } = await q; asistencias = data || [];
    }
    // Excusados cuentan como presentes para las estadísticas
    const asistenciaCount = {};
    asistencias.forEach(a => { asistenciaCount[a.cedula] = (asistenciaCount[a.cedula] || 0) + 1; });
    const totalDias = Math.ceil((new Date(fin) - new Date(inicio)) / 86400000) + 1;
    const estadisticasArr = estudiantes.map(est => {
      const count = asistenciaCount[est.cedula] || 0; const faltas = totalDias - count;
      return { ...est, asistencias: count, faltas: faltas > 0 ? faltas : 0, totalDias };
    });
    const masFaltas = [...estadisticasArr].filter(e => e.faltas > 0).sort((a, b) => b.faltas - a.faltas).slice(0, 10);
    const mejorRecord = [...estadisticasArr].filter(e => e.asistencias > 0).sort((a, b) => b.asistencias - a.asistencias).slice(0, 10);
    const resumenMap = {};
    estadisticasArr.forEach(est => {
      const key = `${est.grado}|${est.seccion || ''}|${est.carrera || 'Sin carrera'}`;
      if (!resumenMap[key]) resumenMap[key] = { grado: est.grado, seccion: est.seccion || '', carrera: est.carrera || 'Sin carrera', totalAsistencias: 0, totalEstudiantes: 0 };
      resumenMap[key].totalAsistencias += est.asistencias; resumenMap[key].totalEstudiantes++;
    });
    const resumenGradoCarrera = Object.values(resumenMap).map(item => ({ ...item, promedioAsistencias: (item.totalAsistencias / item.totalEstudiantes).toFixed(1) }))
      .sort((a, b) => { if (String(a.grado) !== String(b.grado)) return String(a.grado).localeCompare(String(b.grado)); if (a.seccion !== b.seccion) return String(a.seccion).localeCompare(String(b.seccion)); return a.carrera.localeCompare(b.carrera); });
    res.json({ masFaltas, mejorRecord, totalDias, resumenGradoCarrera });
  } catch (error) { console.error('❌ Error estadísticas:', error); res.status(500).json({ error: error.message }); }
};

// ========== EXPORTAR ESTADÍSTICAS A EXCEL ==========
const exportarEstadisticasExcel = async (req, res) => {
  try {
    const { fechaInicio, fechaFin, profesorEmail } = req.query; const institucion_id = req.user.institucion_id;
    const institucion = await obtenerInstitucion(institucion_id);
    const colorPrimario = hexToArgb(institucion.color_primario); const colorSecundario = hexToArgb(institucion.color_secundario);
    const colorPrimarioHex = institucion.color_primario.replace('#', ''); const colorSecundarioHex = institucion.color_secundario.replace('#', '');
    const nombreInstitucion = institucion.nombre;
    let inicio, fin;
    if (fechaInicio && fechaFin) { inicio = fechaInicio; fin = fechaFin; }
    else { const hoy = new Date(); inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0]; fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().split('T')[0]; }
    const filtros = await obtenerFiltrosProfesor(profesorEmail, institucion_id);
    const estudiantes = await obtenerEstudiantesFiltrados(filtros, institucion_id);
    let asistencias = [];
    const idsMaterias = await obtenerIdsMateriaProfesor(profesorEmail, institucion_id);
    if (idsMaterias === null) { let q = supabase.from('asistencia').select('cedula, fecha').gte('fecha', inicio).lte('fecha', fin); if (institucion_id) q = q.eq('institucion_id', institucion_id); const { data } = await q; asistencias = data || []; }
    else if (idsMaterias.length > 0) { let q = supabase.from('asistencia').select('cedula, fecha').gte('fecha', inicio).lte('fecha', fin).in('materia_id', idsMaterias); if (institucion_id) q = q.eq('institucion_id', institucion_id); const { data } = await q; asistencias = data || []; }
    const asistenciaCount = {}; asistencias.forEach(a => { asistenciaCount[a.cedula] = (asistenciaCount[a.cedula] || 0) + 1; });
    const totalDias = Math.ceil((new Date(fin) - new Date(inicio)) / 86400000) + 1;
    const estadisticasArr = estudiantes.map(est => { const count = asistenciaCount[est.cedula] || 0; const faltas = totalDias - count; return { ...est, asistencias: count, faltas: faltas > 0 ? faltas : 0, totalDias }; });
    const masFaltas = [...estadisticasArr].sort((a, b) => b.faltas - a.faltas).slice(0, 10);
    const mejorRecord = [...estadisticasArr].sort((a, b) => b.asistencias - a.asistencias).slice(0, 10);
    const resumenMap = {};
    estadisticasArr.forEach(est => {
      const key = `${est.grado}|${est.carrera || 'Sin carrera'}`;
      if (!resumenMap[key]) resumenMap[key] = { grado: est.grado, carrera: est.carrera || 'Sin carrera', totalAsistencias: 0, totalFaltas: 0, totalEstudiantes: 0 };
      resumenMap[key].totalAsistencias += est.asistencias; resumenMap[key].totalFaltas += est.faltas; resumenMap[key].totalEstudiantes++;
    });
    const resumenArray = Object.values(resumenMap).map(item => ({ ...item, promedioAsistencias: item.totalEstudiantes > 0 ? (item.totalAsistencias / item.totalEstudiantes).toFixed(1) : '0' }))
      .sort((a, b) => { if (String(a.grado) !== String(b.grado)) return String(a.grado).localeCompare(String(b.grado)); return a.carrera.localeCompare(b.carrera); });
    const workbook = new ExcelJS.Workbook();
    const headerStyle = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: colorPrimario } }, alignment: { horizontal: 'center', vertical: 'middle' }, border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } } };
    const dataStyle = { border: { top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } } };
    const altRowStyle = { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7FAFC' } }, border: dataStyle.border };
    const colsEst = [{ header: 'Cédula', key: 'cedula', width: 16 }, { header: 'Nombre', key: 'nombre', width: 22 }, { header: 'Apellido', key: 'apellido', width: 22 }, { header: 'Grado', key: 'grado', width: 8 }, { header: 'Sección', key: 'seccion', width: 10 }, { header: 'Carrera', key: 'carrera', width: 20 }, { header: 'Asistencias', key: 'asistencias', width: 13 }, { header: 'Faltas', key: 'faltas', width: 10 }, { header: 'Total días', key: 'totalDias', width: 12 }];
    const wsDash = workbook.addWorksheet('Dashboard');
    wsDash.mergeCells('A1:E1'); wsDash.getCell('A1').value = nombreInstitucion.toUpperCase(); wsDash.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } }; wsDash.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorPrimario } }; wsDash.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' }; wsDash.getRow(1).height = 35;
    wsDash.mergeCells('A2:E2'); wsDash.getCell('A2').value = `ESTADÍSTICAS DE ASISTENCIA — ${inicio} al ${fin}`; wsDash.getCell('A2').font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } }; wsDash.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorSecundario } }; wsDash.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' }; wsDash.getRow(2).height = 25;
    wsDash.mergeCells('A3:E3'); wsDash.getCell('A3').value = `Estudiantes: ${estudiantes.length}  |  Días del período: ${totalDias}  |  Asistencias totales: ${asistencias.length}`; wsDash.getCell('A3').font = { size: 10, italic: true, color: { argb: 'FF555555' } }; wsDash.getCell('A3').alignment = { horizontal: 'center' };
    wsDash.addRow([]); wsDash.getRow(5).values = ['Grado / Carrera', 'Total Asistencias', 'Total Faltas', 'Promedio', 'Estudiantes']; wsDash.getRow(5).eachCell(cell => { cell.style = headerStyle; });
    resumenArray.forEach((item, idx) => { const r = wsDash.addRow([`${item.grado}° ${item.carrera}`, item.totalAsistencias, item.totalFaltas, parseFloat(item.promedioAsistencias), item.totalEstudiantes]); r.eachCell(cell => { cell.style = idx % 2 === 0 ? dataStyle : altRowStyle; }); r.getCell(2).font = { bold: true, color: { argb: colorSecundario } }; r.getCell(3).font = { bold: true, color: { argb: 'FFE53E3E' } }; });
    const wsFaltas = workbook.addWorksheet('Mas faltas'); wsFaltas.mergeCells('A1:I1'); wsFaltas.getCell('A1').value = `${nombreInstitucion} — TOP 10: ALUMNOS CON MÁS FALTAS`; wsFaltas.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }; wsFaltas.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE53E3E' } }; wsFaltas.getCell('A1').alignment = { horizontal: 'center' }; wsFaltas.addRow([]); wsFaltas.columns = colsEst; wsFaltas.getRow(3).values = colsEst.map(c => c.header); wsFaltas.getRow(3).eachCell(cell => { cell.style = headerStyle; });
    masFaltas.forEach((est, idx) => { const r = wsFaltas.addRow([est.cedula, est.nombre, est.apellido, est.grado, est.seccion, est.carrera, est.asistencias, est.faltas, est.totalDias]); r.eachCell(cell => { cell.style = idx % 2 === 0 ? dataStyle : altRowStyle; }); if (est.faltas >= 3) r.getCell(8).font = { bold: true, color: { argb: 'FFCC0000' } }; });
    const wsRecord = workbook.addWorksheet('Mejor record'); wsRecord.mergeCells('A1:I1'); wsRecord.getCell('A1').value = `${nombreInstitucion} — TOP 10: MEJOR RÉCORD DE ASISTENCIA`; wsRecord.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }; wsRecord.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorSecundario } }; wsRecord.getCell('A1').alignment = { horizontal: 'center' }; wsRecord.addRow([]); wsRecord.columns = colsEst; wsRecord.getRow(3).values = colsEst.map(c => c.header); wsRecord.getRow(3).eachCell(cell => { cell.style = headerStyle; });
    mejorRecord.forEach((est, idx) => { const r = wsRecord.addRow([est.cedula, est.nombre, est.apellido, est.grado, est.seccion, est.carrera, est.asistencias, est.faltas, est.totalDias]); r.eachCell(cell => { cell.style = idx % 2 === 0 ? dataStyle : altRowStyle; }); r.getCell(7).font = { bold: true, color: { argb: colorSecundario } }; });
    const wsResumen = workbook.addWorksheet('Resumen'); wsResumen.mergeCells('A1:F1'); wsResumen.getCell('A1').value = `${nombreInstitucion} — RESUMEN POR GRADO Y CARRERA`; wsResumen.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }; wsResumen.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorPrimario } }; wsResumen.getCell('A1').alignment = { horizontal: 'center' }; wsResumen.addRow([]);
    wsResumen.columns = [{ header: 'Grado', key: 'grado', width: 10 }, { header: 'Carrera', key: 'carrera', width: 22 }, { header: 'Total asistencias', key: 'totalAsistencias', width: 20 }, { header: 'Total faltas', key: 'totalFaltas', width: 15 }, { header: 'Total estudiantes', key: 'totalEstudiantes', width: 20 }, { header: 'Promedio asistencias', key: 'promedioAsistencias', width: 22 }];
    wsResumen.getRow(3).values = ['Grado', 'Carrera', 'Total asistencias', 'Total faltas', 'Total estudiantes', 'Promedio asistencias']; wsResumen.getRow(3).eachCell(cell => { cell.style = headerStyle; });
    resumenArray.forEach((item, idx) => { const r = wsResumen.addRow([item.grado, item.carrera, item.totalAsistencias, item.totalFaltas, item.totalEstudiantes, parseFloat(item.promedioAsistencias)]); r.eachCell(cell => { cell.style = idx % 2 === 0 ? dataStyle : altRowStyle; }); });
    const bufferBase = await workbook.xlsx.writeBuffer(); const graficas = [];
    if (resumenArray.length > 0) { const cats = resumenArray.map(r => `${r.grado}° ${r.carrera}`); graficas.push({ nombre: 'Graf. Asistencias', chartXml: generarChartBarrasXml([{ nombre: 'Asistencias', categorias: cats, valores: resumenArray.map(r => r.totalAsistencias) }, { nombre: 'Faltas', categorias: cats, valores: resumenArray.map(r => r.totalFaltas) }], `${nombreInstitucion} — Asistencias vs Faltas`, colorPrimarioHex, colorSecundarioHex) }); graficas.push({ nombre: 'Graf. Distribucion', chartXml: generarChartPieXml(cats, resumenArray.map(r => r.totalAsistencias), `${nombreInstitucion} — Distribución de Asistencias`) }); }
    if (masFaltas.length > 0) { const names = masFaltas.map(e => `${e.nombre} ${e.apellido}`); graficas.push({ nombre: 'Graf. Mas Faltas', chartXml: generarChartBarrasXml([{ nombre: 'Faltas', categorias: names, valores: masFaltas.map(e => e.faltas) }, { nombre: 'Asistencias', categorias: names, valores: masFaltas.map(e => e.asistencias) }], `${nombreInstitucion} — Top 10 Más Faltas`, colorPrimarioHex, colorSecundarioHex) }); }
    if (mejorRecord.length > 0) { const names = mejorRecord.map(e => `${e.nombre} ${e.apellido}`); graficas.push({ nombre: 'Graf. Mejor Record', chartXml: generarChartBarrasXml([{ nombre: 'Asistencias', categorias: names, valores: mejorRecord.map(e => e.asistencias) }], `${nombreInstitucion} — Top 10 Mejor Récord`, colorPrimarioHex, colorSecundarioHex) }); }
    const finalBuffer = graficas.length > 0 ? await inyectarGraficasEnXlsx(bufferBase, graficas) : bufferBase;
    const fileName = `estadisticas_${inicio}_a_${fin}_${Date.now()}.xlsx`;
    const { error: uploadError } = await supabase.storage.from('reportes').upload(fileName, finalBuffer, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    if (uploadError) throw uploadError;
    const { data: urlData } = supabase.storage.from('reportes').getPublicUrl(fileName); const archivo_url = urlData.publicUrl;
    try { await supabase.from('estadisticas_generadas').insert([{ fecha_inicio: inicio, fecha_fin: fin, archivo_url, usuario: profesorEmail ? 'profesor' : 'admin', creado_por: profesorEmail || 'admin', fecha_generacion: new Date().toISOString(), institucion_id }]); } catch (metaErr) { console.warn('⚠️ Metadata no guardada:', metaErr.message); }
    res.json({ success: true, url: archivo_url });
  } catch (error) { console.error('❌ Error exportando estadísticas:', error); res.status(500).json({ error: error.message }); }
};

module.exports = { registrarAsistencia, getAsistenciaHoy, getAsistenciaByFecha, getAsistenciaPorGrado, limpiarAsistenciaHoy, getReporteAsistencia, exportarReporteExcel, exportarReporteCompletoExcel, getReportesGenerados, getEstadisticas, exportarEstadisticasExcel };
