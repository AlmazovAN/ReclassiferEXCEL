// FILE CONTRACT: KPI Source presentation helpers for Reference detail.
// Purpose: keep KPI-specific schema/metrics markup out of the shared Reference detail component.
// Reads: Dataset instance metadata and shared escape/date helpers.
// Writes: no state.
// Public API: renderKpiSourceReferenceSchema, renderKpiSourceReferenceMetrics.
// Must not: mutate datasets, parse files or own persistence.

  function renderKpiSourceReferenceSchema(instance) {
    const fields = instance?.meta?.fields || [];
    const columns = instance?.meta?.columns || [];
    const dimensions = new Set([
      'rowType', 'year', 'month', 'period', 'branch', 'mine',
      'equipmentType', 'equipmentName'
    ]);
    const references = new Set(['equipmentCount', 'personnelCount']);
    const rows = fields.map((field, index) => {
      const group = dimensions.has(field)
        ? 'измерение'
        : (references.has(field) ? 'справочное' : 'агрегат');
      return '<tr><td>' + escapeHtml(columns[index] || field) + '</td>' +
        '<td><code>' + escapeHtml(field) + '</code></td>' +
        '<td>' + group + '</td><td>данные</td></tr>';
    }).join('');

    return {
      schemaHtml: '<div class="notice">Набор формируется автоматически из обработки ITSM. Одна строка — агрегат за период и комбинацию измерений.</div>',
      outputHtml: '<div class="table-scroll"><table class="reference-table compact-table">' +
        '<thead><tr><th>Поле</th><th>ID</th><th>Группа</th><th>Роль</th></tr></thead><tbody>' +
        rows + '</tbody></table></div>'
    };
  }

  function renderKpiSourceReferenceMetrics(instance) {
    const meta = instance?.meta || {};
    return '<div><span>Агрегированных строк</span><strong>' +
      escapeHtml(meta.normalizedRows ?? instance?.records?.length ?? '—') + '</strong></div>' +
      '<div><span>Полей</span><strong>' + escapeHtml(meta.fieldCount ?? 22) + '</strong></div>' +
      '<div><span>Исходных строк ITSM</span><strong>' + escapeHtml(meta.sourceRows ?? '—') + '</strong></div>' +
      '<div><span>Покрытие от</span><strong>' +
      escapeHtml(mobileBrigadeFormatIsoDate(meta.earliestSourceDate)) + '</strong></div>' +
      '<div><span>Покрытие до</span><strong>' +
      escapeHtml(mobileBrigadeFormatIsoDate(meta.latestSourceDate)) + '</strong></div>' +
      '<div><span>Источник</span><strong>Авто из ITSM</strong></div>';
  }
