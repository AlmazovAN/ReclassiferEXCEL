(() => {
  'use strict';

  const datasetDefinition = globalThis.ReclassifierDatasetCatalog?.get?.('itsm_data');
  if (!datasetDefinition) throw new Error('Dataset Catalog is not loaded before ITSM Dataset Schema.');
  const fieldRegistry = globalThis.ReclassifierFieldRegistry;
  if (!fieldRegistry) throw new Error('Field Registry is not loaded before ITSM Dataset Schema.');

  const columns = [
    ['createdAt', 'Дата создания Вызова'],
    ['completedAt', 'Дата выполнения обращения'],
    ['closedAt', 'Дата закрытия'],
    ['number', 'Номер'],
    ['initiator', 'Инициатор'],
    ['state', 'Состояние'],
    ['territory', 'Территории MES'],
    ['sourceEquipment', 'Наименование оборудования'],
    ['sourceElement', 'Элемент'],
    ['sourceFault', 'Неисправность'],
    ['sourceReason', 'Причина инцидента'],
    ['shortDescription', 'Категорированная информация обращения.Краткое описание'],
    ['description', 'Категорированная информация обращения.Описание'],
    ['closureNote', 'Примечание к закрытию'],
    ['installationLocation', 'Место установки объекта обслуживания'],
    ['openedBy', 'Открыл'],
    ['closureCode', 'Код закрытия'],
    ['equipmentName', 'НаименованиеТехники'],
    ['driversByName', 'Драйверов по Нименованию'],
    ['driversByMine', 'Драйверов по Руднику'],
    ['result1EquipmentName', 'рез1 по Наименованию техники'],
    ['result3KtgEquipment', 'рез3 КТГ по Наименованию оборудования'],
    ['result4KtgMine', 'рез4 КТГ по Руднику'],
    ['initiatorGroup', 'Группа инициаторов'],
    ['result6LaborHours', 'рез6'],
    ['requestType', 'INC'],
    ['reclassifiedEquipment', 'Наим1'],
    ['reclassifiedElement', 'Элем1'],
    ['reclassifiedFault', 'Неис1'],
    ['reclassifiedReason', 'Прич1'],
    ['classificationQuality', 'Кач классификации'],
    ['typeAfterReclassification', 'INC после рекласс'],
    ['cgpsVbrDecision', 'ИсклВБР-ЦГПС'],
    ['sputnikVbrDecision', 'ИсклВБР-Спутник'],
    ['problemLink', 'Связан ли с ИТ-проблемой?'],
    ['sdgrService', 'Услуга СДГР (по наименованию)'],
    ['division', 'КФ/ЗФ'],
    ['workType', 'ТО/ Монтаж/ Разовое'],
    ['system', 'Система'],
    ['slaHours', 'Время статуса заявки в работе (SLA), час'],
    ['preBacklogHours', 'Время предбэклога (откр-выполн), час'],
    ['backlogLevelWeeks', 'Уровень бэклога, нед'],
    ['maxCrew4Allowed', 'Допустимо 4 чел в бригаде'],
    ['openedYear', 'ГодОткр'],
    ['openedMonth', 'МесОткр'],
    ['openedWeek', 'НедОткр'],
    ['openedDay', 'ДеньОткр'],
    ['closedYear', 'ГодЗакр'],
    ['closedMonth', 'МесЗакр'],
    ['closedWeek', 'НедЗакр'],
    ['completedLast14Days', 'Выполненные за последние 14 дней'],
    ['mbPresence', 'Наличие заявки в МБ']
  ].map(item => Object.freeze(item));

  const fieldMetadata = Object.freeze({
    closureNote: Object.freeze({
      label: 'Примечания к закрытию (объединённые с доп)',
      aliases: Object.freeze(['Примечание к закрытию', 'Примечания к закрытию'])
    }),
    driversByMine: Object.freeze({
      semanticName: 'driver_quantity_mine_legacy'
    }),
    result6LaborHours: Object.freeze({
      semanticName: 'mb_labor_total_hh',
      label: 'Трудоёмкость суммарно из МБ, ч-ч',
      aliases: Object.freeze(['рез6'])
    }),
    mbPresence: Object.freeze({
      semanticName: 'itsm_mobile_brigade_request_presence',
      label: 'Наличие заявки в МБ'
    }),
    classificationQuality: Object.freeze({
      semanticName: 'classification_quality_state'
    }),
    typeAfterReclassification: Object.freeze({
      semanticName: 'request_type_after_reclassification'
    }),
    sputnikVbrDecision: Object.freeze({
      semanticName: 'failure_accounting_decision'
    }),
    problemLink: Object.freeze({
      semanticName: 'problem_id'
    }),
    slaHours: Object.freeze({
      semanticName: 'sla_work_h'
    }),
    preBacklogHours: Object.freeze({
      semanticName: 'request_duration_h'
    })
  });

  fieldRegistry.registerDataset(datasetDefinition.id, columns.map(item => {
    const field = item[0];
    const sourceLabel = item[1];
    const metadata = fieldMetadata[field] || {};
    return {
      field,
      semanticName: metadata.semanticName || field,
      sourceLabel,
      label: metadata.label || sourceLabel,
      aliases: metadata.aliases || []
    };
  }));


  // The canonical read-only handoff to the Mobile Brigade Worker. ITSM stores
  // arrays ordered by fields; legacy datasets can also contain named objects.
  // All Excel-to-Mobile-Brigade enrichments use this same projection.
  function mobileBrigadeLinkRows(records, storedFields = null) {
    if (!Array.isArray(records)) {
      throw new Error('ITSM → МБ: записи ITSM должны быть массивом.');
    }
    if (!records.length) return [];
    const orderedFields = storedFields == null
      ? columns.map(item => item[0])
      : storedFields;
    const hasArrays = records.some(Array.isArray);
    if (hasArrays) {
      if (!Array.isArray(orderedFields) ||
          orderedFields.indexOf('number') < 0 ||
          orderedFields.indexOf('createdAt') < 0 ||
          new Set(orderedFields).size !== orderedFields.length) {
        throw new Error('ITSM → МБ: отсутствуют поля number и createdAt в схеме ITSM.');
      }
    }
    const numberIndex = orderedFields.indexOf('number');
    const createdAtIndex = orderedFields.indexOf('createdAt');
    return records.map((record, rowIndex) => {
      if (!record || typeof record !== 'object') {
        throw new Error('ITSM → МБ: некорректная запись ' + (rowIndex + 1) + '.');
      }
      if (Array.isArray(record)) {
        if (record.length !== orderedFields.length) {
          throw new Error(
            'ITSM → МБ: ширина записи ' + (rowIndex + 1) +
            ' не соответствует схеме ITSM.'
          );
        }
        return {
          number: record[numberIndex] ?? '',
          createdAt: record[createdAtIndex] ?? null
        };
      }
      return {
        number: record.number ?? '',
        createdAt: record.createdAt ?? null
      };
    });
  }

  globalThis.ReclassifierItsmDatasetSchema = Object.freeze({
    id: datasetDefinition.id,
    version: datasetDefinition.schemaVersion,
    kind: datasetDefinition.kind,
    allowEmpty: datasetDefinition.allowEmpty,
    mobileBrigadeLinkRows,
    mobileBrigadeLinkVersion: '1.0.0',
    sourceFieldCount: 17,
    outputFieldCount: 34,
    extensionFieldCount: 1,
    columns: Object.freeze(columns),
    fields: Object.freeze(columns.map(item => item[0])),
    sourceLabels: Object.freeze(columns.map(item => item[1])),
    labels: Object.freeze(columns.map(item => fieldRegistry.get(datasetDefinition.id, item[0]).label))
  });
})();
