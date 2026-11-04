# PR-A — живые контрольные точки Opera OOM

**База:** `integration/memory-optimization-v0.37.0`, PR #316. Основная ветка `main` не изменяется.

## Основной сценарий: «Работа с базой» → очередь → кандидат

**Важное уточнение от пользователя:** годовая выгрузка загружается через
вкладку **«Работа с базой»**. Кнопка «Обработать» отдельной страницы
«Мобильные бригады» не используется. Поэтому диагностика этой страницы,
добавленная в первоначальной версии PR-A, сохранена как дополнительная,
а основные контрольные точки добавлены в отдельный маршрут:

1. `database_intake_ui.js` — `intake`, `initial-inspection` (первый разбор);
2. `database_recognizer.js`, `dataset_classifier.js` — `recognizer-read`,
   `recognizer-xlsx`, `classifier-headers`, `recognizer-rows` и
   `recognizer-inspection`;
3. `database_integration_ui.js` — `queue-drain`, `candidate-prepare`,
   `candidate-retained`;
4. `database_integration.js` — `candidate-reinspect`,
   `candidate-fingerprint`, `candidate-records`, `mb-file-read`,
   `mb-itsm-dataset`, `mb-itsm-projection`, `mb-itsm-links`,
   `mb-worker`, `mb-worker-<phase>`, `mb-full-validation`,
   `candidate-sqlite-preview`;
5. `data_repository.js`, `kpi_auto_refresh.js`,
   `kpi_background_jobs.js` — `runtime-sqlite-materialize`,
   `kpi-auto-calculate`, `kpi-worker-init` (проверка параллельной
   загрузки SQLite Dataset/KPI).

На странице **«Работа с базой»**, в блоке «Загрузить Excel» перед
выбором файла включите чекбокс «Включить диагностику следующей обработки».
После сбоя снова откройте тот же HTML в том же профиле Opera и нажмите
«Копировать диагностический отчёт» в этом же блоке.

Для каждого шага сохраняются `start/end/error` и время. Периодически
создаваемые Worker-контрольные точки содержат только числа. Журнал хранит
максимум **80** последних событий и не добавляет названия Excel, названия
листов, recordKey, номера заявок или значения ячеек. Данные не отправляются
в сеть. В скопированный отчёт добавляется user-agent; перед передачей отчёта
оцените, допустимо ли раскрывать сведения о браузере.

Значения `mainJsHeapMiB` доступны только если браузер поддерживает
`performance.memory`. Они **не учитывают полную память SQLite WASM,
других Worker и RSS процесса браузера**. Пик RAM проверяется в диспетчере
задач Opera и ОС.

Ограничения: localStorage в локальном `file://` может быть отключён;
при полном краше процесса последнее событие может не успеть сохраниться;
пустой `end` после `start` означает только последнюю наблюдаемую стадию,
а не доказанную причину OOM. Если одновременно идёт KPI Worker,
это будет видно по событиям KPI рядом со стадиями Excel.

**Этот PR только фиксирует диагностику.** Он не выключает автоматическую
генерацию XLSX, не меняет полное чтение ITSM, правила связей и направление
маршрутизации на SQLite staging. Эти изменения относятся к следующим PR.

### Проверки конкретно этого дополнения

```bash
node tests/test_database_oom_diagnostics.js
node tests/test_mb_oom_diagnostics.js
node tests/test_database_integration.js
node tests/test_mobile_brigade_sqlite_itsm_link.js
node tests/test_itsm_mobile_brigade_enrichment.js
node tests/test_itsm_mb_link_contract_pr2.js
node tests/test_mb_memory_diagnostics.js
node tests/test_mb_batch_5000_multisheet.js
node tests/test_mobile_brigade_zf_kf_21k.js
python build/build.py --core
```

## Назначение

Точная локализация последнего этапа при завершении вкладки Opera с сообщением
«Недостаточно памяти». Изменения носят диагностический характер, не меняют
правила реклассификации, 38-колоночный Dataset, SQLite-схему, UPSERT или
содержимое экспортируемого XLSX.

### Режим

В модуле «Мобильные бригады» включить чекбокс «Диагностика памяти Opera»
**перед запуском** обработки. По умолчанию он выключен.

- Worker сообщает `xlsx-read:start/end`, `sheet-parse:start/end`,
  `classify:start/end`, `batch-send:start` и `batch-ack:end`.
- UI фиксирует `read-file`, `itsm-links`, `candidate-merge` (legacy),
  `stage-write`, `finalize-preview`, `commit` и `manual-export` (SQLite).
- Сохраняются последние 40 контрольных точек, статус операции, числа файлов/байт
  исходных файлов и число подтверждённых партий. Запись — `localStorage`,
  если доступен браузеру для данного локального HTML.
- **Никакие строки Excel, названия файлов или листов, recordKey и номера заявок
  в журнал не передаются и не сохраняются.** При копировании отчёта добавляется
  строка user-agent браузера; пользователь решает, передавать ли этот отчёт.
- Если `performance.memory` недоступен, значение честно обозначается
  `unavailable`. Даже если доступен, JS heap нельзя приравнивать к RSS
  процесса Opera или потреблению памяти SQLite WASM.
- После аварии вкладки откройте **тот же HTML в том же профиле Opera**.
  Нажмите «Копировать диагностический отчёт». Отсутствие финальной отметки
  означает незавершённую операцию, но не доказывает причину аварии.

**Ограничение:** при полном падении процесса JS catch/finalizer может не
исполниться; последняя запись localStorage может не сохраниться.
Полная память процесса измеряется отдельно диспетчером задач Opera/Windows.

## Важное обнаружение при аудите (26.10.2026)

Функция `processMobileBrigadeSqliteStage()` определена в
`src/js/modules/mobile_brigade/ui.js`, но путь кнопки «Обработать»
вызывает `processMobileBrigadeFiles()` — legacy Dataset candidate.
В SQLite-режиме функция staging **не вызывается**. Поэтому оптимизация
пакетами, реализованная в PR #316, не используется при нажатии основной
кнопки. PR-A намеренно **не меняет маршрутизацию**, чтобы сохранить
чистый диагностический базис. Переключение должно быть отдельным PR
с проверкой 21 103 строк, всех листов, дубликатов, preview, UPSERT и rollback.

## Обязательные проверки

```bash
git fetch origin
git switch feature/pr316-oom-phase-checkpoints
git pull --ff-only origin feature/pr316-oom-phase-checkpoints
node --check src/js/workers/mobile_brigade_processor.js
node --check src/js/modules/mobile_brigade/ui.js
node tests/test_mb_oom_diagnostics.js
node tests/test_mb_memory_diagnostics.js
node tests/test_mb_batch_backpressure.js
node tests/test_mb_batch_5000_multisheet.js
node tests/test_mobile_brigade_zf_kf_21k.js
node tests/test_mb_sqlite_staging.js
python build/build.py --core
```

**Браузерная приёмка:** корпоративная Opera, проблемная годовая выгрузка и
**копия** `Reclassifier.db`. При падении сохранить отчёт и RAM процесса.
Никакого merge в `main` без проверки.
