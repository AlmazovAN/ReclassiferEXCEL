# TEST_11_PR322 — диагностика памяти и производительности единого XLSX

## Сценарий

Сборка `python build/build.py --core --test-label TEST_11_PR322` включает подробную
диагностику экспорта из SQLite на странице «Мобильные бригады» автоматически.
Обычные сборки без этой тестовой метки не запускают этот журнал.

1. Используйте копию `Reclassifier.db`; экспорт работает только на чтение.
2. Откройте именно `Reclassifier_v0.37.0_CORE_TEST_11_PR322.html` в Opera.
3. Подключите SQLite и перейдите на страницу «Мобильные бригады».
4. Выберите небольшой стабильный период, 38-колоночный режим Full Dataset.
5. Нажмите «Скачать XLSX» и дождитесь окончания.
6. Проверьте два файла в «Загрузках»: `Mobile_Brigade_full_...xlsx` и
   `Reclassifer_XLSX_Diagnostic_TEST_11_PR322_completed_...json`.
   Если браузер заблокировал второе скачивание, нажмите «Скачать отчёт JSON»
   либо «Копировать отчёт».
7. Приложите диагностический JSON в чат или вставьте скопированный текст.

## Что регистрируется

- Предварительные счётчики Full Dataset, покрытие строк, количество колонок, период, режим и ревизия.
- Синхронные контрольные точки чтения SQLite: номер порции, offset, число возвращённых
  и просмотренных строк, число совпадающих по периоду строк, объём распарсенного JSON
  в UTF-16 символах, время чтения порции в миллисекундах.
- Контрольные точки между процессами: запрос следующей порции и время ожидания в Worker.
- В Worker: начало/конец append, количество ячеек, число длинных текстов и продолжений,
  время append, начало/конец finish и начало/конец монолитного `XLSX.write`.
- Длина готового ArrayBuffer, передача результата и запрос скачивания XLSX.
- Длительность всей операции, последнее начатое и завершённое действие.
- При наличии API — выборки использованной JS-кучи main thread и Worker.
  Они **не** являются полным RSS/Private Bytes браузера.
  Worker JS heap, SQLite WASM и RSS могут оставаться `unavailable`.

Журнал содержит максимум 320 последних событий. Ранее записанные события из этого
запуска при вытеснении учитываются счётчиком `discardedEvents`.
Имена корпоративных файлов, ключи записей, значения ячеек и исходные JSON не сохраняются.
Отчёт JSON содержит название тестовой сборки и строку user-agent браузера.

## Аварийное завершение вкладки

Контрольные точки записываются синхронно в localStorage. После аварии откройте **тот
же HTML по тому же пути и в том же профиле Opera** — в карточке МБ появится
`running` с последним событием и кнопкой копирования.

**Гарантии сохранения после аварии нет:** в локальном `file://` окружении
localStorage может быть запрещён, а ОС/браузер не обязаны гарантировать запись
в постоянное хранилище на каждой контрольной точке. Нельзя скачать JSON
автоматически после прекращения процесса renderer; автовыгрузка запускается
только при нормальном завершении или обработанной ошибке.

Браузер может запросить разрешение на несколько скачиваний. Запуск скачивания
не подтверждает запись на диск.

## Диагностика не является исправлением OOM

`TEST_11` не заменяет SheetJS на streaming XLSX Writer, не сокращает
массив ячеек и не меняет SQLite/правила обработки. На большом объёме
`XLSX.write()` всё ещё может завершить renderer. Начинать испытания следует
с небольших периодов.

## Проверка Codespaces

```bash
cd /workspaces/Reclassifer
git fetch origin
git switch feature/pr322-sqlite-mb-paged-xlsx-export
git pull --ff-only origin feature/pr322-sqlite-mb-paged-xlsx-export
set -e
node tests/test_xlsx_export_diagnostics_test11.js
node tests/test_database_oom_diagnostics.js
node tests/test_dataset_single_xlsx_stream.js
node tests/test_dataset_single_xlsx_protocol.js
node tests/test_sqlite_mobile_brigade_paged_export.js
node tests/test_dataset_export_long_text.js
node tests/test_worker_client.js
node tests/test_mb_worker_recycling.js
python -m unittest discover -s tests -p 'test_database_workspace_contract.py'
python -m unittest discover -s tests -p 'test_build_test_label.py'
python -m unittest discover -s tests -p 'test_architecture_guardrails.py'
python build/build.py --core --test-label TEST_11_PR322
ls -lh dist/*_CORE_TEST_11_PR322.html
```
