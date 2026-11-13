# Локальные проверки на Windows

Одна целевая сборка: `ReclassifierEXCEL.html`. Тесты выполняются локально, GitHub Actions не используются.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/local-ci.ps1 verify
```

Доступные режимы: `verify` (синтаксис, manifest, сборка и тесты), `build` (только сборка), `test` (тесты на уже собранном HTML), `fast` (основные тесты «Папок»).

В проекте нужны установленные Python и Node.js; SheetJS хранится в `vendor/xlsx.full.min.js`. Тесты используют только синтетические данные. Запуск `verify` не выполняет `git push`, не запускает Actions и не читает рабочие Excel.
