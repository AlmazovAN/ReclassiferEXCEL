@echo off
where py >nul 2>&1
if errorlevel 1 (
    python "%~dp0serve_folders.py" --open
) else (
    py "%~dp0serve_folders.py" --open
)
if errorlevel 1 pause
