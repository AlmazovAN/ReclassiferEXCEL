const RCA_ITSM_RULES = 'itsm-daily-v1';
const RCA_DAY = /^\d{4}-\d{2}-\d{2}$/;
function validRcaDay(value) {
  return typeof value === 'string' && RCA_DAY.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}

function normalizeRcaMetricSite(value) {
  return String(value ?? '').replace(/\s+/g,' ').trim().replace(/^(?:р\.|ш\.)\s*/i,'').trim().toLocaleLowerCase('ru-RU');
}

function validateRcaItsmIndex(index) {
  if (index?.schemaVersion !== 1 || typeof index.rules !== 'string' ||
      !/^[a-f0-9]{64}$/.test(index.sourceHash) || typeof index.source !== 'string' ||
      !Number.isFinite(Date.parse(index.calculatedAt)) || !Array.isArray(index.days) || !index.diagnostics) {
    throw new Error('Некорректный индекс расчётов ITSM.');
  }
  const keys = new Set();
  for (const row of index.days) {
    const key = JSON.stringify([row.prb, row.site, row.day]);
    if (!/^PRB\d+$/.test(row.prb) || typeof row.site !== 'string' || !validRcaDay(row.day) ||
        !Number.isSafeInteger(row.incCount) || row.incCount < 1 ||
        !Number.isFinite(row.mbLaborHours) || row.mbLaborHours < 0 || keys.has(key)) {
      throw new Error('Некорректная дневная запись ITSM.');
    }
    keys.add(key);
  }
  return index;
}
