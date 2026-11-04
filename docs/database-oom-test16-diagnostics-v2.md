# TEST_16_PR326 — Runtime Diagnostics V2 / OOM forensic checkpointing

**Основа:** RFC #325, поверх Draft #324. Ветка `feature/test16-diagnostic-v2`.  
**Режим:** только TEST_16. Ключевые алгоритмы KPI, SQLite schema, нормализация Excel и формат XLSX не изменены.

## Что исправлено

1. **Не путать счётчик окна и архив.** В Database Workspace отображаются отдельно:
   - архив Runtime (количество событий, найденное отдельным обходом IndexedDB + WAL при запуске);
   - события текущей сессии;
   - глобальный монотонный номер события (сохраняется в localStorage);
   - число подтверждённых синхронных записей в localStorage WAL;
   - число обнаруженных прерванных предыдущих сессий.
2. **Аварийный checkpoint:** независимый ключ `reclassifier.diagnostic-v2.state`.
   Короткая запись выполняется синхронно **до** потенциально дорогого участка. Не делает полный `JSON.stringify` всех накопленных событий.
3. **Архив:** существующий `ReclassifierDiagnosticHistoryV13` и IndexedDB/WAL не удаляются и не переименовываются. V2 добавляет `v2.globalSeq`, `v2.bootId`, `v2.operationId` к новым событиям и включает `diagnosticV2` в скачиваемые JSON.
4. **Нагрузочная защита:** Runtime UI ring-buffer (360 последних событий) копируется в localStorage раз в 64 события, а не на каждом событии. **Каждое** событие по-прежнему получает отдельную WAL-запись непосредственно при `history.append()`. Обновление интерфейса не ждёт полного копирования ring-buffer.
5. **Устойчивость:** аварийный повторный запуск извлекает `running.phase` предыдущего `bootId` и добавляет запись `recovered-interrupted` в V2 summary. В оригинальном архиве ничего не удаляется.
6. **Контроль архивных пропусков:** `storage.missingSequences` — консервативная оценка расхождения между ожидаемым числом событий и найденными записями; `completenessKnown` зависит от архивного сравнения.
7. **Явные показатели памяти:** перед копированием SQLite отслеживаются input bytes и размер ресурса на границе WASM VFS; в KPI Worker — число записей и Full Dataset rows, перед `candidate-records` — файл и ожидаемые строки, после материализации — объём Runtime cache и его освобождение. **Строки не переводятся в мегабайты без измерения.**

## Что не считается измеренным

`performance.memory.usedJSHeapSize`, `sqliteWasmCapacityMiB` и `runtimeCacheRows` **не являются RSS браузера**. Они не показывают реальный пик по GPU, WASM, VFS, worker structured clone и C++-аллокациям. Файл базы в памяти может иметь несколько копий до сборки мусора; `inputBufferBytes:0` означает, что ссылка сброшена, а **не** что память физически вернулась ОС.

`globalSeq` монотонен только при успешной работе локального хранилища в одном профиле/origin. При очистке данных Opera, смене пути `file://`, изоляции хранилища, quota denial или сбое ОС нельзя обещать абсолютную сохранность. `lastWalAck` — подтверждение синхронного `localStorage.setItem`, не аппаратного `fsync`. Новая V2 телеметрия сообщает `storageFailures`, не скрывает их.

## Испытание в Codespaces

```bash
cd /workspaces/Reclassifer
git fetch origin
git switch feature/test16-diagnostic-v2
git pull --ff-only origin feature/test16-diagnostic-v2
bash tests/run_test16_codespaces.sh
```

Скрипт сохраняет журнал `diagnostics/TEST_16_codespaces_<UTC>.log`. При прохождении проверок формирует `dist/*_CORE_TEST_16_PR326.html`. Не запускается GitHub Actions; проверка выполняется внутри Codespaces.

## Проверка в Opera

Перед проверкой **сохранить исходную SQLite и два JSON TEST_15**; не чистить browser site data, IndexedDB или WAL.

1. Открыть TEST_16 HTML, проверить статус архива (количество старых записей должно быть больше нуля) и новый счётчик текущей сессии.
2. Открыть копию `Reclassifier.db` (≈860 MiB), запустить импорт того же ITSM XLSX (≈18 MiB); проверить `candidate-records/start` и аварийный checkpoint.
3. Запустить KPI и последующее чтение `mobile_brigade_data`, проверить `runtime-cache-state` / `kpi-worker-init` с количеством строк.
4. **Для имитации сбоя лучше использовать тесты Node**, не провоцировать исчерпание памяти рабочей Opera. Если естественная авария повторится, перезапустить ту же HTML по тому же `file://` пути/профилю, скачать Runtime JSON и проверить архив и `recovered-interrupted`.
5. Сравнить архивные события и `missingSequences` до/после. Пропуск последнего незавершённого события должен быть отмечен, а не маскироваться новым нулевым счётчиком.
6. В Opera Task Manager и Windows Task Manager отдельно зафиксировать Memory Footprint (MB), число Worker и пик; сохранить время UTC рядом с диагонстическим JSON.

## Приёмка

- В исходной SQLite не появляются новые таблицы/поля; KPI и экспорт выдают идентичный результат.
- В Runtime JSON видны новые поля `diagnosticV2`, а у TEST_16 событий — `v2.globalSeq`.
- После имитированного crash/reload старый архив читается, interrupted step фиксируется; текущий счётчик отделён от архивного.
- Отказ локального хранилища даёт сообщение об ошибке, а не ложную гарантию целостности.
- Полные Node/Python guardrails и CORE build проходят; реальный OOM-тест — отдельный отчёт, без заявления «исправлено».

## Далее

Следующий PR по RFC: измерение реального RSS и удерживаемых JS/WASM буферов на воспроизводимой копии БД. До него не переносить новые изменения архитектуры SQLite/OPFS/KPI/XLSX в TEST_16.
