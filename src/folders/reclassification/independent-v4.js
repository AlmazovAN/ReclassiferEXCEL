function createFolderIndependentReclassificationEngine({rules, cascade, parseItsm, parseDate, xlsx}) {
  function normalize(value) {
    return String(value ?? '').trim().toLocaleLowerCase('ru-RU');
  }

  function compare(result, engineering) {
    if (!engineering?.every(normalize)) return 'Нет полной инженерной классификации';
    if (!result.every(normalize)) return 'Нет полного пути V4';
    return result.every((value,index)=>normalize(value) === normalize(engineering[index]))
      ? 'Совпадает' : 'Различается';
  }

  return {
    id:rules.id,
    version:rules.version,
    async run({source,classifier,references,asOfDate,dateFrom,dateTo}, onProgress) {
      onProgress({label:'Чтение исходной выгрузки ITSM',percent:5});
      if (dateFrom && dateTo && dateFrom > dateTo) throw new Error('Дата «с» должна быть не позже даты «по».');
      const includeCompletedDate = dateFrom || dateTo ? value => {
        const date = parseDate(value);
        if (!date) return false;
        const day = [date.getFullYear(),date.getMonth()+1,date.getDate()]
          .map((part,index)=>String(part).padStart(index ? 2 : 4,'0')).join('-');
        return (!dateFrom || day >= dateFrom) && (!dateTo || day <= dateTo);
      } : undefined;
      const {records,sheetName} = parseItsm(await source.arrayBuffer(),{
        rawClosureNote:true,dateCells:false,includeCompletedDate
      });
      const context = cascade.buildContext(classifier.records,classifier.meta);
      const engineeringByNumber = new Map();
      for (const record of references?.reclassification || []) {
        const key = normalize(record.number);
        if (key && !engineeringByNumber.has(key)) {
          engineeringByNumber.set(key,[record.equipment,record.element,record.fault,record.incidentReason]);
        }
      }
      const counts = new Map();
      const rows = [[
        'Номер','Статус V4','Маршрут','Оборудование V4','Элемент V4','Неисправность V4','Причина V4',
        'Ограничения','Шаги проверки','Инженерное оборудование','Инженерный элемент',
        'Инженерная неисправность','Инженерная причина','Сравнение'
      ]];
      for (const [index,record] of records.entries()) {
        const decision = cascade.evaluateRow(record,context);
        const engineering = engineeringByNumber.get(normalize(record.number)) || Array(4).fill(null);
        counts.set(decision.status,(counts.get(decision.status) || 0)+1);
        rows.push([record.number,decision.status,decision.route,...decision.candidatePath,
          decision.issues.join(' · '),decision.reviewSteps.join(' · '),
          ...engineering,compare(decision.candidatePath,engineering)]);
        if (index % 250 === 0) {
          onProgress({label:'Независимый расчёт V4',percent:10+Math.floor(index / records.length*75)});
        }
      }
      onProgress({label:'Формирование диагностики V4',percent:90});
      const workbook = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(workbook,xlsx.utils.aoa_to_sheet(rows),'ITSM');
      xlsx.utils.book_append_sheet(workbook,xlsx.utils.aoa_to_sheet([
        ['Движок',rules.id],['Версия',rules.version],['Дата расчёта',asOfDate],
        ['Исходная книга',source.name],['Исходный лист',sheetName],
        ['Классификатор',classifier.meta?.fileName ?? null],
        ['Дата выполнения с',dateFrom || null],['Дата выполнения по',dateTo || null],['Обработано',records.length],
        ['Статус V4','Количество'],...counts
      ]),'Сводка');
      const bytes = xlsx.write(workbook,{bookType:'xlsx',type:'array',compression:true});
      onProgress({label:'Диагностика V4 готова',percent:100});
      return {
        bytes,outputName:source.name.replace(/\.[^.]+$/,'')+'_ITSM_Диагностика_V4.xlsx',
        stats:{rows:records.length,readyRows:0}
      };
    }
  };
}
