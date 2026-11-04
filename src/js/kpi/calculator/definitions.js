// FILE CONTRACT: versioned metadata for implemented KPI formulas.
// These definitions describe mathematical transformations only, not targets or dashboard status thresholds.

(() => {
  'use strict';

  function definition(id, title, unit, formula, sourceComponents, methodologyStatus = 'draft', formulaVersion = '1.0.0') {
    return Object.freeze({
      id,
      title,
      unit,
      formula,
      formulaVersion,
      methodologyStatus,
      sourceComponents: Object.freeze(sourceComponents.slice())
    });
  }

  const builtInDefinitions = {
    vbr: definition(
      'vbr', 'ВБР', '%',
      '(1 - FailureCount / EquipmentCount) × 100',
      ['failure_events', 'equipment_population'], 'draft', '1.0.1'
    ),
    ktg: definition(
      'ktg', 'КТГ', '%',
      '(CalendarHours - IncidentHours - ActualMaintenanceHours - UnplannedMaintenanceHours - OtherHours) / (CalendarHours - PlannedMaintenanceHours) × 100',
      ['ktg_fleet','ktg_work'], 'draft', '2.0.1'
    ),
    sla: definition(
      'sla', 'SLA', '%',
      'SlaSuccessCount / SlaTotalCount × 100',
      ['sla']
    ),
    classification_quality: definition(
      'classification_quality', 'Качество классификации общее', '%',
      'A / (A + B + C + D) × 100',
      ['classification_quality'], 'draft', '1.1.0'
    ),
    classification_quality_cgps: definition(
      'classification_quality_cgps', 'Качество классификации ЦГПС', '%',
      'A_MB / (A_MB + B_MB + C_MB + D_CGPS_MB) × 100',
      ['classification_quality_cgps'], 'draft', '1.0.0'
    ),
    total_labor: definition(
      'total_labor', 'Общая трудоёмкость', 'чел.-ч',
      'Σ LaborHours',
      ['mobile_brigade_labor']
    ),
    avr_labor: definition(
      'avr_labor', 'АВР', 'чел.-ч',
      'Σ LaborHours, FinalTaskType = АВР',
      ['mobile_brigade_labor']
    ),
    avr_share: definition(
      'avr_share', 'Доля АВР', '%',
      'AvrLaborHours / TotalLaborHours × 100',
      ['mobile_brigade_labor']
    ),
    maintenance_labor: definition(
      'maintenance_labor', 'ТО', 'чел.-ч',
      'Σ LaborHours, FinalTaskType ∈ {ТО по графику, ТО вне графика}',
      ['mobile_brigade_labor']
    ),
    corrective_labor: definition(
      'corrective_labor', 'Корректирующие мероприятия', 'чел.-ч',
      'Σ LaborHours, FinalTaskType = Корректирующее воздействие',
      ['mobile_brigade_labor']
    ),
    reactive_share: definition(
      'reactive_share', 'Доля реактивной деятельности', '%',
      '(AvrLaborHours + CorrectiveLaborHours) / TotalLaborHours × 100',
      ['mobile_brigade_labor']
    ),
    problem_linked_tasks: definition(
      'problem_linked_tasks', 'Задачи, связанные с ИТ-проблемами', 'задач',
      'Σ LinkedTaskCount',
      ['problem_management']
    ),
    problem_task_coverage: definition(
      'problem_task_coverage', 'Доля задач, связанных с ИТ-проблемами', '%',
      'LinkedTaskCount / TaskCount × 100',
      ['problem_management']
    ),
    problem_active_count: definition(
      'problem_active_count', 'ИТ-проблемы с зарегистрированными работами', 'проблем',
      'COUNT_DISTINCT(ProblemId WHERE ProblemLinkState = linked)',
      ['problem_management']
    ),
    problem_coverage_absolute: definition(
      'problem_coverage_absolute', 'Охват управлением проблемами', 'чел.-ч',
      'Σ LinkedLaborHours',
      ['problem_management']
    ),
    problem_coverage_relative: definition(
      'problem_coverage_relative', 'Доля трудозатрат под управлением проблемами', '%',
      'LinkedLaborHours / LaborHours × 100',
      ['problem_management']
    )
  };
  const extra=globalThis.ReclassifierKpiDeclarative;
  for(const d of extra?.definitions||[]){
    if(builtInDefinitions[d.id])
      throw new Error('Declarative KPI conflicts with existing formula '+d.id);
  }
  const definitions=Object.freeze({
    ...builtInDefinitions,
    ...Object.fromEntries((extra?.definitions||[]).map(d=>[d.id,extra.calculatorFormula(d.id)]))
  });

  globalThis.ReclassifierKpiDefinitions = definitions;
  if (typeof module !== 'undefined' && module.exports) module.exports = definitions;
})();
