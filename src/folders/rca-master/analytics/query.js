function rcaMetricWindow(months, to) {
  if (![1,3,6].includes(months) || !validRcaDay(to)) throw new Error('Некорректный период ITSM.');
  const end = new Date(to);
  const from = new Date(end);
  from.setUTCDate(1);
  from.setUTCMonth(from.getUTCMonth() - months);
  const last = new Date(from);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  from.setUTCDate(Math.min(end.getUTCDate(), last.getUTCDate()) + 1);
  return {from:from.toISOString().slice(0,10),to};
}

function getRcaMetric(index, prb, site, from, to) {
  if (!validRcaDay(from) || !validRcaDay(to) || from > to) throw new Error('Некорректные даты ITSM.');
  let incCount = 0;
  let mbLaborHours = 0;
  for (const row of index.days) {
    if (row.prb !== prb || (site && row.site !== site) || row.day < from || row.day > to) continue;
    incCount += row.incCount;
    mbLaborHours += row.mbLaborHours;
  }
  return {incCount, mbLaborHours};
}

function renderRcaMetrics(problem, analytics) {
  const panel = rcaElement('section', '', 'card');
  const label = rcaElement('label', 'Период ');
  const period = rcaElement('select');
  for (const [months, caption] of [[1,'За 1 месяц'],[3,'За 3 месяца'],[6,'За 6 месяцев']]) {
    const option = rcaElement('option', caption);
    option.value = months;
    period.append(option);
  }
  period.value = analytics.months;
  label.append(period);
  const output = rcaElement('div');
  const status = rcaElement('p', analytics.status);
  status.setAttribute('role','status');
  function show() {
    output.replaceChildren();
    const index = analytics.index;
    if (!index || !problem.prbNumber) {
      output.append(rcaElement('p', problem.prbNumber ? 'Нет опубликованных расчётов.' : 'Укажите номер PRB для отбора.'));
      return;
    }
    const now = new Date();
    const to = new Date(now.getTime() - now.getTimezoneOffset()*60000).toISOString().slice(0,10);
    const window = rcaMetricWindow(Number(period.value),to);
    const site = analytics.normalizeSite(problem.location);
    const metrics = getRcaMetric(index,problem.prbNumber.toUpperCase(),site,window.from,window.to);
    output.append(rcaElement('p', window.from + ' — ' + window.to + ' · ' + (site ? problem.location : 'Все участки')));
    if (metrics.incCount) {
      output.append(rcaElement('p','Количество INC по проблеме: ' + metrics.incCount),
        rcaElement('p','Человеко-часов по проблеме (по данным МБ): ' + metrics.mbLaborHours.toLocaleString('ru')));
    } else output.append(rcaElement('p', !index.days.length && index.diagnostics.missingDate
      ? 'Нет учтённых записей с датой выполнения. Проверьте диагностику источника.'
      : 'Нет совпадений за период.'));
    output.append(rcaElement('small',index.source + ' · ' + new Date(index.calculatedAt).toLocaleString('ru') +
      ' · строк без даты: ' + index.diagnostics.missingDate + ' · конфликтов INC: ' + index.diagnostics.conflicts +
      ' · строк без связи PRB: ' + index.diagnostics.missingPrb +
      ' · строк с неверными часами: ' + index.diagnostics.invalidHours));
  }
  period.addEventListener('change', () => { analytics.months = Number(period.value); show(); });
  const refresh = rcaButton('Обновить расчёты',analytics.refresh);
  refresh.disabled = analytics.busy;
  panel.append(rcaElement('h2','Расчёты ITSM'),label,refresh,status,output);
  show();
  return panel;
}
