# Database Workspace — финальная регрессия

Эта матрица фиксирует приёмочные сценарии после этапов Dataset/DB State Model, Excel Queue UI, Active References UI и Actions & Synchronization.

| Сценарий | Что проверяется | Автоматическая проверка |
|---|---|---|
| Один Excel | распознавание Dataset, строка очереди, режим, схема, свежесть и автоматическая подготовка кандидата | `test_database_queue_background_prepare.js`, `test_database_workspace_final_acceptance.js`, `test_database_recognizer.js` |
| Несколько Excel | один файл = одна строка, последовательная фоновая подготовка, независимое удаление из очереди | `test_database_queue_background_prepare.js`, `test_database_workspace_final_acceptance.js` |
| UPSERT | background prepare → explicit confirm → commit, inserted/updated/unchanged, сохранение незатронутых строк | `test_database_integration.js`, `test_sqlite_wasm_large_upsert.js` |
| UPSERT без изменений | `до = после`, `+0`, affected = 0 | `test_database_workspace_final_acceptance.js` |
| REPLACE | полная замена Dataset; diff показывает −старые / +новые / после | `test_database_integration.js`, `test_database_workspace_final_acceptance.js` |
| Нераспознанный/плохой Excel | причина ошибки видна, подтверждение недоступно, SQLite не меняется | `test_database_workspace_final_acceptance.js`, `test_database_recognizer.js` |
| Пересчёт кандидатов после изменения БД | неподтверждённые планы инвалидируются и готовятся заново | `test_database_queue_background_prepare.js` |
| Повторный commit со stale plan | блокировка при смене DB UUID или revision | `test_database_integration.js` |
| Прерывание крупной загрузки | rollback транзакции, Dataset остаётся консистентным | `test_step9_large_xlsx.js`, `test_step9_bootstrap_rollback.js` |
| Удаление файла из очереди | удаляется только UI-элемент, БД не меняется | `test_database_workspace_final_acceptance.js` |
| SchAPP ≠ SchDB | расхождение не скрывается и визуально остаётся явным | `test_dataset_db_state_model.js`, `test_database_workspace_final_acceptance.js` |
| start HTML / SQLite DB / active Runtime | три независимых состояния видимы одновременно | `test_dataset_db_state_model.js`, `test_database_workspace_final_acceptance.js` |
| COMMITTED/FAILED последней попытки | статус берётся из SQLite import history | `test_dataset_db_state_model.js`, `test_database_workspace_final_acceptance.js` |
| Ручной refresh | invalidate Runtime, повторное чтение state model, health check | `test_database_workspace_synchronization.js` |
| SQLite active ⇔ Runtime sqlite | обнаружение рассинхронизации | `test_database_workspace_synchronization.js` |
| Повторное открытие Reclassifier.db | данные и Dataset Registry сохраняются | `test_sqlite_full_dataset_roundtrip.js`, `test_legacy_sqlite_parity.js` |
| CORE HTML → SQLite | пустой стартовый CORE; открытие и сохранение пользовательской SQLite | `test_core_browser_offline.js`, `test_sqlite_full_dataset_roundtrip.js` |
| Повреждённая/несовместимая БД | текущая сессия не теряется, открытие отклоняется | `test_database_core.js`, `test_step9_bootstrap_rollback.js` |
| Offline CORE HTML | приложение стартует и работает без сети | `test_core_browser_offline.js` |
| CORE HTML | артефакт не содержит встроенных бизнес-Dataset | `check_core_html.py` |

Финальный критерий релиза: полный локальный workflow должен завершиться успешно, включая пустой CORE HTML в offline Chromium.
