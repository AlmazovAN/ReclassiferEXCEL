const RCA_STATUSES = {
  draft: 'Создана', investigation: 'Расследование', actions_planned: 'КД/ПД разработаны',
  execution: 'Исполнение', monitoring: 'Контроль результата', closed: 'Закрыта', archived: 'Архив'
};

function rcaDisplayId(problem) {
  return problem.prbNumber || 'LOCAL-' + problem.id;
}

function normalizeRcaPrb(value) {
  const prb = value.trim().toUpperCase();
  if (prb && !/^PRB[0-9]+$/.test(prb)) throw new Error('Укажите PRB и цифры, например PRB123.');
  return prb || null;
}

function checkRcaPrb(problem, rows) {
  const prb = normalizeRcaPrb(problem.prbNumber ?? '');
  if (prb && Array.from(rows).some(row => row.id !== problem.id &&
      row.prbNumber?.trim().toUpperCase() === prb)) {
    throw new Error('Этот номер PRB уже используется.');
  }
}

function filterRcaRegistry(rows, query) {
  const term = query.trim().toLocaleLowerCase('ru');
  return rows.filter(row => [rcaDisplayId(row), row.title, row.equipment]
    .some(value => value.toLocaleLowerCase('ru').includes(term)));
}
