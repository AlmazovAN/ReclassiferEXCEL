function selectRcaInc(number, type, hasType) {
  const id = String(number ?? '').trim().toUpperCase();
  return hasType
    ? /^(?:INC|RITM)\d+$/.test(id) && String(type ?? '').trim().toUpperCase() === 'INC' ? id : null
    : /^INC\d+$/.test(id) ? id : null;
}

function normalizeRcaMetricProblem(value) {
  const prb = String(value ?? '').trim().toUpperCase();
  return /^PRB\d+$/.test(prb) ? prb : null;
}

function parseRcaCompletedDate(value, date1904 = false) {
  if (value instanceof Date) return Number.isFinite(+value) ? value.toISOString().slice(0,10) : null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date((Math.floor(value) - (date1904 ? 24107 : 25569)) * 86400000);
    return Number.isFinite(+date) ? date.toISOString().slice(0,10) : null;
  }
  const text = String(value ?? '').trim();
  const local = /^(\d{2})\.(\d{2})\.(\d{4})(?:$|\s)/.exec(text);
  const day = local ? [local[3], local[2], local[1]].join('-') : /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/.exec(text)?.[1];
  return validRcaDay(day) ? day : null;
}

function parseRcaLaborHours(value) {
  if (value == null || String(value).trim() === '') return 0;
  const text = String(value).trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const hours = Number(text);
  return Number.isFinite(hours) ? hours : null;
}

async function aggregateRcaItsm(rows, normalizeMine, progress = () => {}, sample = () => {}) {
  const incidents = new Map();
  const diagnostics = {rows:0, nonInc:0, missingPrb:0, missingDate:0, invalidHours:0,
    zeroHours:0, duplicates:0, conflicts:0, counted:0, withoutFinalType:0};
  for await (const row of rows) {
    diagnostics.rows++;
    if (diagnostics.rows % 10000 === 0) { sample(); progress('Прочитано строк: ' + diagnostics.rows); }
    if (!row.hasType) diagnostics.withoutFinalType++;
    const inc = selectRcaInc(row.inc, row.type, row.hasType);
    if (!inc) { diagnostics.nonInc++; continue; }
    const prb = normalizeRcaMetricProblem(row.prb);
    const day = parseRcaCompletedDate(row.day, row.date1904);
    const hours = parseRcaLaborHours(row.hours);
    if (!prb) diagnostics.missingPrb++;
    if (!day) diagnostics.missingDate++;
    if (hours === null) diagnostics.invalidHours++;
    const key = JSON.stringify([prb, normalizeMine(row.site), day, hours]);
    if (!incidents.has(inc)) incidents.set(inc, key);
    else if (incidents.get(inc) === key) diagnostics.duplicates++;
    else if (incidents.get(inc) !== null) { incidents.set(inc, null); diagnostics.conflicts++; }
  }
  const days = new Map();
  for (const value of incidents.values()) {
    if (!value) continue;
    const [prb, site, day, hours] = JSON.parse(value);
    if (!prb || !day || hours === null) continue;
    const key = JSON.stringify([prb, site, day]);
    if (!days.has(key)) days.set(key, {prb,site,day,incCount:0,mbLaborHours:0});
    const total = days.get(key);
    total.incCount++;
    total.mbLaborHours += hours;
    diagnostics.counted++;
    if (!hours) diagnostics.zeroHours++;
  }
  sample();
  return {days:[...days.values()], diagnostics};
}
