// Synthetic worksheet rows. No production identifiers, descriptions, or spreadsheets.
const officialPrb = [
  {'Номер': ' prb00001 ', 'Статус': 'Новый тестовый статус', 'Краткое описание': 'Сбой макета',
    'Дата создания': 46000, 'Дата закрытия': '', 'Проект': 'Синтетический проект'},
  {'Номер': 'PRB00002', 'Статус': 'Закрыта', 'Краткое описание': 'Проверка макета',
    'Дата создания': '2026-01-01', 'Дата закрытия': '2026-01-02'}
];
const problemGrade = [
  {problemId: 'PRB00001', equipment: 'Макет', element: 'Модуль', fault: 'Сбой', reason: 'Питание'},
  {problemId: 'PRB00002', equipment: 'Макет', element: 'Модуль', fault: 'Сбой', reason: 'Питание'}
];
const first = {'Номер': 'INC00001', 'Связан ли с ИТ-проблемой?': 'PRB00001',
  'Территории MES': 'Тестовый участок', 'Дата выполнения обращения': '2026-01-02',
  'рез6': 0, 'INC после рекласс': 'INC'};
const itsm = [first, {...first}, {...first, 'рез6': 2},
  {...first, 'Номер': 'INC00002', 'Дата выполнения обращения': ''}];
const plans = Array.from({length: 9}, (_, index) => {
  const code = 'ТП №' + String(index + 1).padStart(2, '0');
  const title = 'Синтетический сценарий ' + (index + 1);
  return {registry: {'Код': code, 'Сценарий': title}, steps: Array.from(
    {length: index < 2 ? 9 : 8}, (_, step) => ({
      'Код': step ? code : 'ТП №' + (index + 1), 'Сценарий': title,
      'Шаг': 'Проверка макета ' + (step + 1), 'Ориент. дней': step ? 2 : 0
    })
  )};
});

const id = '00000000-0000-4000-8000-000000000001';
const date = '2026-01-01T00:00:00.000Z';
const legacy = {
  schemaVersion: 1, recordType: 'rca-problem',
  problem: {id, prbNumber: 'PRB00001', title: 'Локальное название', status: 'investigation',
    description: 'Ручное описание\nВторая строка', leader: 'Инженер макета', equipment: 'Макет',
    location: 'Тестовый участок', estimateSource: 'Старая заметка', createdAt: date, updatedAt: date, revision: 3},
  participants: [{id: 'member', name: 'Инженер макета'}],
  symptoms: [{id: 'symptom', title: 'Сбой'}],
  classifications: [{id: 'path', equipment: 'Макет', element: 'Модуль', fault: 'Сбой', reason: 'Питание'}],
  incidents: [{id: 'incident', incNumber: 'INC00001'}],
  equipmentReferences: [{id: 'equipment', name: 'Макет'}],
  rcaNodes: [{id: 'node', symptomId: 'symptom', parentId: null, title: 'Питание', flagK: true}],
  evidence: [{id: 'evidence', nodeId: 'node', verdict: 'confirmed', actual: 'Синтетический осмотр'}],
  actions: [{id: 'action', nodeIds: ['node'], sector: 'technical', status: 'draft', text: 'Проверить макет'}],
  attachments: [{id: 'attachment', reference: 'synthetic.txt'}],
  history: [{id: 'event', description: 'Создана тестовая запись'}],
  legacyExtension: {note: 'Неизвестное поле сохранено'}
};
module.exports = {officialPrb, problemGrade, itsm, plans, legacy};
