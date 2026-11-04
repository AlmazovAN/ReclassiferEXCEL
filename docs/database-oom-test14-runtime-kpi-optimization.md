# TEST_14_PR322 — lazy Equipment_Combined, KPI cache preflight и сохранение архивов

## Назначение

TEST_14 — управляемый этап оптимизации Runtime и повторных проверок KPI.
Создан в Draft PR #322, **не объединён в main**.

В этой версии нет изменений формул KPI, алгоритмов классификации, структуры
таблиц SQLite, полноты Full Dataset или формата XLSX.

## Разработка

1. `runtimeList()` и `runtimeSource('combined')` используют метаданные
   зарегистрированного derived resolver и его активных зависимостей.
   Создание `Equipment_Combined` откладывается до фактического
   `get('combined')` или доступа к `active.records`.
2. После COMMIT инвалидируются изменённый Dataset и связанные derived-кэши.
   Незатронутые persisted Dataset остаются в кэше.
3. `ReliabilityReportService.getCachedSnapshot()` использует быстрый путь
   **только для уже проверенного полного снимка из памяти**. Его актуальность
   проверяется по UUID базы, метаданным ревизий Registry и счётчику
   `Runtime.cacheEpoch`. Если нет подтверждённого снимка или stamp
   изменился, остаётся оригинальный `collectSources()` и проверка семантики.
4. Фоновый запуск KPI откладывается, пока идёт SQLite XLSX Export.
   Если Worker KPI уже работал в момент запуска экспорта, текущая версия
   его не прерывает: этот случай остаётся отдельным предметом оптимизации.
5. Восстановленные после аварии записи прошлого XLSX с
   `status=running` больше не считаются **активной** задачей текущей вкладки.

### Важное ограничение

Для первого полного расчёта KPI по-прежнему нужны исходные данные ITSM,
«Мобильных бригад» и Equipment_Combined. TEST_14 не заявляет, что
271 496 и 54 753 записей полностью перестали загружаться: это потребует
отдельной, проверенной по формулам проекции или переноса подготовки
в отдельную ограниченную памятью задачу. В TEST_14 оптимизируются
**повторные проверки готового KPI Snapshot** и список Dataset.

## Журналы без сброса истории

Оба журнала автоматически активны в TEST_14:
- Runtime, импорт, KPI и открытие SQLite;
- XLSX Worker, сканирование, сериализация и выгрузка.

Журналы продолжают использовать IndexedDB и покомпонентный
синхронный `localStorage` WAL из TEST_13.
Переход с TEST_13 на TEST_14 **не очищает IndexedDB**:
в общем архиве сохраняются прежние сессии. Два JSON по завершении экспорта,
также доступны ручные кнопки скачивания и копирования.

При аварии вкладки `file://` и IndexedDB зависят от браузерного профиля,
доступности хранилища и квот. Нельзя технически гарантировать сохранение
события, для которого браузер так и не подтвердил запись на диск.

## Практическая проверка

1. Построить `*_CORE_TEST_14_PR322.html`, закрыть старые вкладки.
2. Открыть HTML в том же профиле Opera; подключить копию `Reclassifier.db`.
3. Перейти в «Работа с базой данных», посмотреть список активных Dataset.
   `runtime-derived-lazy` может появляться без `runtime-sqlite-materialize`
   оборудования на стадии списка.
4. Открыть дашборд KPI, завершить полный расчёт. Повторно открыть его:
   ожидаются `kpi-cache-light` / отсутствие нового полного получения
   источников только при валидном полном снимке.
5. Обновить небольшой Dataset на **копии** базы и убедиться, что зависимый
   `combined` перестроен, KPI пересчитан, а незатронутые Dataset не
   сброшены. Проверить числовое равенство KPI до/после при одинаковой базе.
6. Выгрузить Full Dataset МБ за январь 2025 (ожидаемые 11 650
   датированных полных строк по TEST_12) и сохранить XLSX вместе с двумя JSON.
7. Закрыть вкладку, снова открыть **тот же файл по тому же пути**,
   скачать Runtime/XLSX историю. В JSON проверить `idbStatus`,
   `eventsRecovered`, `walPending`, `completenessKnown` и прошлые sessionId.

### Проверки Codespaces

```bash
cd /workspaces/Reclassifer
set -euo pipefail

git fetch origin
git switch feature/pr322-sqlite-mb-paged-xlsx-export
git pull --ff-only origin feature/pr322-sqlite-mb-paged-xlsx-export

node tests/test_runtime_derived_lazy_test14.js
node tests/test_kpi_snapshot_cache_test14.js
node tests/test_runtime_lazy_test13.js
node tests/test_runtime_data_repository.js
node tests/test_diagnostics_history_test13.js
node tests/test_diagnostics_indexeddb_test13.js
node tests/test_diagnostics_test12.js
node tests/test_xlsx_export_diagnostics_test11.js
node tests/test_database_oom_diagnostics.js
node tests/test_reliability_report_service.js
node tests/test_dataset_single_xlsx_protocol.js
node tests/test_dataset_single_xlsx_stream.js
node tests/test_sqlite_mobile_brigade_paged_export.js
node tests/test_worker_client.js
node tests/test_mb_worker_recycling.js

python -m unittest discover -s tests -p 'test_js_fragment_contract.py'
python -m unittest discover -s tests -p 'test_database_workspace_contract.py'
python -m unittest discover -s tests -p 'test_build_test_label.py'
python -m unittest discover -s tests -p 'test_architecture_guardrails.py'

python build/build.py --core --test-label TEST_14_PR322
ls -lh dist/*_CORE_TEST_14_PR322.html
```

Изменения пока не проверены реальным Codespaces и Opera: полный прогон
обязателен перед объединением PR.
