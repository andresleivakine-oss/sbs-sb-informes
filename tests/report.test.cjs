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
  data.clinicalReason = 'Motivo anterior';
  data.clinicalFindings = 'Hallazgo simulado';
  data.rows = [
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
assert.match(report, /Hallazgo simulado/);
assert.equal([...report.matchAll(/No es necesario reevaluar la asimetría/g)].length, 1);
assert.match(report, /11-11-2026/);
assert.match(report, /20-11-2026/);
assert.match(report, /Asimetría ↓ 25 pp/);
assert.match(report, /class="outcome yellow"><strong>Igual/);
assert.match(report, /class="outcome green"><strong>Mejoró/);
assert.match(report, /class="outcome red"><strong>No mejoró/);
assert.match(report, /class="outcome green"><strong>Mejoría/);
assert.match(report, /class="outcome red"><strong>Debe mejorar/);
assert.match(report, /Logrado<\/strong><small>Asimetría de control 1,74 %/);
assert.match(report, /Médico que deriva/);
assert.doesNotMatch(report, /Motivo anterior/);
vm.runInContext("editors()", context);
assert.match(nodes.get('painedit').innerHTML, /Debe mejorar/);
assert.match(nodes.get('forceedit').innerHTML, /No mejoró/);
assert.match(report, /&lt;0,01 %/);

const connector = fs.readFileSync(path.join(app, 'connector.js'), 'utf8');
const boundary = connector.slice(connector.indexOf('function chileDayBoundary'), connector.indexOf('async function loadTests'));
vm.runInContext(boundary, context);
assert.equal(vm.runInContext("chileDayBoundary('2026-11-11',true)", context), '2026-11-12T03:00:00.000Z');
assert.equal(vm.runInContext("chileDayBoundary('2026-07-11',true)", context), '2026-07-12T04:00:00.000Z');
console.log('Informe, semáforo, fechas y límites horarios correctos.');
