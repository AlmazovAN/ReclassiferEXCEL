const assert = require('node:assert/strict');

require('../src/js/kpi/calculator/common.js');
require('../src/js/kpi/calculator/definitions.js');
require('../src/js/kpi/calculator/vbr/calculate.js');
require('../src/js/kpi/calculator/ktg/calculate.js');
require('../src/js/kpi/calculator/sla/calculate.js');
require('../src/js/kpi/calculator/classification_quality/calculate.js');
require('../src/js/kpi/calculator/classification_quality_cgps/calculate.js');
require('../src/js/kpi/calculator/labor/calculate.js');
require('../src/js/kpi/calculator/problem_management/calculate.js');
require('../src/js/kpi/calculator/index.js');

const calculator = globalThis.ReclassifierKpiCalculator;
assert.ok(calculator, 'KPI Calculator API was not exported.');
assert.equal(calculator.version, '1.0.0');

function assertNear(actual, expected, epsilon = 1e-9) {
  assert.ok(Number.isFinite(actual), 'Expected a finite numeric KPI value.');
  assert.ok(Math.abs(actual - expected) <= epsilon,
    'Expected ' + actual + ' to be within ' + epsilon + ' of ' + expected);
}

const prepared = {
  version: '1.0.0',
  families: {
    failures: {
      events: {
        id: 'failure_events',
        rows: [
          {
            period: '2026-10-01',
            branch: 'КФ',
            mine: 'Северный',
            equipmentType: 'Навесное оборудование',
            equipmentName: 'БКМ',
            failureCount: 5
          }
        ],
        meta: { periodBasis: 'completedAt' }
      }
    },
    equipment: {
      id: 'equipment_population',
      rows: [
        {
          snapshotDate: '2026-10-01',
          organizationalUnit: 'Северный',
          equipmentType: 'Навесное оборудование',
          equipmentName: 'БКМ',
          sourceCatalog: 'Mounted',
          equipmentCount: 100
        },
        {
          snapshotDate: '2026-10-01',
          organizationalUnit: 'Таймырский',
          equipmentType: 'Навесное оборудование',
          equipmentName: 'БКМ',
          sourceCatalog: 'Mounted',
          equipmentCount: 20
        }
      ],
      meta: {
        snapshotDate: '2026-10-01',
        snapshotKind: 'current-snapshot',
        supportsHistoricalPeriods: false
      }
    },
    sla: {
      id: 'sla',
      rows: [
        {
          period: '2026-09-01', branch: 'КФ', mine: 'Северный',
          equipmentType: 'Навесное оборудование', equipmentName: 'БКМ',
          slaSuccessCount: 8, slaOverdueCount: 2, slaTotalCount: 10
        },
        {
          period: '2026-10-01', branch: 'КФ', mine: 'Северный',
          equipmentType: 'Навесное оборудование', equipmentName: 'БКМ',
          slaSuccessCount: 9, slaOverdueCount: 1, slaTotalCount: 10
        }
      ],
      meta: { unknownSlaRows: 3 }
    },
    classification: {
      id: 'classification_quality',
      rows: [
        {
          period: '2026-10-01', branch: 'КФ', mine: 'Северный',
          equipmentType: 'Навесное оборудование', equipmentName: 'БКМ',
          classificationSuccessCount: 8,
          classificationFailureCount: 2,
          classificationTotalCount: 10,
          classificationIncUnchangedCount: 8,
          classificationIncCorrectedCount: 1,
          classificationIncUnclassifiedCount: 0,
          classificationRitmInsteadOfIncCount: 1
        }
      ],
      meta: { notApplicableRows: 4 }
    },
    labor: {
      id: 'mobile_brigade_labor',
      rows: [
        {
          period: '2026-10-01', site: 'Северный', finalTaskType: 'АВР',
          equipmentPlacement: 'Навесное', equipmentType: 'БКМ', equipmentName: 'ПДМ-1',
          taskCount: 10, usableLaborTaskCount: 10, unusableLaborTaskCount: 0,
          zeroLaborTaskCount: 0, laborHours: 40
        },
        {
          period: '2026-10-01', site: 'Северный', finalTaskType: 'Корректирующее воздействие',
          equipmentPlacement: 'Навесное', equipmentType: 'БКМ', equipmentName: 'ПДМ-1',
          taskCount: 5, usableLaborTaskCount: 5, unusableLaborTaskCount: 0,
          zeroLaborTaskCount: 0, laborHours: 15
        },
        {
          period: '2026-10-01', site: 'Северный', finalTaskType: 'ТО по графику',
          equipmentPlacement: 'Навесное', equipmentType: 'БКМ', equipmentName: 'ПДМ-1',
          taskCount: 5, usableLaborTaskCount: 5, unusableLaborTaskCount: 0,
          zeroLaborTaskCount: 0, laborHours: 20
        },
        {
          period: '2026-10-01', site: 'Северный', finalTaskType: 'ТО вне графика',
          equipmentPlacement: 'Навесное', equipmentType: 'БКМ', equipmentName: 'ПДМ-1',
          taskCount: 3, usableLaborTaskCount: 3, unusableLaborTaskCount: 0,
          zeroLaborTaskCount: 0, laborHours: 10
        },
        {
          period: '2026-10-01', site: 'Северный', finalTaskType: 'Прочее',
          equipmentPlacement: 'Навесное', equipmentType: 'БКМ', equipmentName: 'ПДМ-1',
          taskCount: 5, usableLaborTaskCount: 4, unusableLaborTaskCount: 1,
          zeroLaborTaskCount: 0, laborHours: 15
        }
      ],
      meta: {
        laborStateCounts: { valid: 27, missing: 1 },
        rowsWithoutFactDate: 0,
        rowsWithoutFinalTaskType: 0
      }
    },
    prb: {
      id: 'problem_management',
      rows: [
        {
          period: '2026-10-01', branch: 'КФ', mine: 'Северный',
          finalTaskType: 'АВР', problemLinkState: 'linked', problemId: 'PRB001047',
          taskCount: 6, usableLaborTaskCount: 6, unusableLaborTaskCount: 0,
          laborHours: 30, linkedTaskCount: 6, linkedLaborHours: 30
        },
        {
          period: '2026-10-01', branch: 'КФ', mine: 'Северный',
          finalTaskType: 'ТО по графику', problemLinkState: 'not-linked', problemId: null,
          taskCount: 14, usableLaborTaskCount: 14, unusableLaborTaskCount: 0,
          laborHours: 70, linkedTaskCount: 0, linkedLaborHours: 0
        }
      ],
      meta: { linkage: { rows: 20, problemLinkedRows: 6 } }
    }
  }
};

const vbr = calculator.calculateOne('vbr', prepared, {
  period: '2026-10-01',
  filters: {
    mine: 'Северный',
    equipmentType: 'Навесное оборудование',
    equipmentName: 'БКМ'
  }
});
assert.equal(vbr.dataState, 'available');
assertNear(vbr.value, 95);
assert.deepEqual(vbr.components, { failureCount: 5, equipmentCount: 100 });
assert.equal(vbr.diagnostics.selectedFailureComponentGroups,1);
assert.equal(vbr.diagnostics.globalFailureCount,5);
assert.deepEqual(vbr.diagnostics.missingItsmMonths,[]);
assert.equal(vbr.formulaVersion, '1.0.1');
assert.equal(vbr.methodologyStatus, 'draft');
assert.ok(Object.isFrozen(vbr));

const zeroFailureVbr = calculator.calculateOne('vbr', prepared, {
  period: '2026-10-01',
  filters: {
    mine: 'Таймырский',
    equipmentType: 'Навесное оборудование',
    equipmentName: 'БКМ'
  }
});
assert.equal(zeroFailureVbr.dataState, 'available');
assertNear(zeroFailureVbr.value, 100);
assert.equal(zeroFailureVbr.components.failureCount, 0);
assert.equal(zeroFailureVbr.components.equipmentCount, 20);

const historicalVbr = calculator.calculateOne('vbr', prepared, {
  period: '2026-09-01',
  filters: { mine: 'Северный' }
});
assert.equal(historicalVbr.value,null);
assert.equal(historicalVbr.dataState, 'no-data');
assert.equal(historicalVbr.reason,'itsm-period-without-observations');
assert.deepEqual(historicalVbr.diagnostics.missingItsmMonths,['2026-09']);
assert.equal(historicalVbr.diagnostics.populationBasis,'fixed-drivers-reference');
assert.equal(historicalVbr.diagnostics.historicalPopulationAvailable,false);

const rangeVbr = calculator.calculateOne('vbr', prepared, {
  period: { start: '2026-09-01', end: '2026-10-31' },
  filters: { mine: 'Северный' }
});
assertNear(rangeVbr.value,95);
assert.equal(rangeVbr.dataState,'available');
assert.equal(rangeVbr.reason,'partial-coverage');
assert.deepEqual(rangeVbr.components,{failureCount:5,equipmentCount:100});
assert.deepEqual(rangeVbr.diagnostics.missingItsmMonths,['2026-09']);
assert.deepEqual(rangeVbr.diagnostics.observedMonths,['2026-10']);
assert.equal(rangeVbr.diagnostics.requestedMonthCount,2);
assert.equal(rangeVbr.diagnostics.reportingMonths,1);
assert.equal(rangeVbr.diagnostics.partialCoverage,true);
assert.equal(rangeVbr.diagnostics.baselineEquipmentCount,100);
assert.equal(rangeVbr.diagnostics.staticDriversQuantityRepeatedPerMonth,false);
assert.equal(rangeVbr.formulaVersion,'1.0.1');
const decemberToOctober=calculator.calculateOne('vbr',prepared,{
  period:{start:'2025-12-01',end:'2026-10-31'},
  filters:{mine:'Северный'}
});
assert.equal(decemberToOctober.dataState,'available');
assertNear(decemberToOctober.value,95);
assert.deepEqual(decemberToOctober.diagnostics.missingItsmMonths,
 ['2025-12','2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08','2026-09']);
assert.equal(decemberToOctober.diagnostics.reportingMonths,1);

const unsupportedVbr = calculator.calculateOne('vbr', prepared, {
  period: '2026-10-01',
  filters: { branch: 'КФ' }
});
assert.equal(unsupportedVbr.reason, 'unsupported-filter');

const sla = calculator.calculateOne('sla', prepared, {
  period: '2026-10-01',
  filters: { mine: 'Северный' }
});
assertNear(sla.value, 90);
assert.deepEqual(sla.components, {
  slaSuccessCount: 9,
  slaOverdueCount: 1,
  slaTotalCount: 10
});
assert.equal(sla.diagnostics.source.unknownSlaRows, 3);

const slaRange = calculator.calculateOne('sla', prepared, {
  period: { start: '2026-09-01', end: '2026-10-31' },
  filters: { mine: 'Северный' }
});
assertNear(slaRange.value, 85);
assert.equal(slaRange.components.slaSuccessCount, 17);
assert.equal(slaRange.components.slaTotalCount, 20);

const classification = calculator.calculateOne('classification_quality', prepared, {
  period: '2026-10-01',
  filters: { mine: 'Северный' }
});
assertNear(classification.value, 80);
assert.deepEqual(classification.components, {
  classificationSuccessCount: 8,
  classificationFailureCount: 2,
  classificationTotalCount: 10,
  classificationIncUnchangedCount: 8,
  classificationIncCorrectedCount: 1,
  classificationIncUnclassifiedCount: 0,
  classificationRitmInsteadOfIncCount: 1
});
assert.equal(classification.formulaVersion, '1.1.0');

const totalLabor = calculator.calculateOne('total_labor', prepared, {
  period: '2026-10-01',
  filters: { mine: 'Северный' }
});
assert.equal(totalLabor.value, 100);
assert.equal(totalLabor.unit, 'чел.-ч');
assert.equal(totalLabor.components.taskCount, 28);
assert.equal(totalLabor.components.unusableLaborTaskCount, 1);

const avrLabor = calculator.calculateOne('avr_labor', prepared, {
  period: '2026-10-01',
  filters: { mine: 'Северный' }
});
assert.equal(avrLabor.value, 40);

const avrShare = calculator.calculateOne('avr_share', prepared, {
  period: '2026-10-01',
  filters: { mine: 'Северный' }
});
assertNear(avrShare.value, 40);
assert.deepEqual(avrShare.components, {
  avrLaborHours: 40,
  totalLaborHours: 100
});

const maintenanceLabor = calculator.calculateOne('maintenance_labor', prepared, {
  period: '2026-10-01',
  filters: { mine: 'Северный' }
});
assert.equal(maintenanceLabor.value, 30);

const correctiveLabor = calculator.calculateOne('corrective_labor', prepared, {
  period: '2026-10-01',
  filters: { mine: 'Северный' }
});
assert.equal(correctiveLabor.value, 15);

const reactiveShare = calculator.calculateOne('reactive_share', prepared, {
  period: '2026-10-01',
  filters: { mine: 'Северный' }
});
assertNear(reactiveShare.value, 55);
assert.deepEqual(reactiveShare.components, {
  avrLaborHours: 40,
  correctiveLaborHours: 15,
  reactiveLaborHours: 55,
  totalLaborHours: 100
});

const coverageAbsolute = calculator.calculateOne('problem_coverage_absolute', prepared, {
  period: '2026-10-01',
  filters: { mine: 'Северный' }
});
assert.equal(coverageAbsolute.value, 30);
assert.equal(coverageAbsolute.components.linkedLaborHours, 30);
assert.equal(coverageAbsolute.components.laborHours, 100);

const coverageRelative = calculator.calculateOne('problem_coverage_relative', prepared, {
  period: '2026-10-01',
  filters: { mine: 'Северный' }
});
assertNear(coverageRelative.value, 30);

const oneProblem = calculator.calculateOne('problem_coverage_relative', prepared, {
  period: '2026-10-01',
  filters: { problemId: 'PRB001047' }
});
assertNear(oneProblem.value, 100);

const noLaborPrepared = {
  families: {
    labor: {
      rows: [{
        period: '2026-10-01', site: 'Северный', finalTaskType: 'АВР',
        taskCount: 2, usableLaborTaskCount: 0, unusableLaborTaskCount: 2,
        laborHours: 0
      }],
      meta: { laborStateCounts: { missing: 2 } }
    }
  }
};
const unavailableLabor = calculator.calculateOne('total_labor', noLaborPrepared, {
  period: '2026-10-01'
});
assert.equal(unavailableLabor.value, null);
assert.equal(unavailableLabor.dataState, 'no-data');
assert.equal(unavailableLabor.reason, 'no-usable-labor');

const selected = calculator.calculate(prepared, {
  period: '2026-10-01',
  filters: { mine: 'Северный' },
  kpis: ['sla', 'classification_quality', 'total_labor', 'avr_share', 'problem_coverage_relative']
});
assert.equal(selected.architecture, 'pure-kpi-results');
assert.deepEqual(Object.keys(selected.results), [
  'sla',
  'classification_quality',
  'total_labor',
  'avr_share',
  'problem_coverage_relative'
]);
assertNear(selected.results.sla.value, 90);
assertNear(selected.results.avr_share.value, 40);
assert.ok(!Object.prototype.hasOwnProperty.call(selected, 'calculatedAt'),
  'Pure calculator must not inject current time; Report Snapshot will own calculation timestamp.');

assert.throws(
  () => calculator.calculateOne('not-a-kpi', prepared, {}),
  /Unknown KPI calculator/
);

console.log('KPI Calculator: VBR/SLA/classification/labor/reactive/Problem Management formulas OK');
