# PR 5/5 — Opera OOM: dense SheetJS, жизненный цикл Worker и восстановление очереди

## Наблюдения (27.10.2026)

- Загружена SQLite ~658 МБ; для повторной выгрузки МБ 72 283 строки
  SQLite показала **190 765 до/после, +0, обновлено 0, без изменений 72 283**.
  Повторно коммитить её не требуется.
- Первая повторная попытка: карточка «Формируется кандидат» затем
  «Ожидает БД», хотя SQLite оставалась открытой. UI действительно содержит
  резервное `Ожидает БД` для состояния `queued`. При асинхронной
  подготовке существует путь, который отбрасывает готовый план при
  `queuePreparationGeneration` mismatch или `databaseWorkspaceState.busy`,
  не всегда повторно планируя операцию.
- После удаления первой записи из очереди пользователь загрузил Excel за
  2025 год: 22 589 517 байт, 70 808 строк, `ready=1`.
  `candidate-inspection-reuse/end` работает. Worker остановился на
  `mb-worker-xlsx-read/start` (12:03:08.379Z), без `end`; журнал
  `status:running`, JS heap основного потока 1459 МиБ. Нет записи об
  успешном Worker и нет подтверждения нового кандидата. Это **не**
  доказательство повреждения Excel или точной причины OOM.
- `mainJsHeapMiB` **не** включает отдельную память XLSX WebWorker и
  SQLite/WASM; интерпретировать значение как общее RAM потребление нельзя.

## Изменения

1. `XLSX.read` в распознавателе Excel основного потока и в
   `mobile_brigade_processor.js` использует `dense:true` (SheetJS 0.20.3).
   Для больших листов SheetJS рекомендует dense-модель вместо большой
   адресной sparse-таблицы. Чтение `sheet_to_json`, правила и поля не
   меняются.
2. Shared Worker client принимает opt-in `recycleAfterTypes`. Для
   `PROCESS_MOBILE_BRIGADE` успешно завершённый либо завершившийся
   ошибкой Worker **завершается только после отсутствия других запросов**,
   а следующий создаётся заново и инициализируется через PING. Никаких
   изменений для остальных типов задач. Диагностика:
   `mb-worker-recycled/end`. Это позволяет освободить память
   предыдущего XLSX-разбора **перед** следующим файлом.
3. Если фонова́я подготовка кандидата закончилась при временной
   занятости Workspace или другой генерации, но файл всё ещё в очереди,
   операция помечается `queued`, а очередной запуск запрашивается.
   Завершение прямой записи SQLite в файл возобновляет ожидающую очередь.
   При удалении исходного файла автоматическое восстановление не происходит.
   Диагностика: `candidate-discarded/end` с причиной
   `workspace-busy` или `generation-changed`.
4. При подключённой SQLite `queued` отображается как
   «В очереди…», а не «Ожидает БД».
5. Запрещается параллельно запускать новое распознавание Excel в основном
   потоке, если идёт подготовка предыдущего кандидата в Worker.
   Несколько файлов, выбранных **одним действием**, по-прежнему
   принимаются и готовятся последовательно.

## Проверки

```bash
cd /workspaces/Reclassifer
git fetch origin
git switch feature/pr321-oom-dense-worker-retry-queue
git pull --ff-only origin feature/pr321-oom-dense-worker-retry-queue
set -e
node tests/test_worker_client.js
node tests/test_mb_worker_recycling.js
node tests/test_database_oom_queue_resumption.js
node tests/test_mobile_brigade_worker_processor.js
node tests/test_database_recognizer.js
node tests/test_dataset_classifier.js
node tests/test_database_oom_post_commit_release.js
node tests/test_database_integration.js
node tests/test_database_oom_diagnostics.js
node tests/test_mobile_brigade_sqlite_itsm_link.js
python -m unittest discover -s tests -p 'test_database_workspace_contract.py'
python -m unittest discover -s tests -p 'test_build_test_label.py'
python build/build.py --core --test-label TEST_05_PR321
ls -lh dist/*_CORE_TEST_05_PR321.html
```

Встроенные в новую версию локальные динамические проверки:
- Worker job recycle после MB (успех, ошибка, совместные запросы).
- Очередь при busy/generation смене, удалении элемента и успешной
  подготовке. 
Фактический прогон Node+Python на Codespaces и тест на больших файлах
в Opera ещё необходимы.

## Рекомендуемый приёмочный сценарий

1. Скачать `*_CORE_TEST_05_PR321.html` и открыть свежую вкладку Opera.
2. Подключить **копию** актуальной Reclassifier.db (~658 МБ), где данные
   72 283 строк уже находятся в SQLite.
3. Включить диагностический журнал; не выполнять HTML-экспорт.
4. Загрузить только вторую выгрузку 2025 года (70 808 строк).
5. Ожидаются `candidate-inspection-reuse/end`,
   `mb-worker-xlsx-read/end`, `mb-worker-classify/end`,
   `candidate-sqlite-preview/end`, `candidate-prepare/end`,
   `mb-worker-recycled/end`; статус «Подтвердить».
6. Проверить preview, даты/дубликаты/ITSM-связки до любого COMMIT.
7. Если испытание прошло, протестировать два последовательных больших
   файла в той же вкладке, нажимая «Подтвердить» только на копии БД.

## Ограничения

Часть памяти по-прежнему расходуют полная SQLite/WASM база, JS Runtime/KPI,
72k аналитических record/fullDataset в подготовленном плане и разбор
Worksheet в Worker. Это оптимизация, а **не гарантированное исправление
любых OOM**. При повторном зависании требуется отдельное stage-only SQLite
импортирование без больших результатов Worker в main-thread JS, с
транзакционным откатом и явным подтверждением.
