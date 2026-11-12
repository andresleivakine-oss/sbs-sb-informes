const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const app = path.join(__dirname, '..', 'app');
const html = fs.readFileSync(path.join(app, 'index.html'), 'utf8');
const [state, script] = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const nodes = new Map();
const document = {
  getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, {});
    return nodes.get(id);
  },
  addEventListener() {},
  documentElement: { style: { setProperty() {} } },
};
document.getElementById('state').textContent = state;
const context = vm.createContext({document});
vm.runInContext(script, context);
vm.runInContext(`
  Object.assign(data.brands[data.center],{name:'Centro de prueba',logo:'logo.png',address:'Dirección de prueba',contact:'centro.example',whatsapp:'+56 9 1234 5678',phone:'+56 51 212 3456'});
  data.initialDate = '21-10-2026';
  data.controlDate = '09-11-2026';
  data.clinicalReason = 'Motivo anterior';
  data.clinicalFindings = 'Hallazgo simulado';
  data.rows = [
    {name:'KOOS', group:'q', protocol:'Subescala de síntomas', initial:50, current:70},
    {name:'KOOS', group:'q', protocol:'Subescala de dolor', initial:40, current:65},
    {name:'GROC', group:'q', current:4},
    {name:'Evaluación Kinvent', group:'force', format:'single', equipment:'Kinvent', protocol:'Protocolo editable', initial:20},
    {name:'Evaluación VALD', group:'force', format:'single', protocol:'VALD ForceDecks · máximo', initial:20},
    {name:'Fuerza inicial', group:'force', format:'bilateral', mode:'auto', unit:'N', li:100, ri:90, initialDate:'11-11-2026'},
    {name:'Fuerza con control', group:'force', format:'bilateral', mode:'auto', unit:'N', li:100, ri:70, lc:100, rc:95, initialDate:'11-11-2026', controlDate:'20-11-2026'},
    {name:'Salto igual', group:'biomech', format:'single', mode:'auto', unit:'cm', initial:30, current:30},
    {name:'Salto similar', group:'biomech', format:'single', mode:'auto', direction:'higher', unit:'cm', initial:30, current:30.0001},
    {name:'Salto unipodal', group:'biomech', format:'bilateral', mode:'auto', direction:'higher', unit:'cm', li:15.74, ri:5.4, lc:19.18, rc:19.52},
    {name:'Salto con observación manual', group:'biomech', format:'single', mode:'notImproved', unit:'cm', initial:20, current:10},
    {name:'EVA', group:'pain', initial:8, current:4},
    {name:'EVA manual', group:'pain', initial:5, current:5, mode:'notImproved'}
  ];
  report();
`, context);
const report = nodes.get('report').innerHTML;
assert.match(report, /class="reporthead"><img[^>]+><h1 class="report-title">INFORME KINÉSICO<\/h1><\/div><div class="meta">/);
assert.match(report, /class="footer"><span><strong>Centro de prueba<\/strong> · Dirección de prueba · centro.example · <a href="https:\/\/wa.me\/56912345678"/);
assert.equal([...report.matchAll(/Dirección de prueba/g)].length,1);
assert.match(report, /Tel\.: \+56 51 212 3456/);
assert.match(report, /Hallazgo simulado/);
const columnGroups = [...report.matchAll(/<colgroup>.*?<\/colgroup>/g)].map(match => match[0]);
assert.equal(columnGroups.length, 4);
assert.equal(new Set(columnGroups).size, 1);
assert.match(report, /Evaluado con equipos VALD y Kinvent/);
assert.match(report, /<ul class="report-notes"><li><b>Asimetría bilateral<\/b>/);
assert.match(report, /KOOS · Subescala de síntomas/);
assert.doesNotMatch(report, /VALD ForceDecks · máximo|Protocolo editable/);
assert.equal([...report.matchAll(/Dolor, síntomas, función y calidad de vida relacionados con la rodilla/g)].length, 1);
assert.match(report, /Cambio global percibido por el paciente desde el inicio/);
assert.doesNotMatch(report, /Tamizaje de siete patrones/);
assert.equal(vm.runInContext("reportNotes([{group:'force', format:'single', protocol:'Medición manual'}])", context), '');
assert.match(vm.runInContext("reportNotes([{group:'force', equipment:'Kinvent'}])", context), /equipos Kinvent\./);
assert.doesNotMatch(report, /No es necesario reevaluar la asimetría/);
assert.match(report, /class="outcome"><strong class="status-tag green">✓ Logrado<\/strong><\/td>/);
assert.match(report, /<b>Médico que deriva:<\/b> [^<]*<\/div><div><b>Diagnóstico:<\/b> [^<]*<\/div><div class="meta-dates"><span><b>Inicial:<\/b> 21-10-2026<\/span><span><b>Control:<\/b> 09-11-2026/);
assert.match(report, /11-11-2026/);
assert.match(report, /20-11-2026/);
assert.match(report, /Menor asimetría/);
assert.match(report, /class="outcome"><strong class="status-tag yellow">Sin cambio/);
assert.match(report, /class="outcome"><strong class="status-tag green">Mejoró/);
assert.match(report, /class="outcome"><strong class="status-tag red">No mejoró/);
assert.match(report, /class="outcome"><strong class="status-tag green">Mejoró/);
assert.match(report, /class="outcome"><strong class="status-tag red">No mejoró/);
assert.match(report, /Asim\. 1,74 %/);
assert.match(report, /Médico que deriva/);
assert.doesNotMatch(report, /Motivo anterior/);
vm.runInContext("editors()", context);
assert.match(nodes.get('painedit').innerHTML, /No mejoró/);
assert.match(nodes.get('forceedit').innerHTML, /No mejoró/);
assert.doesNotMatch(report, /Valoración profesional|Asimetría de control|25 pp/);

const connector = fs.readFileSync(path.join(app, 'connector.js'), 'utf8');
const boundary = connector.slice(connector.indexOf('function chileDayBoundary'), connector.indexOf('async function loadTests'));
vm.runInContext(boundary, context);
assert.equal(vm.runInContext("chileDayBoundary('2026-11-11',true)", context), '2026-11-12T03:00:00.000Z');
assert.equal(vm.runInContext("chileDayBoundary('2026-07-11',true)", context), '2026-07-12T04:00:00.000Z');
console.log('Informe, semáforo, fechas y límites horarios correctos.');

const savedCase = {
  center: 'SB',
  patient: 'Paciente de prueba',
  diagnosis: 'Diagnóstico guardado',
  clinicalNextStep: 'Control siguiente',
  rows: [{ group: 'pain', name: 'EVA', initial: 8, current: 2, mode: 'auto' }],
  brands: { SB: { name: 'Centro guardado', logo: 'https://invalid.example/logo.png' } },
  localDefaults: { emailByCenter: { SB: 'descartar@example.invalid' } },
};
context.savedHtml = '<script id="state" type="application/json">' + JSON.stringify(savedCase) +
  '</script><script>throw Error("No ejecutar HTML importado")</script>';
vm.runInContext('data=savedReportState(savedHtml); editors(); report()', context);
const reopened = nodes.get('report').innerHTML;
assert.match(reopened, /Paciente de prueba/);
assert.match(reopened, /Diagnóstico guardado/);
assert.match(reopened, /8 \/ 10/);
assert.match(reopened, /Control siguiente/);
assert.match(reopened, /status-tag green/);
assert.doesNotMatch(reopened, /invalid\.example|descartar@example/);
assert.throws(() => vm.runInContext('savedReportState("<html>Otro archivo</html>")', context), /HTML editable/);
assert.throws(() => vm.runInContext('savedReportState(savedHtml.replace(\'"SB"\', \'"Otro"\'))', context), /formato incompatible/);

vm.runInContext(`
 const leftTest={group:'force',format:'sides',name:'Extensión rodilla',protocol:'Kinvent · sentado izquierda',
   unit:'kgf',li:30,initialDate:'12-11-2026',initialTest:'left-test',importKey:'kinvent|p1|metric|max|left'};
 const rightTest={...leftTest,protocol:'Kinvent · sentado derecha',li:'',ri:28,
   initialTest:'right-test',importKey:'kinvent|p1|metric|max|right'};
 data.rows=[leftTest,rightTest];
`,context);
assert.equal(vm.runInContext('joinedRow(pairedRows(leftTest,rightTest)).ri',context),28);
assert.equal(vm.runInContext("pairedRows(leftTest,{...rightTest,initialDate:'13-11-2026'})",context),null);
assert.equal(vm.runInContext("pairedRows(leftTest,{...rightTest,protocol:'Kinvent · de pie'})",context),null);
assert.equal(vm.runInContext("pairedRows(leftTest,{...rightTest,importKey:'kinvent|p2|metric|max|right'})",context),null);
const autoJoin=connector.slice(connector.indexOf('function autoJoinImportedRow'),connector.indexOf('function saveMetricRow'));
vm.runInContext(autoJoin,context);
vm.runInContext("autoJoinImportedRow(1,{source:'kinvent',id:'p1'})",context);
assert.equal(vm.runInContext('data.rows.length',context),1);
assert.equal(vm.runInContext('data.rows[0].li',context),30);
assert.equal(vm.runInContext('data.rows[0].ri',context),28);
vm.runInContext("data.rows=[leftTest,{...leftTest,initialTest:'another-left'},rightTest]; autoJoinImportedRow(2,{source:'kinvent',id:'p1'})",context);
assert.equal(vm.runInContext('data.rows.length',context),3);

const dynamoHelpers=connector.slice(connector.indexOf('function dynamoLateralResponse'),connector.indexOf('async function applyComparison'));
vm.runInContext(connector.slice(connector.indexOf('function evaluationDate'),connector.indexOf('function importMetric')),context);
vm.runInContext(dynamoHelpers,context);
vm.runInContext(`
 const dynTest={source:'dyn',kind:'rom'};
 function dynRecord(side,date,value,protocol='Sentado'){
  const response=dynamoLateralResponse(dynTest,{test:side+date,date,metrics:[{
   name:'Tronco · Rotación '+side,group:'rom',unit:'°',protocol,method:'Resumen',
   fingerprint:side,values:{value}
  }]});
  return {test:dynTest,response};
 }
 const dl=dynRecord('izquierda','2026-11-10T21:04:00Z',93.94);
 const dr=dynRecord('derecha','2026-11-10T21:05:00Z',89.65);
 const dl2=dynRecord('izquierda','2026-11-11T21:04:00Z',95);
 const dr2=dynRecord('derecha','2026-11-11T21:05:00Z',93);
 const dm=dl.response.metrics[0];
 const sessions=linkedDynamoSessions(dm,dynTest,dl.response,[dr,dl2,dr2]);
`,context);
assert.equal(vm.runInContext('sessions.length',context),2);
assert.equal(vm.runInContext('sessions[0].metric.values.left',context),93.94);
assert.equal(vm.runInContext('sessions[0].metric.values.right',context),89.65);
assert.equal(vm.runInContext("linkedDynamoSessions(dm,dynTest,dl.response,[dynRecord('derecha','2026-11-10T21:05:00Z',89.65,'De pie')]).length",context),0);
assert.equal(vm.runInContext("linkedDynamoSessions(dm,dynTest,dl.response,[dr,dynRecord('derecha','2026-11-10T21:06:00Z',90)]).length",context),0);
