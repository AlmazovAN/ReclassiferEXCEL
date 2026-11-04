(() => {
  'use strict';

  const build = window.RECLASSIFIER_BUILD || { version: 'dev' };
  const assets = window.RECLASSIFIER_ASSETS || {};

  const moduleConfig = {};
  const moduleRenderers = {};
  const moduleProcessors = {};

  function registerModule(moduleId, config, renderer, processor = null) {
    moduleConfig[moduleId] = Object.freeze(Object.assign({}, config));
    moduleRenderers[moduleId] = renderer;
    if (typeof processor === 'function') moduleProcessors[moduleId] = processor;
  }

  const state = {
    route: 'home',
    sourceFile: null,
    activeReferenceId: null,
    activeEquipmentId: null,
    activeFailureClassifierId: null,
    failureClassifierHistory: [],
    workerReady: false,
    baselineReady: false,
    processingModuleId: null,
    processingOperationId: null,
    log: []
  };

  const el = {
    pageTitle: document.getElementById('pageTitle'),
    pageDescription: document.getElementById('pageDescription'),
    pageEyebrow: document.getElementById('pageEyebrow'),
    pageContent: document.getElementById('pageContent'),
    runtimeDot: document.getElementById('runtimeDot'),
    runtimeState: document.getElementById('runtimeState')
  };

  document.querySelectorAll('[data-app-version]').forEach(node => { node.textContent = build.version || 'dev'; });

  function log(message, level = 'INFO', category = null) {
    const journal = globalThis.ReclassifierDiagnosticJournal;
    const group = category || (level === 'ERROR' ? 'runtime' : 'general');
    const captured = journal?.capture(message, level, group);
    if (journal && !captured) return;
    const stamp = new Date().toLocaleTimeString('ru-RU');
    state.log.push(captured?.line || `[${stamp}] [${level}] ${message}`);
    if (state.log.length > 300) state.log.shift();
    if (state.route === 'log') refreshJournalVisibleRows();
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  // PR2: route-neutral indicators. SQLite source of truth remains the Repository;
  // KPI is marked current only after a complete, successful Report Snapshot.
  const headerKpiState = { phase: 'idle', percent: null };
  let headerLastDatabaseInfo = null;

  function refreshHeaderDatabase() {
    const nameNode = document.getElementById('globalDatabaseFile');
    const statusNode = document.getElementById('globalDatabaseSave');
    const container = document.getElementById('globalDatabaseIndicator');
    if (!nameNode || !statusNode || !container) return;
    const ui = typeof databaseWorkspaceState === 'undefined' ? null : databaseWorkspaceState;
    let info = null;
    // Avoid read-only queries against a Repository while a write mutex is held.
    if (!ui?.busy) {
      try { info = typeof databaseCurrentInfo === 'function' ? databaseCurrentInfo() : null; }
      catch (_) { info = null; }
      headerLastDatabaseInfo = info;
    } else {
      info = headerLastDatabaseInfo;
    }
    const linked = Boolean(info && ui?.fileConnection &&
      ui.fileConnection.databaseUuid === info.databaseUuid);
    let label = 'SQLite не подключена';
    let subtitle = 'Данные HTML';
    let stateClass = 'is-neutral';
    if (info) {
      label = String(info.fileName || 'Reclassifier.db');
      if (!info.valid || ui?.lastError && !info.valid) {
        subtitle = 'Ошибка базы данных';
        stateClass = 'is-error';
      } else if (ui?.saveProgress) {
        subtitle = 'Синхронизация с файлом…';
        stateClass = 'is-pending';
      } else if (info.dirty) {
        subtitle = linked ? 'Есть несохранённые изменения' : 'Требуется скачать БД';
        stateClass = 'is-pending';
      } else if (info.storage?.diskCurrent && linked) {
        subtitle = 'Все изменения сохранены';
        stateClass = 'is-saved';
      } else {
        subtitle = linked ? 'Нет новых изменений' : 'Файл открыт без прямой записи';
        stateClass = 'is-neutral';
      }
    } else if (ui?.lastError) {
      subtitle = 'Ошибка подключения БД';
      stateClass = 'is-error';
    }
    nameNode.textContent = label;
    statusNode.textContent = subtitle;
    container.className = 'header-status header-database-status ' + stateClass;
    container.title = label + ' · ' + subtitle;
  }

  function refreshHeaderKpi() {
    const container = document.getElementById('globalKpiIndicator');
    const textNode = document.getElementById('globalKpiText');
    if (!container || !textNode) return;
    const phase = headerKpiState.phase;
    const labels = {
      idle: 'KPI не рассчитаны', stale: 'Требуется пересчёт KPI',
      ready: 'KPI актуальны', partial: 'KPI рассчитаны · данные неполные', error: 'Ошибка расчёта KPI'
    };
    textNode.textContent = phase === 'calculating'
      ? 'Расчёт KPI · ' + Math.max(0, Math.min(100, Math.round(headerKpiState.percent || 0))) + '%…'
      : (labels[phase] || labels.idle);
    container.className = 'header-status header-kpi-status ' +
      (phase === 'ready' ? 'is-saved' : phase === 'error' ? 'is-error' :
       phase === 'idle' ? 'is-neutral' : 'is-pending');
  }

  function setHeaderKpiPhase(phase, percent = null) {
    if (!['idle', 'stale', 'ready', 'partial', 'error', 'calculating'].includes(phase)) return;
    headerKpiState.phase = phase;
    headerKpiState.percent = phase === 'calculating' && Number.isFinite(percent)
      ? Math.max(0, Math.min(100, percent)) : null;
    refreshHeaderKpi();
  }

  function invalidateHeaderKpi() {
    // Source invalidation also occurs at the start of a fresh calculation.
    // Progress from that calculation must not be replaced with a stale badge.
    if (headerKpiState.phase !== 'calculating') setHeaderKpiPhase('stale');
  }

  function refreshHeaderIndicators() {
    refreshHeaderDatabase();
    refreshHeaderKpi();
  }

  globalThis.ReclassifierHeaderIndicators = Object.freeze({
    refresh: refreshHeaderIndicators,
    refreshDatabase: refreshHeaderDatabase,
    setKpi: setHeaderKpiPhase,
    invalidateKpi: invalidateHeaderKpi
  });

  if (typeof window !== 'undefined' && typeof window.setInterval === 'function') {
    // Status-only DOM updates: never re-render a page or copy Dataset payloads.
    window.setInterval(refreshHeaderDatabase, 1800);
  }

  function setHeader(eyebrow, title, description) {
    el.pageEyebrow.textContent = eyebrow;
    el.pageTitle.textContent = title;
    el.pageDescription.textContent = description;
    refreshHeaderIndicators();
  }

  function navigate(route) {
    if (state.processingModuleId) {
      if (route === state.route) return;
      const title = moduleConfig[state.processingModuleId]?.title || state.processingModuleId;
      log('Переход заблокирован: выполняется обработка модуля ' + title + '.', 'WARN');
      alert('Дождитесь завершения обработки «' + title + '».');
      return;
    }
    if (typeof databaseWorkspaceState !== 'undefined' && databaseWorkspaceState.busy &&
        state.route === 'database' && route !== 'database') {
      log('Навигация временно заблокирована во время операции с SQLite.', 'WARN');
      return;
    }
    if (state.route === 'reliability_dashboard' && route !== 'reliability_dashboard' &&
        typeof cancelStagedReliabilityCalculation === 'function') {
      cancelStagedReliabilityCalculation();
    }
    if (state.route === 'kpi_passports' && route !== 'kpi_passports' &&
        typeof cancelKpiPassportCalculation === 'function') {
      cancelKpiPassportCalculation();
    }
    state.route = route;
    state.sourceFile = null;
    state.activeReferenceId = null;
    state.activeEquipmentId = null;
    state.activeFailureClassifierId = null;
    // The KPI passports page is accessed from the reliability report toolbar.
    // Keep its parent navigation item highlighted while the catalog is open.
    const activeNavRoute = route === 'kpi_passports' ? 'reliability_dashboard' : route;
    document.querySelectorAll('.nav-item').forEach(node => node.classList.toggle('active', node.dataset.route === activeNavRoute));
    render();
  }

  function render() {
    try {
      if (state.route === 'home') return renderHome();
    if (state.route === 'reliability_dashboard') return renderReliabilityDashboard();
    if (state.route === 'kpi_passports') return renderKpiPassportsPage();
    if (moduleRenderers[state.route]) return moduleRenderers[state.route]();
    if (state.route === 'references') return renderReferences();
    // Legacy equipment route now resolves to the unified References page.
    if (state.route === 'equipment') return navigate('references');
    if (state.route === 'failure_classifier') return renderFailureClassifier();
    if (state.route === 'database') return renderDatabaseWorkspace();
    if (state.route === 'log') return renderLog();
    if (state.route === 'about') return renderAbout();
    navigate('home');
    } finally {
      if (state.bootstrapState === 'failed' && el.pageContent?.insertAdjacentHTML) {
        el.pageContent.insertAdjacentHTML('afterbegin',
          '<div class="notice invalid" role="alert" id="bootstrapFailureNotice">' +
          '<strong>Стартовые данные загружены не полностью.</strong> ' +
          'Обработка отключена. Причина: ' + escapeHtml(state.bootstrapError || 'неизвестна') +
          '. Проверьте журнал и откройте HTML заново.' +
          '<button type="button" class="button" id="retryBootstrapButton">Повторить открытие</button></div>');
        document.getElementById('retryBootstrapButton')?.addEventListener('click', () =>
          window.location.reload());
      }
    }
  }
