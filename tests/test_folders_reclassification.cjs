const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('standalone worker switches V4 and V3 and preserves independent V4 decisions', async () => {
  const html = fs.readFileSync(path.join(__dirname,'../dist/ReclassifierEXCEL.html'),'utf8');
  const worker = JSON.parse(html.match(/id="folders-worker">([\s\S]*?)<\/script>/)[1]);
  function openWorker(engineId) {
    const app = vm.createContext({
      Blob, ArrayBuffer, Uint8Array, Date, Map, Set, TextEncoder, TextDecoder,
      crypto:globalThis.crypto, setTimeout, navigator:{locks:{request:(_,run)=>run()}}
    });
    app.self = app;
    const setting = "const activeFolderReclassificationEngineId = 'independent-4.0';";
    assert.ok(worker.includes(setting),'Expected V4 in the packaged configuration');
    const configuredWorker = engineId
      ? worker.replace(setting,`const activeFolderReclassificationEngineId = '${engineId}';`)
      : worker;
    vm.runInContext(configuredWorker,app);
    return app;
  }
  const app = openWorker();
  const xlsx = app.XLSX;
  function file(name, rows) {
    const book = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(book,xlsx.utils.aoa_to_sheet(rows),'Данные');
    return Object.assign(new Blob([xlsx.write(book,{type:'array',bookType:'xlsx'})]),{name});
  }
  const classifier = file('Классификатор.xlsx',[
    ['Услуга','Наименование оборудования','Элемент','Неисправность','Причина',
      'Деактивирована','Неисправность.Элемент.Наименование оборудования.Услуга "САДУ"'],
    ['ОГР','СВР','Кабель камеры','Обрыв кабеля','Механическое воздействие','Нет','Нет']
  ]);
  const source = file('export_ITSM.xlsx',[
    ['Дата создания Вызова','Дата выполнения обращения','Дата закрытия','Номер','Территории MES',
      'Наименование оборудования','Элемент','Неисправность','Причина инцидента',
      'Категорированная информация обращения.Краткое описание','Категорированная информация обращения.Описание',
      'Примечания к разрешению','Открыл','Измерение цели обслуживания.Прошло (рабочее время)',
      'Код закрытия','Доп.информация по причине','Состояние'],
    ['2026-09-01','2026-09-02','2026-09-03','INC-1','Северный','СВР','Кабель камеры',
      'Обрыв кабеля','Механическое воздействие','Неисправность СВР','Нет изображения',
      'Кабель восстановлен','Оператор',2,'Выполнено полностью','','Закрыто']
  ]);
  function prepareWorker(app, exportBook=source) {
    const copy = Object.assign(structuredClone(classifier),{name:classifier.name});
    app.files = [{path:'Работа/Catalogs/'+copy.name,file:copy},
      {path:'Работа/ITSM/'+exportBook.name,file:Object.assign(structuredClone(exportBook),{name:exportBook.name})}];
    vm.runInContext(`
      importedRoot = createImportedDirectory(files,{pendingFile:PENDING,observeFile:observeImportedBlob});
      preparedRoot = importedRoot;
      prepared = {
        statuses:new Map([['failure_classifier',{files:['Catalogs/Классификатор.xlsx']}]]),
        exportReferences:Object.fromEntries(
          ['reclassification','drivers','customers','type_request','initiators','exceptions','problem_grade']
            .map(id=>[id,[]]))
      };
    `,app);
  }
  async function run(app, dates={}) {
    const messages = [];
    app.postMessage = (message, transfer)=>messages.push({message,transfer});
    await app.onmessage({data:{action:'reclassification',imported:true,...dates}});
    return messages.at(-1);
  }
  prepareWorker(app);
  const {message,transfer} = await run(app);
  assert.equal(message.type,'done',message.message);
  assert.equal(message.outputName,'export_ITSM_ITSM_Диагностика_V4.xlsx');
  assert.equal(message.stats.rows,1);
  assert.equal(message.engineId,'independent-4.0');
  assert.equal(message.engineVersion,'4.0.0-dev');
  assert.equal(transfer[0],message.bytes);
  assert.equal(message.stats.readyRows,0);
  function reportRow(result) {
    const workbook = xlsx.read(result.bytes,{type:'array'});
    return Array.from(xlsx.utils.sheet_to_json(workbook.Sheets.ITSM,{header:1,defval:null})[1]);
  }
  const original = reportRow(message);
  assert.equal(original[0],'INC-1');
  assert.ok(original[1]);
  vm.runInContext(`
    prepared.exportReferences.reclassification = [{
      number:' inc-1 ',equipment:'Другая система',element:'Другой элемент',
      fault:'Другая неисправность',incidentReason:'Другая причина'
    }];
  `,app);
  const {message:compared} = await run(app);
  assert.equal(compared.type,'done',compared.message);
  assert.equal(compared.stats.readyRows,0);
  const changed = reportRow(compared);
  assert.deepEqual(changed.slice(0,9),original.slice(0,9));
  assert.equal(changed[9],'Другая система');
  assert.notEqual(changed[13],original[13]);

  const legacy = openWorker('legacy-3.3');
  prepareWorker(legacy);
  const {message:v3,transfer:v3Transfer} = await run(legacy);
  assert.equal(v3.type,'done',v3.message);
  assert.equal(v3.engineId,'legacy-3.3');
  assert.equal(v3.engineVersion,'3.3.0');
  assert.equal(v3.outputName,'export_ITSM_ITSM_Диагностика.xlsx');
  assert.equal(v3.stats.rows,message.stats.rows);
  assert.equal(v3Transfer[0],v3.bytes);
  const legacyWorkbook = xlsx.read(v3.bytes,{type:'array'});
  assert.ok(legacyWorkbook.Sheets.ITSM);
  assert.match(legacyWorkbook.Sheets.ITSM['!ref'],/:CN3$/);

  const restored = openWorker('independent-4.0');
  prepareWorker(restored);
  const {message:v4Again} = await run(restored);
  assert.equal(v4Again.type,'done',v4Again.message);
  assert.equal(v4Again.engineId,message.engineId);
  assert.equal(v4Again.engineVersion,message.engineVersion);
  assert.deepEqual(reportRow(v4Again),original);

  const {message:inside} = await run(restored,{dateFrom:'2026-09-02',dateTo:'2026-09-02'});
  assert.equal(inside.type,'done',inside.message);
  assert.equal(inside.stats.rows,1);
  const {message:outside} = await run(restored,{dateFrom:'2026-09-03',dateTo:'2026-09-03'});
  assert.equal(outside.type,'done',outside.message);
  assert.equal(outside.stats.rows,0,'Closing date must not match the completion filter');
  const {message:reversed} = await run(restored,{dateFrom:'2026-09-03',dateTo:'2026-09-02'});
  assert.equal(reversed.type,'error');

  const compact = openWorker();
  const compactBook = file('export_ITSM.xlsx',[
    ['Номер','Дата создания вызова','Наим1','Элем1','Неис1','Прич1'],
    ['INC-1','2026-09-01','СВР','Кабель камеры','Обрыв кабеля','Механическое воздействие']
  ]);
  prepareWorker(compact,compactBook);
  const dates = {dateFrom:'2026-09-02',dateTo:'2026-09-02'};
  const {message:compactError} = await run(compact,dates);
  assert.equal(compactError.type,'error');
  assert.equal(compactError.code,'RECLASS_SOURCE_COLUMNS');
  const {message:fallback} = await run(compact,{...dates,source});
  assert.equal(fallback.type,'done',fallback.message);
  assert.equal(fallback.stats.rows,1);

  const automatic = openWorker();
  prepareWorker(automatic,compactBook);
  automatic.original = Object.assign(structuredClone(source),{name:'Выгрузка ITSM.xlsx'});
  vm.runInContext(`
    files.push({path:'Работа/ITSM/'+original.name,file:original});
    importedRoot = createImportedDirectory(files.map(({path,file})=>({
      path,file:Object.assign(file.slice(),{name:file.name})
    })),{pendingFile:PENDING,observeFile:observeImportedBlob});
    preparedRoot = importedRoot;
  `,automatic);
  const {message:found} = await run(automatic,dates);
  assert.equal(found.type,'done',found.message);
  assert.equal(found.sourceName,'Выгрузка ITSM.xlsx');
  assert.equal(found.stats.rows,1);

  const unknown = openWorker('unknown');
  prepareWorker(unknown);
  const {message:error} = await run(unknown);
  assert.equal(error.type,'error');
  assert.match(error.message,/недоступен: unknown/);
});
