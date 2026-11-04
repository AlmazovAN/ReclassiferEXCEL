const assert = require('assert');
const rules = require('../src/js/modules/mobile_brigade/rules.js');

assert.strictEqual(rules.outputColumns.length, 38);
const classify = (type, description = '', comment = '', closeComment = '') =>
  rules.classifyTask({ type, description, comment, closeComment });

assert.deepStrictEqual(rules.parseLaborHours('1ч. 30мин.'), { hours: 1.5, state: 'valid' });
assert.deepStrictEqual(rules.parseLaborHours('0'), { hours: 0, state: 'valid_zero' });
assert.deepStrictEqual(rules.parseLaborHours('0:00'), { hours: 0, state: 'valid_zero' });
assert.deepStrictEqual(rules.parseLaborHours(''), { hours: null, state: 'missing' });
assert.deepStrictEqual(rules.parseLaborHours(null), { hours: null, state: 'missing' });
assert.deepStrictEqual(rules.parseLaborHours('нет данных'), { hours: null, state: 'invalid' });
assert.deepStrictEqual(rules.parseLaborHours('-1'), { hours: null, state: 'invalid' });
assert.deepStrictEqual(rules.parseLaborHours('1:75'), { hours: null, state: 'invalid' });

assert.strictEqual(classify('АВР', 'монтаж новой камеры'), 'АВР');
assert.strictEqual(classify('ТО', 'неисправна камера'), 'ТО по графику');
assert.strictEqual(classify('ЕТО', 'что угодно'), 'Прочее');
assert.strictEqual(classify('ETO', 'что угодно'), 'Прочее');
assert.strictEqual(classify('ОПиН', 'что угодно'), 'Корректирующее воздействие');

assert.strictEqual(classify('ЗНО', 'Поврежден кабель, восстановить связь'), 'Корректирующее воздействие');
assert.strictEqual(classify('ЗНО', 'Монтаж новой камеры на дополнительной точке контроля'), 'ЗНО (монтажи, переносы)');
assert.strictEqual(classify('Прочее', 'Выполнить дополнительное ТО исправного оборудования'), 'ТО вне графика');
assert.strictEqual(classify('Прочее', 'Доставка запасных частей на склад'), 'Прочее');

// Фактический комментарий приоритетнее постановки.
assert.strictEqual(
  classify('ЗНО', 'Монтаж новой камеры', 'Заменена неисправная камера, связь восстановлена'),
  'Корректирующее воздействие'
);
assert.strictEqual(
  classify('Прочее', 'Неисправна камера', 'Выполнен монтаж новой дополнительной камеры'),
  'ЗНО (монтажи, переносы)'
);

// Формальный комментарий не перебивает описание.
assert.strictEqual(
  classify('ЗНО', 'Поврежден кабель, требуется восстановление', 'Выполнено'),
  'Корректирующее воздействие'
);

assert.strictEqual(rules.mergeComments('', 'Закрыто'), 'Закрыто');
assert.strictEqual(rules.mergeComments('Проверка выполнена', ''), 'Проверка выполнена');
assert.strictEqual(rules.mergeComments('Проверка выполнена', 'Проверка выполнена'), 'Проверка выполнена');

const prefixed = 'Иванов И.И. (05.05.2026 21:30): Проверка выполнена';
assert.strictEqual(
  rules.mergeComments('Проверка выполнена', prefixed),
  prefixed
);
assert.strictEqual(
  rules.mergeComments(prefixed, 'Проверка выполнена'),
  prefixed
);

const expandedPrefixed = 'Иванов И.И. (05.05.2026 21:30): Проверка выполнена, заменён кабель';
assert.strictEqual(
  rules.mergeComments('Проверка выполнена', expandedPrefixed),
  expandedPrefixed
);

assert.strictEqual(
  rules.mergeComments('Ожидание допуска', 'Петров П.П. (05.05.2026 22:10): Кабель заменён'),
  'Комментарий:\nОжидание допуска\n\nКомментарий по закрытой задаче:\nПетров П.П. (05.05.2026 22:10): Кабель заменён'
);

assert.strictEqual(
  rules.mergeComments(
    'Проверка выполнена, заменён кабель',
    'Петров П.П. (05.05.2026 22:10): Проверка выполнена'
  ),
  'Комментарий:\nПроверка выполнена, заменён кабель\n\nКомментарий по закрытой задаче:\nПетров П.П. (05.05.2026 22:10): Проверка выполнена'
);

assert.strictEqual(rules.outputColumns.includes('Комментарий'), false);
assert.strictEqual(rules.outputColumns.includes('Комментарий по закрытой задаче'), false);
assert.strictEqual(rules.outputColumns.includes('Объединённый комментарий'), true);
assert.strictEqual(rules.outputColumns.includes('Source.Name'), false);
assert.strictEqual(rules.outputColumns.includes('Новый тип задач.Новый тип задачи'), false);
assert.strictEqual(rules.outputColumns.at(-3), 'Итог Новый тип задач');
assert.strictEqual(rules.outputColumns.at(-2), 'Дата создания вызова ITSM');
assert.strictEqual(rules.outputColumns.at(-1), 'Возраст пред-бэклога');


assert.strictEqual(
  rules.mobileBrigadeRecordKey({
    site: ' Рудник Октябрьский ',
    taskNumber: ' TASK123 ',
    requestUrl: 'https://mb.example/tasks-for-shift/999?unit_id=20'
  }),
  'рудник октябрьский|task123'
);
assert.strictEqual(
  rules.mobileBrigadeRecordKey({
    site: 'Рудник Таймырский',
    taskNumber: '',
    requestUrl: 'https://mb.example/app/tasks-for-shift/773483?unit_id=20'
  }),
  'mbid|773483'
);
assert.strictEqual(rules.extractTaskForShiftId('https://mb.example/app/tasks-for-shift/773484?unit_id=20'), '773484');
assert.strictEqual(rules.mobileBrigadeRecordKey({ site: 'Северный', taskNumber: '', requestUrl: '' }), '');

console.log('Mobile Brigade rules regression: approved task-type methodology OK');
