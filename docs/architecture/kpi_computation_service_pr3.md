# PR 3 — KPI Computation Service

## Цель
Выделить из Reliability Report Service **одно независимое вычислительное ядро**, которое готовит предметные компоненты и вызывает **уже существующий** KPI Calculator. Фактические результаты, формулы, запросы, трассировка и условия доступности KPI не изменяются.

## До PR 3
`Runtime Data Repository → Reliability Report Service (source collection + source preparation + Calculator + source guards + Snapshot) → dashboard / chart / passports / PDF`.

## После PR 3
`Runtime Data Repository → Reliability Report Service (source collection + filters + Snapshot + chart series) → KPI Computation Service (preparation + Calculator + dependency guards) → existing KPI Preparation and Calculator`.

Внешние страницы продолжают использовать `ReclassifierReliabilityReportService`. Внутренние вызовы его `buildSnapshot`, `buildKpiChartData`, `buildKpiChartMultiData` и `buildKpiSelectionSummary` идут через единый `ReclassifierKpiComputationService`.

### Контракт вычислительного слоя
- `prepare(sourcePack, revisionSignature)`: неизменённая входная проекция ITSM/МБ/Drivers/Combined в существующий `ReclassifierKpiPreparation.prepare`. Результаты повторного вызова с той же ревизией и **теми же объектами Dataset** используют существующий подготовленный bundle.
- `calculate({prepared, sources, query, kpis, trace})`: передаёт оригинальный запрос в `ReclassifierKpiCalculator.calculate` и применяет прежний source guard по зависимостям `KpiCatalog`. Ключи KPI берутся из каталога, не дублируются.
- `invalidate()`: инвалидирует компоненты после изменения исходных данных или прямого сброса. `status()` отдаёт только фазу (idle/ready), поколение, версию подготовки — без содержимого Dataset.
- `RECLASSIFIER_KPI_STALE_PREPARED`: старые подготовленные компоненты не допускаются к новому вычислению.
- Выход `{version,results}` и замороженные KPI Result сохраняют прежнюю структуру. `trace` всегда передаётся Calculator, ничего не воспроизводится из кэша.

### Владение данными и кэшем
- **KPI Computation Service:** одна актуальная подготовленная предметная матрица; в PR3 не кэширует отдельные KPI Result, чтобы не нарушить обязательные трассировки и семантику пересчёта.
- **Reliability Report Service:** фильтры, версии источников, 8 Snapshot, 8 рядов месячной истории, 4096 точек графиков, Report View и статусы отчёта.
- **SQLite / Dataset Store:** по-прежнему единственные источники первичных данных. Вычислительный слой не читает SQLite, не хранит записи и не меняет рабочие Dataset.

### Почему пока синхронно?
Это отдельный шаг декомпозиции: перенос времени исполнения в WebWorker, диспетчер задач, очередь, индикация приоритета и фоновые расчёты будут выполнены в PR 4–6. В PR3 не следует одновременно менять API синхронного Report Service, шаблон PDF и визуализацию.

## Проверки
- Отдельный `tests/test_kpi_computation_service.js`: контракт, cache hit, изменение source identity, explicit invalidate, запрет использования старого bundle, source-missing guard, передача trace, сохранение результата.
- Полная `tests/test_reliability_report_service.js`: прежние ВБР/КТГ/SLA/трудозатраты/классификация, даты, диапазоны, 3-месячная и интервальная формулы, исходные Snapshot и кэширование.
- Offline Chromium FULL HTML: графики, паспорта, экспорт PDF, SQLite bootstrap и повторное открытие.
- Строгое положение модуля в `APP_JS_FILES` и `test_js_fragment_contract.py`.
- CI не вводит произвольных абсолютных порогов производительности: PR3 вводит новую границу модулей, а не обещает ускорение.

## Технические ограничения
- Новый вычислительный слой не вызывает `document`, `window`, raw SQLite и localStorage. Применение Worker в будущем должно сохранять исходные данные и трассировку без повторных копий больших Dataset.
- При изменении реализации необходимо сохранить source guard, например статус `source-missing`, и принцип fail-closed при устаревшем prepared bundle.
