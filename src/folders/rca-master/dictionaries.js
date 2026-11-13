const RCA_DICTIONARIES = {equipment: 'Оборудование', location: 'Участки', evidence_methods: 'Методы доказательств'};

function rcaDictionaryKey(item) {
  return item.category + ':' + item.value.trim().normalize('NFC').toLocaleLowerCase('ru');
}

function validateRcaDictionaries(items) {
  if (!Array.isArray(items)) throw new Error('Некорректный список справочников.');
  const ids = new Set();
  const keys = new Set();
  for (const item of items) {
    if (!item || !RCA_UUID.test(item.id) || !Object.hasOwn(RCA_DICTIONARIES, item.category) ||
        typeof item.value !== 'string' || !item.value.trim() ||
        !['active', 'archived'].includes(item.status) || ids.has(item.id) || keys.has(rcaDictionaryKey(item))) {
      throw new Error('Некорректное или повторное значение справочника.');
    }
    ids.add(item.id);
    keys.add(rcaDictionaryKey(item));
  }
  return items;
}
