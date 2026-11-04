# TEST_17_PR332 — архитектурный этап 1: SQL-проекции KPI и курсорное чтение

**Draft PR:** https://github.com/AlmazovAN/Reclassifer/pull/332  
**База:** `feature/test16-diagnostic-v2` (Draft PR #326).  
**Цель:** сократить **одновременное** существование больших сериализованных и распарсенных массивов, не меняя смысл KPI и экспортных данных.

## Исходное поведение (TEST_16)

1. `DatabaseRepository.getDataset(id)` выполнял `db.exec({resultRows})` для всех `record_json`, а затем `.map(JSON.parse)`. До завершения парсинга потенциально удерживались и исходные JSON-строки, и JS-объекты.
2. Для Full Dataset дополнительно создавался список `fullRows` из объектов `{record_key,row_json}`, затем отдельно списки `recordKeys` и разобранных `rows`.
3. `ReliabilityReportService.collectSources()` вызывал обычный `Runtime.get()` для всех источников KPI и получал полный Full Dataset даже там, где факты KPI его не используют.
4. `kpi/preparation/index.js` использует `mobileBrigade.records`, но **не** `mobileBrigade.fullDataset`. Для ITSM `source_facts.fullDatasetSlaLookup()` читает из Full Dataset только столбец «Просрочен по разрешению» и `recordKeys` (с возможностью позиционного fallback).
5. В последнем TEST_16 после импорта: 286 472 аналитические строки МБ и 177 916 строк Full Dataset МБ; 54 753 записи ITSM. Исходная SQLite ≈860 MiB, WASM capacity после импорта ≈1 023,56 MiB. Эти величины **не являются** RSS или оценкой JS heap.

## Реализация

### 1. SQLite Repository

- `getDataset(id)` сохранил полный контракт, но теперь читает `record_json` и `row_json` через `db.prepare → bind → step → get → finalize`. Сериализованные JSON-строки **не копятся во втором крупном массиве**; обрабатывается по одной записи.
- Добавлен `getKpiDataset(id)` только для `itsm_data` и `mobile_brigade_data`, отдельно внесён в обязательный Repository API contract.
- Мобильные бригады: аналитические `records` сохраняются без изменений, `fullDataset = null`, SQL-таблица `dataset_full_records` **не читается** в KPI-сценарии.
- ITSM: SQL-запрос `json_extract(row_json, ?)` + `json_type(row_json, ?)` выбирает ровно один столбец SLA. В JS попадают только `recordKeys` и одномерная проекция `rows: [[slaValue], ...]`. Булевы значения, JSON-объекты, JSON-массивы, null, порядок и исходные ключи сохраняются. На SQL-запросе к Full Dataset нет `SELECT row_json`.
- Если SLA-столбца нет, как и прежде, `fullDatasetSlaLookup` возвращает null и расчёт использует значение из аналитических данных.

### 2. Runtime / Report Service

- `Runtime.getForKpi(id)` — отдельный revision-keyed read facade в TEST_17. Для любых источников кроме ITSM и МБ использует обычный Runtime.
- `ReliabilityReportService.safeGet()` в TEST_17 использует `getForKpi`, иначе старый `get`.
- Создана отдельная карта `runtimeKpiInstanceCache`; оба вида кэша инвалидируются при изменении соответствующих Dataset.
- Если обычный полный Runtime instance уже загружен, облегчённый KPI view **переиспользует аналитический массив по ссылке**. При этом из view исключается Full Dataset МБ; у ITSM сохраняется только SLA-проекция. Полная копия не отправляется в Worker только из-за предшествующего просмотра другого экрана.
- **Обратный сценарий KPI → полный Runtime**: добавлен `DatabaseRepository.getDatasetFullRows(id)`. Если KPI уже загрузил аналитические records, обычный Runtime читает только Full Dataset из SQLite, а records повторно не парсит. Обе записи в кэше разделяют один и тот же аналитический массив. Это критично для прежнего сценария OOM после ручного обновления Runtime.
- Диагностика `runtimeCacheRows` / `runtimeCacheFullRows` считает уникальные JS-массивы по ссылочной идентичности, а не суммирует один массив дважды, если он доступен через оба кэша.
- Формулы KPI, функции подготовки расчётов, схема SQLite, формат XLSX и экспорт не менялись.

## Проверки и ограничения

Новые тесты:
- `tests/test_kpi_sql_projection_test17.js` — сравнение результата реального SLA lookup на полном и SQL-проекционном источнике, порядок, ключи, отсутствие чтения полного `row_json`, проверка отдельного Full-only cursor и его завершения даже при ошибке.
- `tests/test_runtime_kpi_projection_test17.js` — разделение кэшей, сохранность обычного Full Dataset, **повторное использование аналитического массива в обе стороны**, ревизионная инвалидизация и отсутствие двойного счёта удерживаемых массивов.
- Полный прогон TEST_12–17 и архитектурных Python guardrails в `tests/run_test17_codespaces.sh`.

**Важно:** TEST_17 НЕ устраняет все источники OOM. Аналитические массивы на ~286 тыс. записей пока материализуются целиком и передаются в KPI Worker через structured clone, а 860+ MiB SQLite всё ещё разворачивается в WASM. Это первая часть рефакторинга, а не гарантированное решение.

## Проверка Codespaces

```bash
cd /workspaces/Reclassifer
git fetch origin
git switch feature/test17-kpi-sql-projections
git pull --ff-only origin feature/test17-kpi-sql-projections
bash tests/run_test17_codespaces.sh
```

Ожидаемая сборка: `dist/*_CORE_TEST_17_PR332.html`, только если все проверки успешны.  
Диагностический лог: `diagnostics/TEST_17_codespaces_<UTC>.log`.

## Приёмочные испытания Opera — на **копии** той же SQLite

1. Без предварительного просмотра полных Dataset открыть SQLite TEST_16 и новую TEST_17, запустить сопоставимый расчёт KPI. По Runtime JSON сравнить материализации `mobile_brigade_data` и ITSM: у KPI в TEST_17 `fullDatasetRows` для МБ ожидается **0**, для ITSM — фактическое количество строк SLA-проекции (если она есть). Аналитические `records` остаются прежними.
2. Сравнить **все итоговые значения KPI** по тем же периодам, рудникам, разрезам и данным. Допуск: не изменение расчетной логики, числовая эквивалентность; отдельно проверить классификацию/SLA.
3. Проверить обычные страницы и экспорт XLSX: Full Dataset должен быть доступен в прежнем составе и порядке, формат файла не меняется.
4. В Windows/Opera Task Manager записать **пиковый Memory Footprint / RSS**, число активных Worker и стабильность после завершения. Записанные в Runtime `wasmCapacityBytes` и `mainJsHeapMiB` не заменяют RSS.
5. После импорта и нового KPI сохранить Runtime JSON, проверить WAL/IndexedDB, сохранение истории и повторную инвалидизацию кэшей.
6. Не повторять искусственную перегрузку на рабочей базе без резервной копии; тестировать на отдельной копии.

**Критерий успеха:** тесты и сохранение KPI/XLSX проходят; число полных строк, передаваемых в KPI Worker, заметно снижается. О снижении общего пика памяти можно утверждать только после измерения RSS на одинаковых исходных данных.

## Следующие этапы RFC

Если TEST_17 подтвердит правильность проекций, следующий PR: убрать полное копирование аналитических records между UI и KPI Worker и исследовать SQLite Worker с файловым backend (OPFS/SAH), сохраняя офлайн-возможность и поддержку `file://`.
