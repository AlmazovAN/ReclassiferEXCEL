# Architecture

## 1. Формат поставки

Пользователь получает один файл `Reclassifier_vX.Y.Z.html` и открывает его в браузере.

Монолитный HTML является релизным артефактом, а не исходником разработки. Исходники хранятся модульно. Для Pull Request запускается быстрый набор проверок из `tests/ci_suites.json` через `.github/workflows/test-fast.yml`. Полный workflow `.github/workflows/build.yml` запускается вручную: он выполняет расширенную регрессию и собирает автономный CORE HTML с синтетическими данными для проверок. Публикация релиза выполняется отдельным workflow `.github/workflows/release.yml`; сборка не включает корпоративные данные.

На Windows полный локальный gate запускается командой `powershell -NoProfile -ExecutionPolicy Bypass -File tools/local-ci.ps1 verify -IncludeBrowser`. Режимы и их назначение описаны в `tools/LOCAL-CI.md`. Полный GitHub workflow служит источником списка Node-регрессий для локального runner; быстрый PR suite поддерживается отдельным манифестом.

Порядок классических JS-фрагментов задаётся в `build/build.py` и сохраняет проверенную последовательность исполнения. Критические зависимости инициализации дополнительно перечислены в `APP_JS_DEPENDENCIES`; загрузчик сборки проверяет, что зависимости зарегистрированы и расположены раньше потребителей. Это граф ограничений, а не автоматический сортировщик: обращения внутри функций часто выполняются только после загрузки всего bundle и не должны ошибочно превращаться в порядок загрузки. Новый фрагмент по-прежнему добавляется в явный `APP_JS_FILES` allowlist; если у него есть зависимость на API, добавьте её также в `APP_JS_DEPENDENCIES`.

## 2. Слои

```text
UI shell / router
  -> Module registry
       -> Reclassification component
       -> ITSM component -> WebWorker -> ITSM Rules -> ITSM Dataset
       -> Mobile Brigade component -> Mobile Brigade Dataset adapter
       -> Equipment component
  -> Reference Manager
  -> Dataset Lifecycle Manager
       -> Dataset Pipeline
       -> Runtime Dataset Store / SQLite guard
  -> Embedded / user Excel adapters
  -> Result download
```

Python/Pyodide остаются доступным параллельным аналитическим инструментом для следующих модулей, но текущая рабочая ITSM-цепочка является JavaScript + SheetJS + WebWorker.

## 3. Границы изменений

- `src/ui/` — визуальная оболочка и CSP для итогового локального HTML.
- `src/js/app/` — только общий shell: router, Home, общий workspace, системные страницы и runtime bootstrap.
- `src/js/app/dataset_catalog.js` — единый машинно-читаемый каталог стабильных свойств Dataset: `id`, `kind`, `schemaVersion`, `allowEmpty`, `persisted`, `strategy`, `keyField`; из него строятся runtime registry и SQLite Dataset Contract.
- SQLite Repository при открытии и health check сверяет `dataset_registry` с этим Catalog по полному стабильному контракту; missing/unknown/drift Dataset считаются несовместимостью, а не молча принимаются.
- `src/js/app/dataset_lifecycle.js` — нейтральная application-level граница жизненного цикла Dataset: `prepare/commit/activate/discard`, batch activation, история применений и file fingerprint. Предметные модули не вызывают мутации Dataset Pipeline напрямую.
- `src/js/app/dataset_classifier.js` — headless-классификатор структуры Excel Dataset; единый источник распознавания для Database Recognizer и диагностического Reference UI, без DOM и persistence.
- Database Workspace UI разделён по ответственности: `database_ui_state` (state/read helpers/health), `database_intake_ui` (Excel intake), `database_connection_ui` (create/open/export/bootstrap), `database_integration_ui` (prepare/confirm/cancel/commit), `database_audit_ui` (history view model), `database_view_renderers` (таблицы/карточки) и `database_ui` (только route composition/event binding).
- `src/js/app/worker_client.js` — общий lifecycle WebWorker-запросов: correlation по `requestId`, timeout, мгновенный reject всех pending requests при `error/messageerror`, terminate аварийного экземпляра и безопасное пересоздание следующей операцией.
- `src/js/modules/<module>/` — config/UI/предметные правила конкретного браузерного модуля.
- `src/js/references/` — Reference config/normalization/manager и раздельные UI-компоненты: `reference_ui_common` (общие status/history/dropzone helpers), `reference_probe_ui` (диагностика папки и structural classification), `reference_preview_ui` (read-only previews/status supporting Dataset), `reference_detail_ui` (детальная карточка выбранного Dataset) и `reference_ui` (только landing route composition).
- `src/js/workers/` — тяжёлая Excel-обработка вне UI-thread.
- `src/js/security/` — runtime-защита локального приложения.
- `src/python/core/` — общие функции Python-ядра.
- `src/python/modules/<module>/` — предметная Python-логика конкретного модуля.
- `src/python/references/` — Python-контракт логических ID и версий схем справочников.
- `references/` — документация схем.
- `build/` — сборка релизного HTML.

Общий app-shell не должен содержать предметные правила ITSM, Equipment, Mobile Brigade или Reclassification. Предметные правила не должны управлять DOM.

## 4. Контракт аналитического модуля

Браузерные модули регистрируются в общем module registry и не должны встраивать предметную логику в app-shell.

Текущий контракт предусматривает:

- declarative config модуля: ID, индекс, название, описание и зависимости от Reference;
- отдельный UI-компонент;
- опциональный processor, регистрируемый вместе с модулем;
- отдельный слой предметных правил, если правила формализованы;
- тяжёлый Excel I/O в WebWorker, если объём данных способен блокировать UI-thread.

ITSM уже реализует этот контракт полностью: UI передаёт XLSX и нормализованные Reference-наборы в Worker, Worker вызывает ITSM Rules 1.2.0 и возвращает готовый XLSX, статистику и нормализованный ITSM Dataset. Mobile Brigade также имеет рабочий WebWorker processor и публикует Mobile Brigade Data. Reclassification имеет рабочий файловый контур и отдельные Rules/Worker-слои: правила в базовом режиме переносят 10 обязательных полей ITSM в выходной XLSX и готовят обновление ReClass по ключу «Номер». Расширение предметных правил должно происходить в rules-слое без изменения Excel I/O.

Авария общего Worker не должна оставлять Promise-запросы ждать штатный 10-минутный timeout. События `error` и `messageerror` считаются fatal для текущего экземпляра: все pending requests получают `RECLASSIFIER_WORKER_FATAL`, их таймеры очищаются, Worker завершается, а следующий запрос создаёт новый экземпляр и повторно проходит `PING → READY`. Обычный `WORKER_ERROR` с `requestId` остаётся ошибкой только конкретной операции и не перезапускает Worker.

## 5. Reference Manager

Справочники централизуются через Reference Manager. Модули запрашивают справочник по логическому идентификатору. Reference Manager отвечает только за reference-специфичную нормализацию, проверку и семантику ReClass; общие переходы состояния Dataset выполняет `ReclassifierDatasetLifecycleManager`.

Базовый перечень, в порядке интерфейса:

1. `reclassification` — Reclassification / ReClass;
2. `drivers` — Drivers;
3. `customers` — Customers;
4. `type_request` — TypeRequest;
5. `initiators` — Initiators;
6. `exceptions` — Exceptions;
7. `problem_grade` — ProblemGrade.

Runtime-экземпляр хранит исходный `File`, нормализованные записи, метаданные и результат валидации (`valid`, `warning`, `invalid`). Связанные модули вычисляются автоматически из `moduleConfig.references`, а не дублируются вручную в паспорте.

Публичная граница для модулей — `ReclassifierReferenceManager`: модуль получает данные по ID и не знает имя или путь исходного Excel.

### TypeRequest schema 1.0.0

TypeRequest определяет, к какому виду работ должен относиться типовой запрос по значению входной колонки `Краткое описание`.

Ожидаемые заголовки справочника:

- `Краткое описание (типовой запрос)` — также принимается `Краткое описание`;
- `Вид работ`.

Нормализованный контракт:

```text
requestKey | shortDescription | workType
```

`shortDescription` хранит исходную формулировку типового запроса. `requestKey` вычисляется из неё: удаляются неразрывные/лишние пробелы, нормализуется регистр. Пунктуация, слеши, обратные слеши и сам текст запроса не упрощаются, чтобы не объединять разные шаблоны по эвристике.

При обработке ITSM модуль должен строить такой же ключ из входной колонки `Краткое описание` и выполнять точное сопоставление с `requestKey`. `workType` содержит ожидаемый исходный вид работ (например, `АВР`, `Плановое ТО`, `ЗнО разовое`, `Монтаж`, `Перенос`, `ПО/ доступ`).

Точные дубли объединяются. Если одно нормализованное краткое описание связано с несколькими видами работ, все варианты сохраняются и Reference Manager показывает агрегированное предупреждение без автоматического выбора.

Свежесть для TypeRequest не применяется: дат в справочнике нет.

### Customers schema 1.1.0

Customers связывает рудник/шахту с внутренним заказчиком «для нас» и фактическим заказчиком.

Ожидаемые заголовки:

- `Рудник`;
- `Заказчик (для нас)` — также принимается старый заголовок `Заказчик`;
- `Заказчик кратко`;
- `Заказчик полностью`.

Нормализованный контракт:

```text
mine | mineSource | customerCode | customerFull | customerShort
```

`mine` используется как нормализованный ключ: удаляется только начальный префикс `р.` или `ш.`, пробелы приводятся к единому виду. Исходное значение сохраняется в `mineSource`. `customerInternal` хранит принадлежность «для нас» (например, ЗФ/КФ). Поля `customerShort` и `customerFull` описывают фактического заказчика. `customerCode` оставлен как legacy-алиас `customerInternal` для совместимости.

Пустые значения заказчика допустимы. Точные дубли объединяются. Предупреждение создаётся только если один и тот же рудник привязан к разным непустым сочетаниям внутреннего и фактического заказчика. Один внутренний заказчик может соответствовать нескольким фактическим заказчикам — это штатная ситуация.

Свежесть для Customers не применяется: дат в справочнике нет.

### ProblemGrade schema 1.0.0

ProblemGrade связывает IT-проблемы с четырёхуровневой цепочкой классификатора:

```text
Наименование оборудования → Элемент → Неисправность → Причина
```

Опорные заголовки формата:

- `Основание № IT-проблемы`;
- `Наименование оборудования`;
- `Элемент`;
- `Неисправность`;
- `Причина`.

`Вспомогательный столбец` не является источником истины. Он исторически использовался в Excel как результат `E&F&G&H` для поиска. Reference Manager самостоятельно формирует безопасный `classifierKey` из четырёх уровней, сохраняет читаемый `classifierPath` и сравнивает исходную склейку с вычисленным `legacyExpected`.

Нормализованный контракт включает:

```text
classifierKey | classifierPath | equipment | element | fault | reason |
problemId | problemStatus | problemName | classifierConfirmation |
normalizationDecision | primaryExclusion | legacyKey | legacyKeyMatches
```

Точные дубли строк объединяются. Если одна и та же цепочка классификатора привязана к нескольким IT-проблемам, все привязки сохраняются и выдаётся агрегированное предупреждение — автоматический выбор одной проблемы не выполняется. Несовпадение legacy-склейки также является предупреждением, но не мешает использовать корректно вычисленный ключ.

Свежесть для ProblemGrade не применяется: в справочнике нет поля даты.

### Initiators schema 1.0.0

Ожидаемые заголовки:

- `Инициатор (открыл)`;
- `Группа инициаторов`;
- `Группа инициаторов с коментами`;
- `комменты`.

Заголовки используются для распознавания формата; значения внутри строк могут быть пустыми. Маркеры из одних вопросительных знаков (`?`, `??` и т.п.) нормализуются в `null` и не вызывают предупреждений.

Нормализованные поля:

```text
initiator | group | groupDetailed | comments
```

Повторные строки одного инициатора объединяются: непустое значение имеет приоритет над пустым или `?`. Предупреждение создаётся только если у одного инициатора обнаружены два разных непустых значения одного поля. Свежесть для Initiators не применяется, поскольку в справочнике нет поля даты.

### Reclassification schema 1.2.0

Опорные заголовки для распознавания формата:

- `Дата регистрации`;
- `Дата выполнения обращения`;
- `Номер`.

Остальные известные колонки привязываются по точному заголовку, но отсутствие значений в ячейках допустимо. Пустое поле не отклоняет справочник.

Нормализованные поля:

```text
dateRegistered | dateCompleted | territory | number | equipment | element |
fault | incidentReason | description | closureNote
```

Обе даты приводятся к `YYYY-MM-DD`. Строки сортируются по `dateCompleted` по возрастанию, затем по `dateRegistered`. Свежесть справочника — максимальная распознанная `Дата выполнения обращения`.

`Номер` является ключевым бизнес-полем. Пустые или повторяющиеся номера не приводят к отказу загрузки: Reference Manager сохраняет строки и показывает агрегированное предупреждение.

### Drivers schema 1.0.0

Reference Manager ищет строку заголовков в первых 20 строках каждого листа. Обязательные заголовки:

- `Наименование типа узла/бъекта/оборудования`;
- `Сервис` — колонка должна существовать, но значение допускается пустым;
- `Система`.

Все непустые колонки справа от `Система` трактуются как рудники/шахты. Широкая матрица распрямляется в:

```text
mine | name | service | system | value | unit
```

Дополнительно сохраняются `mineSource`, `rawValue`, `valueState`, `sourceSheet`, `sourceRow`.

Правила значений:

- число -> `unit="шт"`;
- `NN,NN км` / `NNкм` -> число километров, `unit="км"`;
- `-` -> `value=null`, состояние `dash`;
- пустая ячейка -> `value=null`, состояние `empty`;
- иной текст сохраняется и вызывает предупреждение.

Префиксы `р.` / `ш.` удаляются только из нормализованного `mine`; исходный заголовок сохраняется в `mineSource`.

Связь `Наименование -> Сервис -> Система` проверяется только на реальные противоречия. Пустое значение `Сервис` или `Система` считается «не задано» и не конфликтует с заполненным значением в другой строке. Статус `warning` появляется только если для одного наименования обнаружены разные непустые значения сервиса или системы.

Drivers не содержит даты заявки, поэтому его политика свежести — `none`. Для справочников с заявками используется политика `max_date`: дата определяется только из содержимого справочника, а не из `File.lastModified`.

## 6. Excel parser

SheetJS CE 0.20.3 фиксирован по версии и встраивается в итоговый HTML на этапе сборки.

Приоритет build-time источника:

1. проверенный `vendor/xlsx.full.min.js`;
2. CDN fallback той же версии 0.20.3, только если локальный vendor отсутствует.

Версия сама по себе не считается достаточной проверкой. Build принимает SheetJS только при точном SHA-256 `cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41`; один и тот же pin применяется к локальному vendor и CDN fallback. В build metadata публикуется ожидаемый SHA-256. В готовом runtime SheetJS уже встроен в HTML; сеть для его загрузки не используется.

## 7. Хранение

Хранение имеет два взаимоисключающих активных режима: встроенный HTML Dataset Store при закрытой БД и SQLite Repository как единственный авторитетный источник при открытой `Reclassifier.db`. Legacy Dataset Pipeline сохранён для автономного HTML. Если открытая БД не читается, ошибка должна выводиться явно; fallback к HTML запрещён.

Паритет этих режимов фиксируется отдельной real-SQLite регрессией: один синтетический Legacy baseline проходит через штатный `DatabaseBootstrap → SQLite WASM → Runtime Data Repository`, после чего для всех persisted Dataset сравниваются records, validation и семантически значимые metadata, включая ITSM field contract, Mobile Brigade freshness-by-scope, Equipment `joinIndex`, allow-empty Dataset и special metadata Failure Classifier. Производный `combined` пересчитывается штатным Equipment Combiner и сравнивается по records/view-model metadata. Тот же контракт повторно проверяется после binary export/close/reopen.

Релизная сборка содержит код, vendor-компоненты и статичные UI-ассеты, но не содержит бизнес-Dataset. Рабочие данные загружаются из пользовательской SQLite-базы. Build не читает каталоги `data/` или `local_data/`; Starter ZIP и embedded-baseline loaders удалены.

Пользовательские обновления проходят через Dataset Lifecycle Manager, который использует Dataset Pipeline как низкоуровневую state machine: сначала создаётся кандидат, затем после явного применения он становится активным набором. Для `mobile_brigade_data` кандидат строится как результат UPSERT текущего Dataset и новой партии: совпавшие `recordKey` заменяются свежими строками, новые добавляются, незатронутые записи не удаляются; свежесть хранится отдельно по участкам. В HTML-режиме кнопка скачивания создаёт снимок применённых Dataset; при повторном открытии снимок восстанавливается раньше встроенного baseline. Restore выполняется в две фазы: сначала полностью декодируются и валидируются все Dataset снимка без изменения active state, затем Dataset Lifecycle Manager публикует подготовленные экземпляры одним атомарным batch commit. Ошибка checksum, schema, структуры или validation любого Dataset отменяет весь restore; частичное восстановление запрещено. При открытой SQLite HTML-снимки блокируются; для переноса необходимо экспортировать `Reclassifier.db` после проверки её целостности. Производный `Equipment_Combined` в снимок не сериализуется и детерминированно пересчитывается из пяти активных каталогов.

## 8. Правило изменений

Не менять одновременно UI, runtime/Excel I/O и предметные правила без необходимости. Для формализованных схем справочников и аналитических модулей нужны регрессионные тесты.


## 9. Equipment Combiner

Equipment Combiner является соседним data-layer модулем по отношению к Reference Manager.

Пять входных каталогов:

1. `CatalogMountedEquipment`;
2. `CatalogStationaryEquipment`;
3. `CatalogTransport`;
4. `CatalogTransport StartPoints`;
5. `CatalogZabbixEquipmentTree`.

`Equipment_Combined` является производным набором. Ранее выгруженный Combined может быть загружен шестым файлом только как контроль структуры; он не подставляется в расчёт как источник.

Публичная граница браузерного слоя — `ReclassifierEquipment`. Аналитические модули должны получать нормализованные записи через этот API и не зависеть от локального имени файла.

Внутри каждого каталога публикуются только одобренные поля. Неодобренные поля могут участвовать только в техническом индексе для связи и не должны попадать в публичные записи.

Правила объединения и точные схемы зафиксированы в `equipment/README.md` как **Equipment Merge Rules 1.1.0**.

Equipment-каталоги пользователь загружает локально; сборки и репозиторий исходных каталогов не содержат.

Корпоративные исходные файлы пользователь загружает локально; GitHub Actions не получает их и не собирает FULL-пакет.


## 10. Runtime security

Релизный HTML работает в offline-only режиме.

- CSP задаёт `default-src 'none'` и `connect-src 'none'`;
- inline script/style разрешены только потому, что релиз является одним локальным HTML;
- WebWorker разрешён только из `blob:`;
- удалённые изображения, шрифты, frame/object/media и формы запрещены;
- runtime network guard дополнительно блокирует `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` и `navigator.sendBeacon`.

Сетевой доступ допускается только на этапе build: если локальный `vendor/xlsx.full.min.js` отсутствует, build-скрипт может скачать зафиксированный SheetJS 0.20.3, но принимает его только при совпадении pinned SHA-256. SQLite аналогично берётся только из официального release archive `sqlite-wasm-3530400.zip`, проверенного по pinned SHA3-256; произвольная локальная пара `sqlite3.js/sqlite3.wasm` запрещена. Готовое приложение сетевых обращений не выполняет.


## 11. Версии и источники истины

Версия приложения хранится только в корневом `VERSION` и попадает в build metadata итогового HTML.

Версии предметных контрактов независимы от версии приложения:

- ITSM Rules — 1.2.0;
- ITSM Dataset schema — 1.0.0;
- Equipment Merge Rules — 1.1.0;
- Reference schemas — по `reference_config.js` (`customers` 1.1.0, остальные 1.0.0).

Корпоративные данные и manifests с их метаданными не хранятся в репозитории.


## SQLite target architecture

Целевая модель хранения отделяет приложение от изменяемых данных:

```text
Reclassifier.html
  -> Repository API
  -> SQLite/WASM
  -> Reclassifier.db
```

Архитектурный контракт зафиксирован в `DATABASE_ARCHITECTURE.md`. Стабильные свойства Dataset задаются единожды в `src/js/app/dataset_catalog.js`; `src/js/app/database_contract.js` добавляет к ним SQLite/Repository-контракт и DDL.

Ключевые правила:

- SQLite-файл идентифицируется через `application_id`, `user_version` и `app_metadata`;
- DB Schema, App Version и Dataset Schema версионируются независимо;
- новое приложение принимает поддерживаемые старые DB Schema через последовательные миграции;
- старое приложение не пишет в БД более новой схемы;
- ITSM и Mobile Brigade используют UPSERT по устойчивым ключам;
- статичные справочники и исходные Equipment-каталоги используют REPLACE;
- `Equipment_Combined` остаётся производным набором и пересчитывается из источников;
- UI и аналитические модули не выполняют SQL напрямую, а работают через Repository API.

В runtime `0.22.0` SQLite Core, Dataset Recognizer, Dataset Integration Engine, контроль интеграций, SQLite-first runtime repository и portability health check встроены в единый offline HTML. Публичные обращения к SQLite Repository сериализованы operation mutex: async write/bootstrap удерживает владение между event-loop yield, а конкурентный вызов блокируется до доступа к handle. При открытой `Reclassifier.db` она остаётся авторитетным источником данных. Открытие и экспорт защищены `quick_check`/`foreign_key_check`; UI сверяет Dataset Registry с фактическими строками, контролирует `journal_mode=DELETE`, размер и время проверки. Повреждённая новая БД не заменяет уже открытую рабочую сессию.


## 10. Финальная граница режимов (0.24.0)

- Источник открытой SQLite определяется по `Repository.hasOpenDatabase()`, а не по успешности получения `getDatabaseInfo()`. Если дескриптор открыт, сбой метаданных, реестра или содержимого не должен незаметно включать HTML fallback.
- `ReclassifierRuntimeDataRepository` адаптирует SQLite Dataset в существующий предметный `instance`, сохраняя рабочие UI-модули. Индикатор источника использует только Registry metadata без материализации больших JSON-массивов.
- HTML snapshot: только при закрытой БД; SQLite: явный экспорт `.db`. Производный `Equipment_Combined` по-прежнему не хранится как таблица источника и пересчитывается из пяти каталогов.
- Совместимость DB Schema 1 и прежних сохранённых HTML-снимков сохраняется. Удаляются только доказуемо неиспользуемые вспомогательные функции, не legacy Dataset Pipeline.
- В полном ручном build workflow тестируются HTML→SQLite→HTML, некорректный открытый SQLite handle, блокировка неправильного формата экспорта и офлайн UI-сценарий экспорта/reopen большой БД. Для Pull Request выполняется быстрый suite из `tests/ci_suites.json`; полный набор не запускается автоматически на каждый PR.
