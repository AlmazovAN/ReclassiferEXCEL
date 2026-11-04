# PR 12 — комплексная приёмка накопительной модели Reclassifier

## Объект проверки

Текущий `main` после PR 1–11. Контроль ведётся по фактическим тестам и журналу GitHub Actions. Успешный CI означает принятие перечисленных **автоматизированных** сценариев, а не подтверждение всех возможных выгрузок корпоративных ИС.

## Матрица приёмки

| Сценарий | Исполняемый контроль | Уровень |
|---|---|---|
| ITSM/МБ: накопление, UPSERT, частичный Full Dataset и сохранение неизвестных исходных столбцов | `tests/test_sqlite_full_dataset_roundtrip.js`, `tests/test_dataset_pipeline.js`, `tests/test_mobile_brigade_upsert.js` | Regression/integration |
| ITSM и МБ: расчётные поля, частичный ReClass, дата создания, неизменность исходных полей | `tests/test_itsm_recalculation_pr4.js`, `tests/test_mobile_brigade_recalculation_pr5.js` | Regression |
| Предпросмотр, подтверждённый транзакционный COMMIT, rollback и KPI Source | `tests/test_recalculation_core_pr3.js`, `tests/test_recalculation_commit_pr6.js`, `tests/test_recalculation_workspace_pr7.js` | Integration |
| Equipment: пять секционных источников, join по ID, отказ при неоднозначном руднике | `tests/test_equipment_partition_pr8.js` | Integration |
| Equipment: история событий, отмена «выбытия», полные наблюдения | `tests/test_equipment_history_pr9.js` | Regression |
| Историческая численность по подтверждённым снимкам; неизвестность не считается нулём | `tests/test_equipment_population_pr10.js` | Regression |
| **Сквозная цепочка Equipment**: загрузка двух рудников → обновление одного → повтор → история → численность → сериализация → Zabbix | **`tests/test_pr12_equipment_chain.js`** | **Cross-layer** |
| SQLite Full Dataset: export, reopen, структурная совместимость и целостность | `tests/test_sqlite_full_dataset_roundtrip.js` | Integration |
| SQLite → HTML: Active Runtime, ручное зеркало, переносимый снимок, повторное чтение, повреждённый pack | `tests/test_html_snapshot.js` | Integration |
| Браузерная offline-сборка, SQLite и экспорт/открытие HTML | `tests/test_step9_browser_offline.js` | Browser E2E |
| Версионирование и состав единой HTML-сборки | `tests/check_full_html_snapshot.py`, `tests/test_js_fragment_contract.py` | Contract |

## Не выдавать за подтверждённые результаты

1. Реальная выборка 2025 года из корпоративных ITSM/МБ не загружалась в этом PR специально для контрольного независимого пересчёта. Проверяются эталонные и синтетические сценарии плюс уже имеющиеся исторические тестовые источники.
2. Работа двух пользователей одновременно над SQLite в сетевой папке, автоматическая запись в UNC-путь и двустороннее слияние HTML/SQLite **не поддерживаются**.
3. Модель Equipment Population опирается на подтверждённые **наблюдения** PR 9: она не знает достоверную дату ввода, когда источники её не дают.
4. Полнота всех реальных полей (различающихся по выгрузкам) требует отдельной пользовательской проверки с утверждёнными контрольными примерами, без изменения аналитических правил на этом этапе.
5. `Скачать` в браузере не гарантирует сохранение на сетевой диск: скачанный файл должен быть проверен вручную.

## Критерии выпуска

- Изменения только в тестах и документации, если регрессии не обнаружены; дефекты production исправляются отдельно с тестом-причиной.
- Новый интеграционный тест обязателен в workflow.
- Готовый CORE HTML проходит сборку, проверку автономного Chromium и проверку подключения SQLite.
- Все GitHub Actions на HEAD PR — `success` до слияния.
- Merge только в `main`; в финальном отчёте указывать PR и точный commit, не утверждая «полную проверку пользователем».
