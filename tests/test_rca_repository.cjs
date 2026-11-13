const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {officialPrb, problemGrade, itsm, plans, legacy} = require('./fixtures/rca-pr13.cjs');

test('PR28 reopens a complete investigation transferred between workspaces', async () => {
  const source = createRcaRepository({handle:workspace().handle,mode:'write'});
  const targetHandle = workspace().handle;
  const target = createRcaRepository({handle:targetHandle,mode:'write'});
  const official = {prbNumber:'PRB1',itsmStatus:'Закрыта ITSM',title:'Официальное название'};
  assert.equal(context.mergeRcaRegistry([], [official])[0].unstarted,true);
  const record = createRcaProblem({title:'Локальное расследование',prbNumber:'PRB1'});
  record.problem.status = 'investigation';
  record.officialSnapshot = official;
  record.symptoms.push({id:'s',title:'Нет связи'});
  const node = addRcaWhy(record,'s',null,'Причина');
  toggleRcaLinkedFlag(record,'evidence',node.id);
  updateRcaLinkedItem(record,'evidence',record.evidence[0],{
    leader:'Инженер',actual:'Осмотр и фото',verdict:'confirmed'
  });
  context.toggleRcaActionFlag(record,node.id,'flagK');
  toggleRcaLinkedFlag(record,'actions',node.id);
  assert.equal(record.actions.length,1);
  const action = record.actions[0];
  updateRcaLinkedItem(record,'actions',action,{kind:'corrective',text:'Устранить причину',status:'draft'});
  assert.throws(()=>updateRcaLinkedItem(record,'actions',action,{status:'planned'}),/ЗНО/);
  updateRcaLinkedItem(record,'actions',action,{status:'planned',zno:'ЗНО-TEST'});
  action.plan = context.createRcaPlan({id:'ТП №01',title:'Осмотр',steps:[
    {id:'step',title:'Осмотр',durationDays:0}
  ]},{sourceHash:'a'.repeat(64)},'2026-03-01');
  await source.saveRevision(record,0);
  const metric = context.getRcaMetric({days:[
    {prb:'PRB1',site:'',day:'2026-03-01',incCount:1,mbLaborHours:0}
  ]},'PRB1','','2026-03-01','2026-03-31');
  assert.equal(metric.incCount,1);
  const blob = await exportRcaArchive((await source.listIndex()).records,[],
    async id=>(await source.loadProblem(id)).record);
  const archive = readRcaArchive(await blob.text());
  await target.saveBatch((await planRcaArchive(archive,[],[],()=>null)).problems);
  const {record:reopened} = await createRcaRepository({handle:targetHandle,mode:'write'}).loadProblem(record.problem.id);
  assert.equal(reopened.problem.status,'investigation');
  assert.equal(reopened.officialSnapshot.itsmStatus,official.itsmStatus);
  assert.equal(reopened.actions[0].plan.steps[0].plannedEnd,'2026-03-01');
  const report = JSON.stringify(context.buildRcaReport(reopened));
  for (const value of ['Закрыта ITSM','Расследование','Осмотр и фото','ЗНО-TEST','План · ']) assert.ok(report.includes(value));
});

test('ITSM index survives interrupted publication and skips unchanged generations', async () => {
  const {handle,files,options} = workspace();
  const repo = createRcaRepository({handle,mode:'write'});
  const first = {schemaVersion:1,rules:'itsm-daily-v1',sourceHash:'a'.repeat(64),source:'ITSM/export_ITSM.xlsx',
    calculatedAt:new Date().toISOString(),diagnostics:{counted:1},days:[
      {prb:'PRB1',site:'макет',day:'2026-03-31',incCount:1,mbLaborHours:0}
    ]};
  await repo.itsmAnalytics.publish(first);
  await repo.itsmAnalytics.publish(first);
  assert.equal(files.size,1);
  options.fail = '/analytics/';
  const next = {...first,sourceHash:'b'.repeat(64)};
  await assert.rejects(repo.itsmAnalytics.publish(next), /Interrupted write/);
  const reopened = createRcaRepository({handle,mode:'write'});
  assert.equal((await reopened.itsmAnalytics.readLatest()).sourceHash,first.sourceHash);
  options.fail = '';
  await reopened.itsmAnalytics.publish(next);
  assert.equal((await reopened.itsmAnalytics.readLatest()).sourceHash,next.sourceHash);
  assert.ok([...files.keys()].every(key=>key.startsWith('RCA/analytics/itsm/')));
});

const html = fs.readFileSync(path.join(__dirname, '../dist/ReclassifierEXCEL.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const context = vm.createContext({crypto, TextEncoder, structuredClone, DOMException, Blob, navigator: {}});
vm.runInContext(script.slice(0, script.lastIndexOf("\n(() => {")), context);
const {createRcaRepository, createRcaProblem, createRcaState, normalizeRcaPrb,
  filterRcaRegistry, addRcaWhy, removeRcaTreeItem, rcaTreeColumns, validateRcaProblem} = context;
const {toggleRcaLinkedFlag, updateRcaLinkedItem, rcaEvidenceVerdict, rcaActionCoverage} = context;
const {readRcaArchive, exportRcaArchive, planRcaArchive, validateRcaDictionaries} = context;

function workspace() {
  const files = new Map();
  const folders = new Set(['']);
  const options = {permission: 'granted', fail: ''};
  const missing = () => new DOMException('Missing', 'NotFoundError');

  function directory(prefix) {
    return {
      queryPermission: async () => options.permission,
      async getDirectoryHandle(name, {create} = {}) {
        const key = prefix + name + '/';
        if (create) folders.add(key);
        if (!folders.has(key)) throw missing();
        return directory(key);
      },
      async getFileHandle(name, {create} = {}) {
        const key = prefix + name;
        if (create && !files.has(key)) files.set(key, '');
        if (!files.has(key)) throw missing();
        return {
          getFile: async () => new Blob([files.get(key)]),
          async createWritable() {
            let text;
            return {
              async write(value) { text = value; },
              async close() {
                if (options.fail && key.includes(options.fail)) {
                  files.set(key, '{');
                  throw new Error('Interrupted write');
                }
                files.set(key, text);
              },
              async abort() {}
            };
          }
        };
      },
      async *values() {
        for (const key of files.keys()) {
          const name = key.slice(prefix.length);
          if (key.startsWith(prefix) && !name.includes('/')) yield {kind: 'file', name};
        }
      }
    };
  }
  return {handle: directory(''), files, options};
}

test('RCA publishes individual versions and rejects a stale revision', async () => {
  const {handle, files} = workspace();
  const repo = createRcaRepository({handle, mode: 'write'});
  const first = createRcaProblem({title: 'First'});
  const second = createRcaProblem({title: 'Second'});
  const saved = await repo.saveRevision(first, 0);
  await repo.saveRevision(second, 0);
  saved.problem.title = 'Updated';
  const firstSave = repo.saveRevision(saved, 1);
  const stale = repo.saveRevision(saved, 1);
  assert.equal((await firstSave).problem.revision, 2);
  await assert.rejects(stale, /Конфликт ревизий/);
  assert.equal((await repo.listIndex()).records.length, 2);
  assert.equal((await repo.loadProblem(first.problem.id)).record.problem.title, 'Updated');
  assert.equal([...files.keys()].filter(key => key.includes(second.problem.id)).length, 1);
  assert.equal((await createRcaRepository().listIndex()).records.length, 0);
});

test('RCA recovers published data after a partial index and after snapshot corruption', async () => {
  const {handle, files, options} = workspace();
  const repo = createRcaRepository({handle, mode: 'write'});
  const first = await repo.saveRevision(createRcaProblem({title: 'First'}), 0);
  first.problem.title = 'Updated';
  options.fail = '/indexes/';
  await assert.rejects(repo.saveRevision(first, 1), /Interrupted write/);
  const reopened = createRcaRepository({handle, mode: 'write'});
  assert.equal((await reopened.listIndex()).issues.length, 1);
  assert.equal((await reopened.loadProblem(first.problem.id)).record.problem.title, 'First');
  options.fail = '';
  await reopened.saveRevision(first, 1);
  const row = (await reopened.listIndex()).records[0];
  files.set('RCA/problems/' + row.id + '/' + row.file, '{');
  const recovered = await reopened.loadProblem(row.id);
  assert.equal(recovered.record.problem.revision, 1);
  assert.equal(recovered.issues.length, 2);
});

test('RCA imports only its JSON and keeps drafts when direct saving fails', async () => {
  const {handle, files, options} = workspace();
  const repo = createRcaRepository({handle, mode: 'write'});
  const first = await repo.saveRevision(createRcaProblem({title: 'First'}), 0);
  const input = [...files].map(([name, value]) => ({path: 'Workspace/' + name, file: new Blob([value])}));
  const state = createRcaState({dataset: {}});
  const status = {dataset: {}};
  const imported = createRcaState(status);
  await imported.openWorkspace({mode: 'import', files: input});
  assert.equal(status.dataset.status, 'export_required');
  assert.equal((await imported.getRepository().loadProblem(first.problem.id)).record.problem.title, 'First');
  imported.setDraft(first, 1);
  assert.equal(await imported.flushPending(), false);
  assert.equal(status.dataset.status, 'export_required');
  assert.equal(await imported.openWorkspace({}), false);
  await state.openWorkspace({mode: 'write', handle});
  options.permission = 'denied';
  state.setDraft(first, 1);
  assert.equal(await state.flushPending(), false);
  assert.equal(state.canLeave(), false);
  options.permission = 'granted';
  options.fail = '/problems/';
  assert.equal(await state.flushPending(), false);
  assert.equal(state.canLeave(), false);
  options.fail = '';
  assert.equal((await state.flushPending()).problem.revision, 2);
  assert.equal(state.canLeave(), true);
});

test('registry searches 500 rows and rejects duplicate PRB after reopening', async () => {
  const {handle} = workspace();
  const repo = createRcaRepository({handle, mode: 'write'});
  const rows = Array.from({length: 500}, (_, index) => createRcaProblem({
    title: 'Сбой связи ' + index, prbNumber: 'PRB' + index, equipment: 'Терминал'
  }).problem);
  assert.equal(filterRcaRegistry(rows, 'СБОЙ').length, 500);
  assert.equal(filterRcaRegistry(rows, 'prb499')[0].id, rows[499].id);
  assert.equal(normalizeRcaPrb(' prb499 '), 'PRB499');
  assert.throws(() => normalizeRcaPrb('499'), /PRB/);
  const original = await repo.saveRevision(createRcaProblem({title: 'Сбой', prbNumber: 'PRB499'}), 0);
  const reopened = createRcaRepository({handle, mode: 'write'});
  await assert.rejects(reopened.saveRevision(createRcaProblem({title: 'Дубль', prbNumber: 'PRB499'}), 0), /используется/);
  assert.equal((await reopened.loadProblem(original.problem.id)).record.problem.id, original.problem.id);
});

test('passport and branching tree retain IDs and Cyrillic through JSON revisions', async () => {
  const {handle} = workspace();
  const repo = createRcaRepository({handle, mode: 'write'});
  const record = createRcaProblem({title: 'Потеря связи'});
  record.problem.description = 'Наблюдение и обстоятельства\n'.repeat(1000);
  record.symptoms.push({id: 's1', title: 'Ошибка'}, {id: 's2', title: 'Задержка'});
  const root = addRcaWhy(record, 's1', null, 'Сбой питания');
  addRcaWhy(record, 's1', null, 'Обрыв связи');
  const child = addRcaWhy(record, 's1', root.id, 'Клемма');
  addRcaWhy(record, 's2', null, 'Перегрузка');
  root.flagK = true;
  assert.throws(() => removeRcaTreeItem(record, 's1', true), /дочерние/);
  assert.throws(() => removeRcaTreeItem(record, root.id, false), /дочерние/);
  const cyclic = structuredClone(record);
  cyclic.rcaNodes[0].parentId = child.id;
  assert.throws(() => validateRcaProblem(cyclic), /Цикл/);
  const saved = await repo.saveRevision(record, 0);
  saved.symptoms[0].title = 'Ошибка связи';
  await repo.saveRevision(saved, 1);
  const reopened = createRcaRepository({handle, mode: 'write'});
  const {record: loaded} = await reopened.loadProblem(record.problem.id);
  assert.equal(loaded.problem.description, record.problem.description);
  assert.equal(loaded.symptoms[0].id, 's1');
  assert.equal(rcaTreeColumns(loaded)[2][0].parentId, root.id);
  assert.equal(loaded.rcaNodes[0].hypothesisState, 'hypothesis');
  assert.equal(loaded.problem.status, 'draft');
});

test('evidence flags preserve edited checks and report conflicting verdicts after reopening', async () => {
  const {handle} = workspace();
  const repo = createRcaRepository({handle, mode: 'write'});
  const record = createRcaProblem({title: 'Проверка причины'});
  record.problem.leader = 'Лидер';
  record.symptoms.push({id: 's', title: 'Симптом'});
  const node = addRcaWhy(record, 's', null, 'Причина');
  toggleRcaLinkedFlag(record, 'evidence', node.id);
  assert.equal(record.evidence[0].leader, 'Лидер');
  toggleRcaLinkedFlag(record, 'evidence', node.id);
  assert.equal(record.evidence.length, 0);
  toggleRcaLinkedFlag(record, 'evidence', node.id);
  const auto = record.evidence[0];
  updateRcaLinkedItem(record, 'evidence', auto, {verdict: 'confirmed', actual: 'Протокол'});
  assert.throws(() => toggleRcaLinkedFlag(record, 'evidence', node.id), /содержит данные/);
  assert.throws(() => removeRcaTreeItem(record, node.id, false), /доказательства/);
  assert.throws(() => updateRcaLinkedItem(record, 'evidence', null, {nodeId: node.id, verdict: 'refuted'}), /проверяющего/);
  updateRcaLinkedItem(record, 'evidence', null, {nodeId: node.id, verdict: 'refuted', leader:'Инженер', actual:'Осмотр'});
  await repo.saveRevision(record, 0);
  const {record: restored} = await createRcaRepository({handle, mode: 'write'}).loadProblem(record.problem.id);
  assert.match(rcaEvidenceVerdict(restored, node.id), /Противоречие/);
  assert.equal(restored.evidence[0].id, auto.id);
  assert.equal(restored.rcaNodes[0].flagK, false);
});

test('actions track real coverage, retain identity after sector changes, and allow unlinking', () => {
  assert.equal(vm.runInContext('Object.keys(RCA_SECTORS).length', context), 7);
  const record = createRcaProblem({title: 'КД/ПД'});
  record.symptoms.push({id: 's', title: 'Симптом'});
  const first = addRcaWhy(record, 's', null, 'Первая причина');
  const second = addRcaWhy(record, 's', null, 'Вторая причина');
  toggleRcaLinkedFlag(record, 'actions', first.id);
  assert.equal(rcaActionCoverage(record, first.id), 'Пустой черновик');
  assert.equal(rcaActionCoverage(record, second.id), 'Нет действий');
  toggleRcaLinkedFlag(record, 'actions', first.id);
  assert.equal(record.actions.length, 0);
  toggleRcaLinkedFlag(record, 'actions', first.id);
  const item = record.actions[0];
  const id = item.id;
  assert.throws(() => updateRcaLinkedItem(record, 'actions', item, {kind:'corrective', status:'planned'}), /ЗНО/);
  assert.throws(() => updateRcaLinkedItem(record, 'actions', item, {
    nodeIds: [first.id, second.id], sector: 'quality', text: 'Проверить настройку', status: 'closed'
  }), /отчёт/);
  updateRcaLinkedItem(record, 'actions', item, {nodeIds:[first.id, second.id], sector:'quality',
    text:'Проверить настройку', status:'closed', result:'Настройка проверена'});
  assert.equal(rcaActionCoverage(record, second.id), 'Выполнено');
  toggleRcaLinkedFlag(record, 'actions', first.id);
  assert.equal(record.actions[0].id, id);
  updateRcaLinkedItem(record, 'actions', item, {nodeIds: [second.id]});
  assert.equal(first.flagM, false);
  assert.equal(record.actions[0].id, id);
  assert.equal(record.actions[0].sector, 'quality');
  assert.equal(rcaActionCoverage(record, first.id), 'Нет действий');
  validateRcaProblem(record);
});

test('root and action flags share one preventive draft, and passport suggestions remain independent', () => {
  const record = createRcaProblem({title:'Проверка', prbNumber:'PRB1'});
  record.symptoms.push({id:'s', title:'Симптом'});
  const node = addRcaWhy(record, 's', null, 'Причина');
  context.toggleRcaActionFlag(record, node.id, 'flagK');
  toggleRcaLinkedFlag(record, 'actions', node.id);
  assert.equal(record.actions.length, 1);
  assert.equal(record.actions[0].kind, 'preventive');
  context.toggleRcaActionFlag(record, node.id, 'flagK');
  assert.equal(record.actions.length, 1);
  assert.equal(node.flagM, true);
  const suggestions = context.rcaPassportReferences([], {records:[{project:'Проект'}]},
    {equipment:['Макет'], locations:['Участок'], classifications:[
      {problemId:'PRB1', equipment:'Макет', element:'Модуль', fault:'Отказ', reason:'Питание'}
    ]}, 'PRB1');
  assert.equal(suggestions.suggestions.project[0], 'Проект');
  assert.equal(suggestions.paths[0].join('/'), 'Макет/Модуль/Отказ/Питание');
  assert.equal(record.classifications.length, 0);
  assert.equal(record.problem.equipment, '');
});

test('archive round-trip preserves dictionaries and treats a repeated import as identical', async () => {
  const source = createRcaRepository({handle: workspace().handle, mode: 'write'});
  const target = createRcaRepository({handle: workspace().handle, mode: 'write'});
  const item = {id: crypto.randomUUID(), category: 'equipment', value: 'Терминал', status: 'archived'};
  assert.throws(() => validateRcaDictionaries([item, {...item, id: crypto.randomUUID(), value: ' терминал '}]), /повторное/);
  const record = createRcaProblem({title: '<img src=x onerror=alert(1)>', equipment: item.value, prbNumber: 'PRB12'});
  await source.saveBatch([{record, expectedRevision: 0}], {expected: [], items: [item]});
  const load = repo => async id => (await repo.loadProblem(id)).record;
  const blob = await exportRcaArchive((await source.listIndex()).records, await source.readDictionaries(), load(source));
  const archive = readRcaArchive(await blob.text());
  assert.equal(archive.attachments.binaryIncluded, false);
  const plan = await planRcaArchive(archive, [], [], load(target));
  await target.saveBatch(plan.problems, {expected: [], items: plan.items});
  const rows = (await target.listIndex()).records;
  assert.equal(rows[0].title, record.problem.title);
  assert.equal((await target.readDictionaries())[0].status, 'archived');
  const repeat = await planRcaArchive(archive, rows, await target.readDictionaries(), load(target));
  assert.equal(repeat.problems[0].kind, 'same');
  assert.equal(repeat.added, 0);
  archive.problems[0].problem.title = 'Изменённое название';
  assert.equal((await planRcaArchive(archive, rows, [], load(target))).problems[0].kind, 'conflict');
  archive.problems[0].problem.id = crypto.randomUUID();
  assert.equal((await planRcaArchive(archive, rows, [], load(target))).problems[0].kind, 'blocked');
  archive.problems[0].evidence.push({id: 'e', nodeId: 'foreign'});
  assert.throws(() => readRcaArchive(JSON.stringify(archive)), /чужой узел/);
  assert.throws(() => readRcaArchive('{'), SyntaxError.name);
  assert.throws(() => readRcaArchive(JSON.stringify({...archive, schemaVersion: 999})), /версия/);
  assert.throws(() => readRcaArchive('{"ITSM":[]}'), /формат/);
});

test('a failed batch leaves the prior generation and dictionaries visible', async () => {
  const {handle, options} = workspace();
  const repo = createRcaRepository({handle, mode: 'write'});
  const old = await repo.saveRevision(createRcaProblem({title: 'Исходная'}), 0);
  const changes = ['Первая', 'Вторая'].map(title => ({record: createRcaProblem({title}), expectedRevision: 0}));
  const dictionary = {expected: [], items: [{id: crypto.randomUUID(), category: 'location', value: 'Участок', status: 'active'}]};
  options.fail = changes[1].record.problem.id;
  await assert.rejects(repo.saveBatch(changes, dictionary), /Interrupted write/);
  assert.equal((await repo.listIndex()).records.length, 1);
  assert.equal((await repo.listIndex()).records[0].id, old.problem.id);
  assert.equal((await repo.readDictionaries()).length, 0);
  options.fail = '';
  await repo.saveBatch(changes, dictionary);
  assert.equal((await repo.listIndex()).records.length, 3);
  assert.equal((await repo.readDictionaries()).length, 1);
  await assert.rejects(repo.saveBatch([], dictionary), /изменились/);
});

test('investigation survives reopening and moves between isolated workspaces only by archive', async () => {
  const first = workspace();
  const second = workspace();
  const state = createRcaState({dataset: {}});
  await state.openWorkspace({mode: 'write', handle: first.handle});
  assert.equal((await state.getRepository().listIndex()).records.length, 0);
  const record = createRcaProblem({title: 'Сбой синтетического терминала'});
  record.symptoms.push({id: 's', title: 'Нет связи'});
  const node = addRcaWhy(record, 's', null, 'Потеря питания');
  toggleRcaLinkedFlag(record, 'evidence', node.id);
  toggleRcaLinkedFlag(record, 'actions', node.id);
  state.setDraft(record, 0);
  assert.equal((await state.flushPending()).problem.id, record.problem.id);
  await state.openWorkspace({mode: 'write', handle: second.handle});
  assert.equal((await state.getRepository().listIndex()).records.length, 0);
  const reopened = createRcaRepository({mode: 'write', handle: first.handle});
  const target = state.getRepository();
  const blob = await exportRcaArchive((await reopened.listIndex()).records, [],
    async id => (await reopened.loadProblem(id)).record);
  const plan = await planRcaArchive(readRcaArchive(await blob.text()), [], [], () => null);
  await target.saveBatch(plan.problems);
  const restored = (await createRcaRepository({mode: 'write', handle: second.handle})
    .loadProblem(record.problem.id)).record;
  assert.equal(restored.evidence[0].nodeId, node.id);
  assert.equal(restored.actions[0].nodeIds[0], node.id);
  assert.equal(restored.problem.prbNumber, null);
});

test('PR13 opens a preexisting v1 snapshot without rewriting or dropping legacy fields', async () => {
  const {handle, files} = workspace();
  const payload = JSON.stringify(legacy, null, 2);
  const snapshot = '3-00000000-0000-4000-8000-000000000002.json';
  const {id, title, status, equipment, updatedAt, revision, prbNumber} = legacy.problem;
  const folder = await handle.getDirectoryHandle('RCA', {create: true});
  await folder.getDirectoryHandle('indexes', {create: true});
  await (await folder.getDirectoryHandle('problems', {create: true})).getDirectoryHandle(id, {create: true});
  const snapshotPath = 'RCA/problems/' + id + '/' + snapshot;
  files.set(snapshotPath, payload);
  files.set('RCA/indexes/index-000000000001.json', JSON.stringify({
    recordType: 'rca-index', schemaVersion: 1, generation: 1,
    records: [{id, title, status, equipment, updatedAt, revision, prbNumber, file: snapshot,
      hash: require('node:crypto').createHash('sha256').update(payload).digest('hex')}]
  }));
  const before = [...files];
  const repo = createRcaRepository({handle, mode: 'write'});
  const {record, issues} = await repo.loadProblem(id);
  assert.equal(issues.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(record)), legacy);
  assert.deepEqual([...files], before);
  const archive = readRcaArchive(await (await exportRcaArchive((await repo.listIndex()).records, [],
    async problemId => (await repo.loadProblem(problemId)).record)).text());
  assert.deepEqual(JSON.parse(JSON.stringify(archive.problems[0])), legacy);
});

test('PR13 fixture inventory covers ambiguity, duplicate INC, missing dates and zero-day steps', () => {
  assert.equal(officialPrb.length, 2);
  assert.equal(problemGrade[0].reason, problemGrade[1].reason);
  assert.notEqual(problemGrade[0].problemId, problemGrade[1].problemId);
  assert.deepEqual(itsm[0], itsm[1]);
  assert.equal(itsm[2]['Номер'], itsm[0]['Номер']);
  assert.equal(itsm[0]['рез6'], 0);
  assert.equal(itsm[3]['Дата выполнения обращения'], '');
  assert.equal(plans.length, 9);
  assert.equal(plans.flatMap(plan => plan.steps).length, 74);
  assert.ok(plans.every(plan => plan.steps[0]['Ориент. дней'] === 0));
});

test('official registry versions recover independently of local investigation JSON', async () => {
  const {handle, files, options} = workspace();
  const repo = createRcaRepository({handle, mode:'write'});
  const local = await repo.saveRevision(createRcaProblem({title:'Локальное', prbNumber:'PRB1'}), 0);
  const first = {schemaVersion:1, sourceHash:'a'.repeat(64), fileName:'synthetic.xlsx',
    loadedAt:new Date().toISOString(), rowCount:1, warnings:[],
    records:[{prbNumber:'PRB1', itsmStatus:'Создана', title:'Официальное'}]};
  assert.equal(await repo.officialRegistry.publish(first), true);
  await repo.officialRegistry.publish(first);
  assert.equal([...files.keys()].filter(key => key.includes('/references/')).length, 1);
  const second = {...first, sourceHash:'b'.repeat(64), records:[{...first.records[0], itsmStatus:'Закрыта'}]};
  options.fail = '/references/';
  await assert.rejects(repo.officialRegistry.publish(second), /Interrupted write/);
  const reopened = createRcaRepository({handle, mode:'write'});
  assert.equal((await reopened.officialRegistry.readLatest()).records[0].itsmStatus, 'Создана');
  options.fail = '';
  await reopened.officialRegistry.publish(second);
  assert.equal((await reopened.officialRegistry.readLatest()).records[0].itsmStatus, 'Закрыта');
  assert.equal((await reopened.loadProblem(local.problem.id)).record.problem.title, 'Локальное');
  assert.equal((await reopened.listIndex()).records[0].revision, 1);
  const imported = createRcaRepository({mode:'import',
    files:[...files].map(([path, text]) => ({path:'synthetic/' + path, file:new Blob([text])}))});
  assert.equal((await imported.officialRegistry.readLatest()).sourceHash, second.sourceHash);
  assert.equal(await imported.officialRegistry.publish(first), false);
});

test('merged registry keeps local UUIDs and adds only PRB without an investigation', () => {
  const local = createRcaProblem({title:'Локальное имя', prbNumber:'PRB1'}).problem;
  const orphan = createRcaProblem({title:'Прежнее расследование', prbNumber:'PRB3'}).problem;
  const official = [{prbNumber:'PRB1', title:'Официальное имя', project:'Связь'},
    {prbNumber:'PRB2', title:'Новое', project:'Связь'}];
  const rows = context.mergeRcaRegistry([local, orphan], official);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].id, local.id);
  assert.equal(rows[0].title, 'Локальное имя');
  assert.equal(rows[1].official, undefined);
  assert.equal(rows[2].unstarted, true);
  assert.equal(filterRcaRegistry(rows, 'СВЯЗЬ').length, 2);
});
