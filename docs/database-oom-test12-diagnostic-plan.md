# TEST_12_PR322 — расширенная диагностика до оптимизации RAM и XLSX

## Цель

Получить два независимых машинно-читаемых отчёта за один и тот же прогон:
1. `Reclassifer_Runtime_Diagnostic_TEST_12_PR322_...json` — жизненный цикл SQLite,
   материализация Dataset, кэш, импорт и KPI.
2. `Reclassifer_XLSX_Diagnostic_TEST_12_PR322_...json` — выборка SQLite,
   обмен Worker, накопление worksheet, сериализация XLSX и скачивание.

Это только **диагностика**, без замены SheetJS, переноса БД, изменения правил
классификации, UPSERT или записи данных. Реальные источники не загружать в GitHub.

## Какие вопросы должны быть закрыты новым прогоном

| Решение после диагностики | Данные TEST_12 | Ограничение |
|---|---|---|
| Убирать ли eager Dataset Runtime | `runtime-sqlite-materialize`, datasetId, reason, cache misses/hits, rows/fullRows, duration | Абсолютные JS bytes объектов не измеряются |
| Сколько занимает SQLite до операций | sqlite-open/vfs-create/validation; databaseInputMiB; sqliteWasmCapacityMiB | WASM capacity — не физическая RAM и не RSS |
| Нужен ли keyset cursor | scannedRows / returnedRows, каждая партия, offset, latency, суммарные сканы | SQL Execution Plan и индексную статистику всё ещё нужно проверить в коде |
| Когда вырастает SheetJS | append start/end, cumulative cells, longTextCells, overflowParts | Heap внутри Worker может быть недоступен |
| На какой стадии XLSX.write OOM | отдельные start/end сериализации, bytes, lastStarted/Completed | Внутри SheetJS XML/ZIP подэтапы не разделены |
| Накладывается ли KPI | журнал kpi-input-check, kpi-auto-calculate, kpi-worker-init и время экспорта | В Worker KPI нет сквозного профиля памяти |
| Полнота исторических 38 полей | monthlyCoverage: dated, fullRows, analyticalRows | Не восстанавливает отсутствующие записи |
| Качество memory API | distinctHeapSamples, JS heap capacity/limit, unavailable для WASM/RSS | Статическая серия не означает стабильную RAM |

### Назначение показателей

- `databaseInputMiB`: размер подключённого SQLite-файла при открытии.
- `sqliteWasmCapacityMiB`: размер доступного WASM linear memory buffer, если API его предоставляет; это **не** память SQLite-строк и не RAM процесса.
- `mainJsHeapMiB`: доступное наблюдение `performance.memory` (может быть
  неизменным или не отражать Worker).
- `workerJsHeapMiB`: публикуется только если `performance.memory` доступно
  непосредственно в Worker, иначе отсутствует и peak равен null.
- `distinctHeapSamples`: число изменений наблюдаемой величины main JS heap.
  При единице нельзя делать вывод о пике.
- `scannedRows`: SQL cursor прошёл столько строк за один вызов; допускаются
  повторные чтения при каждой странице.
- `monthlyCoverage`: агрегаты по фактической дате, без содержания записей.

Ни один журнал не записывает наименования корпоративных файлов, номер заявки,
`record_key`, тексты комментариев или сами JSON-строки Dataset.

## Подготовка

1. Использовать отдельную **копию** исходной SQLite, без COMMIT/импорта.
2. Открыть только новый `*_CORE_TEST_12_PR322.html` в Opera, по возможности
   после перезапуска браузера, для чистого сравнения.
3. Подключить SQLite и перейти на «Мобильные бригады».
4. Выбрать **режим 38 колонок / Full Dataset**. Лучше период с несколькими
   тысячами сохранённых Full Dataset строк, а не 1 строкой как TEST_11.
5. Нажать «Скачать XLSX». Не запускать параллельно новый импорт.
6. Сохранить один XLSX и оба JSON. Если Opera заблокирует несколько скачиваний,
   скачать XLSX-отчёт отдельной кнопкой на вкладке «Мобильные бригады», а
   Runtime-отчёт — кнопкой «Скачать Runtime JSON» на странице «Данные».
7. Прислать оба JSON и сообщить, сколько строк реально было в XLSX.

### Второй прогон

Для сравнения полезен второй период с более крупной фактической выборкой:
например 20–30 тыс. строк, **только если первый прошёл стабильно**.
Копировать отчёты после каждого прогона — XLSX-отчёт нового экспорта
перезаписывает последнюю диагностическую сессию в localStorage.

## При аварийном закрытии вкладки

Браузер не способен инициировать скачивание после уничтожения renderer-процесса.
В обоих журналах синхронный checkpoint в localStorage сохраняется по мере событий,
но файловая система/Opera не гарантируют сохранение каждой записи.
Открыть тот же файл HTML по тому же пути и в том же профиле, нажать
кнопки скачивания/копирования отчётов. Не переключать приложение
на релиз без тестовой метки до копирования журналов.

**Не считать** успехом одно лишь выполнение `anchor.click()`:
сохранение на диск этим не подтверждается.

## Дополнительное измерение, которое браузер может не предоставить

Для доказательства фактического пика RSS/Private Bytes требуется
снимок диспетчера задач Opera/Windows непосредственно до экспорта,
во время формирования XLSX (особенно на `XLSX.write`) и после него,
с указанием свободной ОЗУ. Это измерение находится **за пределами**
технических возможностей JavaScript-журналов.

## Тесты в Codespaces

```bash
cd /workspaces/Reclassifer
git fetch origin
git switch feature/pr322-sqlite-mb-paged-xlsx-export
git pull --ff-only origin feature/pr322-sqlite-mb-paged-xlsx-export
set -euo pipefail

node tests/test_diagnostics_test12.js
node tests/test_xlsx_export_diagnostics_test11.js
node tests/test_database_oom_diagnostics.js
node tests/test_dataset_single_xlsx_protocol.js
node tests/test_dataset_single_xlsx_stream.js
node tests/test_sqlite_mobile_brigade_paged_export.js
node tests/test_dataset_export_long_text.js
node tests/test_worker_client.js
node tests/test_mb_worker_recycling.js
node tests/test_database_oom_post_commit_release.js

python -m unittest discover -s tests -p 'test_js_fragment_contract.py'
python -m unittest discover -s tests -p 'test_database_workspace_contract.py'
python -m unittest discover -s tests -p 'test_build_test_label.py'
python -m unittest discover -s tests -p 'test_architecture_guardrails.py'

python build/build.py --core --test-label TEST_12_PR322
ls -lh dist/*_CORE_TEST_12_PR322.html
```

Не объединять Draft PR #322 с `main` без прямого согласования.
