# PR 4/5 · освобождение очереди после COMMIT и безопасное обновление Runtime

## Исходная проблема

После подготовки и COMMIT первой выгрузки МБ (72 283 строки) пользователь нажал
«Синхронизировать HTML и SQLite», затем добавил Excel за 2025 год
(70 808 строк). В диагностике второй загрузки JS heap был **2222 МиБ**,
распознавание зависло на повторном `recognizer-xlsx`.
Повторный разбор уже устранён в PR #319.

Следующий контрольный журнал PR #319 подтвердил `candidate-inspection-reuse`
и чтение только 25 строк классификатором, но после ручной синхронизации
показал `runtime-sqlite-materialize` на множество полных Dataset,
включая 190 765 и 54 753 записи (на тот момент JS heap 2356 МиБ).
Это соответствует работе прежней кнопки:
`synchronizeSqliteToHtml() -> buildDatasetPack() ->
prepareDatasetPackRestore() -> datasetPipeline.replaceSqliteMirror()`.
Она создаёт вторую, неавторитетную HTML-копию всей SQLite в памяти.

`fileCount:2` на прежнем экране означал **две записи в очереди**;
первая запись уже была `committed` и не перерабатывалась. Её
`pendingPlan` удалялся, но `File` и `inspectedFile` оставались.

## Исправления

1. После успешного одиночного/Equipment-пакетного COMMIT, при успешном
   Runtime refresh, ранее завершённые записи автоматически удаляются из
   `databaseWorkspaceState.intake`. Ссылки `File`, `inspectedFile`,
   `pendingPlan` очищаются. `import_history`/транзакция SQLite не
   изменяются. Если COMMIT состоялся, но Runtime sync завершился ошибкой,
   оставляем лёгкую строку с предупреждением, **без File**.
   Кандидаты `prepared`, `queued`, `error`, отменённые работы и
   неподтверждённые файлы не удаляются.
2. Видимая кнопка **«Обновить Runtime из SQLite»** вместо прежней
   «Синхронизировать HTML и SQLite» запускает
   `databaseSynchronizeWorkspace('manual',{checkHealth:true,render:true,refreshDerived:false})`.
   Runtime cache сбрасывается, SQLite health/registry проверяются,
   `derived` не материализуются заранее и доступны для ленивого доступа.
   **Полный HTML Dataset pack и зеркало НЕ создаются**.
3. **«Сохранить HTML с данными»** оставлено независимым путём
   `downloadUpdatedHtml -> buildDatasetPack`, формирующим автономную копию
   из текущей SQLite по явному запросу. Для очень больших БД полный
   HTML-экспорт по-прежнему требует значительной памяти — он не нужен для
   последовательного импорта Excel.
4. Диагностические маркеры `committed-queue-release/end` и
   `manual-runtime-refresh/start/end`.

**Не изменяются**: права подтверждения/отмены, транзакционность COMMIT,
правила классификации МБ, корреспонденция ITSM → МБ, суммарные часы,
реестры оборудования, SQL схема, расчёты KPI, кнопка сохранения SQLite
на диск, подлинная исходная выгрузка. Никаких автоматических действий с
корпоративными файлами вне браузера.

## Команды Codespaces

```bash
cd /workspaces/Reclassifer
git fetch origin
git switch feature/pr320-oom-commit-cleanup-runtime-sync
git pull --ff-only origin feature/pr320-oom-commit-cleanup-runtime-sync
git status --short

set -e
node tests/test_database_oom_post_commit_release.js
node tests/test_dataset_classifier.js
node tests/test_database_recognizer.js
node tests/test_mobile_brigade_sqlite_itsm_link.js
node tests/test_mobile_brigade_worker_processor.js
node tests/test_itsm_sqlite_link_projection.js
node tests/test_database_integration.js
node tests/test_database_oom_diagnostics.js
node tests/test_mb_memory_diagnostics.js
node tests/test_html_snapshot.js
python -m unittest discover -s tests -p 'test_database_workspace_contract.py'
python -m unittest discover -s tests -p 'test_build_test_label.py'
python build/build.py --core --test-label TEST_04_PR320
ls -lh dist/*_CORE_TEST_04_PR320.html
```

В момент создания PR изолированный динамический тест очистки очереди и
лёгкого Runtime refresh **пройден**, синтаксис изменённых JS-файлов
проверен. Codespaces и реальный Opera stress test требуют запуска.

Тестовые сборки создавайте с уникальным именем `--test-label`.
Текущая: `Reclassifier_v<version>_CORE_TEST_04_PR320.html`.
Обычная команда без аргумента по-прежнему создаёт
`Reclassifier_v<version>_CORE.html`. Следующая итерация может использовать
`TEST_05_PR321`, чтобы файлы не перезаписывались и не путались при открытии
в Opera.

## Ручная приёмка в Opera (только на копии Reclassifier.db)

1. Открыть свежий `*_CORE.html`, подключить копию исходной SQLite,
   включить OOM диагностику.
2. Загрузить первый файл 2026, проверить кандидата (72 283 строки),
   затем нажать **«Подтвердить»** на копии SQLite.
3. Убедиться, что запись файла исчезла из **рабочей очереди**, а операция
   осталась в **истории импорта SQLite**. Маркер
   `committed-queue-release/end` подтверждает освобождение.
4. При желании нажать **«Обновить Runtime из SQLite»**. В журнале ожидается
   `manual-runtime-refresh/end`, без массового `runtime-sqlite-materialize`
   именно из-за этого действия. Важно: асинхронные вычисления KPI могут
   в другое время отдельно материализовать Dataset.
5. Загрузить вторую выгрузку 2025 (22 589 517 байт, 70 808 строк)
   **в той же вкладке, без перезагрузки**. Ожидаем
   `candidate-inspection-reuse/end`, `mb-worker/end`,
   `candidate-sqlite-preview/end`, `candidate-prepare/end`.
6. Проверить число добавленных/обновлённых/неизменившихся строк.
   Подтверждать второй кандидат только после проверки на копии БД.
7. Если есть ошибка, сохранить новый диагностический JSON и точное
   действие, которое её вызвало.

Важно: **COMMIT в памяти SQLite ≠ сохранение файла БД на диск**.
После проверки в приложении отдельно сохранить обновлённую SQLite
через предусмотренную кнопку. «Обновить Runtime» не сохраняет .db;
«Сохранить HTML с данными» формирует автономный HTML-снимок.

## Оставшийся риск

Большие `pendingPlan.records` и `fullDataset.rows` до COMMIT,
Worker XLSX разбор и фоновые KPI расчёты всё ещё требуют памяти. Это
не PR по staged SQLite candidate; для десятков одновременных больших
кандидатов необходим следующий отдельный PR с пакетной записью.
