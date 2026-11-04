// FILE CONTRACT: reliability dashboard presentation template.
// Purpose: define report sections, card order and unsupported placeholders.
// Owns: titles/layout metadata only.
// Reads: nothing.
// Writes: one deeply frozen read-only template.
// Must not: contain KPI values, demo scaling factors, source facts or calculation logic.

  function freezeReliabilityDashboardValue(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freezeReliabilityDashboardValue);
    return Object.freeze(value);
  }

  function reliabilityPlaceholder(id, title, unit = '%') {
    return {
      id,
      title,
      unit,
      calculationState: 'not-implemented'
    };
  }

  const reliabilityDashboardData = freezeReliabilityDashboardValue({
    schemaVersion: '2.0.0',
    mode: 'report-snapshot',
    report: {
      title: 'Отчёт по надёжности СДГР'
    },
    filters: {
      disclaimer: 'Фильтры применяются к текущему Report Snapshot. Неподдерживаемый срез не подменяется приближённым значением.'
    },
    kpiGroups: {
      dataQuality: [
        { id: 'classification_quality', title: 'Качество классификации общее', unit: '%' },
        { id: 'classification_quality_cgps', title: 'Качество классификации ЦГПС', unit: '%' },
        reliabilityPlaceholder('required_fields_completeness', 'Полнота обязательных данных'),
        reliabilityPlaceholder('confirmed_failures_share', 'Доля подтверждённых отказов'),
        reliabilityPlaceholder('data_freshness', 'Свежесть данных')
      ],
      technicalReliability: [
        { id: 'vbr', title: 'ВБР', unit: '%' },
        { id: 'ktg', title: 'КТГ', unit: '%' }
      ],
      organizationalReadiness: [
        reliabilityPlaceholder('kog', 'КОГ'),
        { id: 'sla', title: 'SLA', unit: '%' },
        reliabilityPlaceholder('service_level', 'Уровень сервиса')
      ]
    },
    labor: {
      summaryKpis: [
        { id: 'total_labor', title: 'Общая трудоёмкость', unit: 'чел.-ч' },
        { id: 'avr_labor', title: 'АВР', unit: 'чел.-ч' },
        { id: 'maintenance_labor', title: 'ТО', unit: 'чел.-ч' },
        { id: 'corrective_labor', title: 'Корректирующие мероприятия', unit: 'чел.-ч' },
        { id: 'reactive_share', title: 'Доля реактивной деятельности', unit: '%' }
      ]
    },
    problemManagement: {
      summaryKpis: [
        { id: 'problem_coverage_absolute', title: 'Охват трудозатрат управлением проблемами', unit: 'чел.-ч' },
        { id: 'problem_coverage_relative', title: 'Доля трудозатрат, связанных с ИТ-проблемами', unit: '%' },
        { id: 'problem_linked_tasks', title: 'Задачи, связанные с ИТ-проблемами', unit: 'задач' },
        { id: 'problem_task_coverage', title: 'Доля связанных задач', unit: '%' },
        { id: 'problem_active_count', title: 'ИТ-проблемы с выполненными работами', unit: 'проблем' },
        reliabilityPlaceholder('confirmed_labor_reduction', 'Подтверждённый эффект', 'чел.-ч')
      ]
    }
  });

  globalThis.ReclassifierReliabilityDashboardData = reliabilityDashboardData;
