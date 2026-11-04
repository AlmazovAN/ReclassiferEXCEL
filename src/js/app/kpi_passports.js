// FILE CONTRACT: independent KPI passports page built from the SAME Catalog and Passport View as dashboard modal.
// Owns: simplified grouped catalog navigation, one active passport and route-local snapshot presentation.
// Reads: KPI Catalog, shared Passport View, Reliability Report Service and dashboard filter state.
// Writes: pageContent DOM and transient page UI state only.
// Must not: implement formulas, read SQLite directly or duplicate passport HTML/methodology.
const kpiPassportsPageUiState = {
  selectedId: 'vbr',
  activeTab: 'overview'
};

function kpiPassportsPageCatalog() {
  const catalog = globalThis.ReclassifierKpiCatalog;
  const passport = globalThis.ReclassifierKpiPassportView;
  if (!catalog?.list || !catalog?.get || !Array.isArray(catalog.groups) ||
      typeof passport?.renderContent !== 'function') {
    throw new Error('KPI Passports page requires the shared Catalog and Passport View.');
  }
  return { catalog, passport };
}

function kpiPassportsFilteredEntries(catalog) {
  // PR8: the catalog is navigated directly; search and filter controls are removed.
  // Preserve all published method passports, including methods awaiting implementation.
  return catalog.list().filter(entry => entry.id !== 'data_freshness');
}

function renderKpiPassportsCatalogList(catalog, entries, selectedId) {
  if (!entries.length) {
    return '<p class="kpi-passports-list-empty">Показатели отсутствуют.</p>';
  }

  return catalog.groups.map(group => {
    const groupEntries = entries.filter(entry => entry.definition.category === group.id);
    if (!groupEntries.length) return '';
    return `<section class="kpi-passports-group" aria-label="${escapeHtml(group.title)}">
      <h3>${escapeHtml(group.title)}</h3>
      <div class="kpi-passports-group-items">
        ${groupEntries.map(entry => {
          const selected = entry.id === selectedId;
          const working = entry.calculationState === 'implemented';
          return `<button type="button" class="kpi-passports-catalog-item${selected ? ' selected' : ''}"
            data-kpi-passport-select="${escapeHtml(entry.id)}"
            aria-controls="kpiPassportsDetail" aria-pressed="${selected ? 'true' : 'false'}">
              <span class="kpi-passports-item-copy"><strong>${escapeHtml(entry.definition.title)}</strong>
                <small>${escapeHtml(entry.id)}</small></span>
              <span class="kpi-passports-item-state${working ? ' implemented' : ' pending'}">${working ? 'Расчёт' : 'Ожидает'}</span>
            </button>`;
        }).join('')}
      </div>
    </section>`;
  }).join('');
}

function renderKpiPassportsDetail(passport, entry, snapshot, activeTab = kpiPassportsPageUiState.activeTab) {
  if (!entry) return '<div class="kpi-passports-empty-detail">Для выбранных условий показатели не найдены.</div>';
  // The HTML source here is shared with the Step 5 modal — no second passport renderer.
  return passport.renderContent(entry.id, { snapshot, activeTab });
}

function kpiPassportsSnapshotContext(snapshot, snapshotError) {
  if (!snapshot) {
    const reason = snapshotError ? ': ' + snapshotError : '';
    return 'Актуальный Report Snapshot недоступен' + reason +
      '. Показаны определения из каталога, без рассчитанных значений.';
  }
  const query = snapshot.query || {};
  const date = query.period?.label || 'Период не определён';
  const mine = query.mine?.label || 'Все рудники';
  const equipment = query.equipmentClass?.label || 'Всё оборудование';
  return 'Расчётный срез: ' + [date,mine,equipment].join(' · ');
}

let passportCalculationController=null;
function cancelKpiPassportCalculation() {
  if (passportCalculationController && !passportCalculationController.signal.aborted) {
    passportCalculationController.abort();
    globalThis.ReclassifierHeaderIndicators?.setKpi?.('stale');
  }
  passportCalculationController=null;
}
function renderKpiPassportsPage() {
  cancelKpiPassportCalculation();
  try {
    const { catalog, passport } = kpiPassportsPageCatalog();
    // Render method cards immediately. SQLite access and historical KPI
    // calculations are deferred until after the browser has painted the page.
    // A cached Report Snapshot from the dashboard is reused if still current.
    const service = globalThis.ReclassifierReliabilityReportService;
    const requestedFilters = { ...reliabilityDashboardFilterState };
    let snapshot = null;
    let snapshotError = null;

    setHeader('Методология показателей', 'Паспорта KPI',
      'Единый каталог определений, источников и расчётных методик.');

    const entries = kpiPassportsFilteredEntries(catalog);
    if (!entries.some(entry => entry.id === kpiPassportsPageUiState.selectedId)) {
      kpiPassportsPageUiState.selectedId = entries[0]?.id || null;
    }

    const selectedEntry = catalog.get(kpiPassportsPageUiState.selectedId);
    const snapshotContext = 'Методика доступна. Загружаются фактические значения и трассировка расчёта…';

    el.pageContent.innerHTML = `
      <div class="kpi-passports-page">
        <header class="kpi-passports-page-head">
          <div>
            <p class="kpi-passports-eyebrow">Каталог методик · версия ${escapeHtml(catalog.version)}</p>
            <h2>Паспорта показателей</h2>
            <p>Описания формул и происхождения данных синхронизированы с паспортами в отчёте по надёжности.</p>
            <p class="kpi-passports-snapshot-context" id="kpiPassportsSnapshotContext">${escapeHtml(snapshotContext)}</p>
          </div>
          <button class="button kpi-passports-report-link" type="button" id="kpiPassportsGoReport">К отчёту по надёжности</button>
        </header>

        <div class="kpi-passports-layout">
          <aside class="kpi-passports-sidebar" aria-label="Каталог показателей">
            <div class="kpi-passports-sidebar-head">
              <h2>Показатели</h2>
            </div>
            <nav class="kpi-passports-catalog-list" id="kpiPassportsCatalogList" aria-label="Выбор паспорта KPI">
              ${renderKpiPassportsCatalogList(catalog,entries,kpiPassportsPageUiState.selectedId)}
            </nav>
          </aside>
          <article class="kpi-passports-detail" id="kpiPassportsDetail" aria-label="Содержание выбранного паспорта">
            ${renderKpiPassportsDetail(passport,selectedEntry,snapshot)}
          </article>
        </div>
      </div>
    `;

    const listNode = document.getElementById('kpiPassportsCatalogList');
    const detailNode = document.getElementById('kpiPassportsDetail');
    const reportButton = document.getElementById('kpiPassportsGoReport');
    const snapshotContextNode = document.getElementById('kpiPassportsSnapshotContext');
    // One delegated handler also works when the detail HTML is refreshed after
    // async Snapshot completion. Tab choice stays intact during refresh.
    passport.bindTabs?.(detailNode,
      tab => { kpiPassportsPageUiState.activeTab = tab; },
      kpiId => {
        if(kpiId!==kpiPassportsPageUiState.selectedId)return;
        detailNode.innerHTML=renderKpiPassportsDetail(
          passport,catalog.get(kpiId),snapshot);
      });
    function routeIsCurrent() {
      // Never paint a passport into a different route or filter selection.
      if (document.getElementById('kpiPassportsDetail') !== detailNode) return false;
      return ['period','mine','equipmentClass']
        .every(name => reliabilityDashboardFilterState[name] === requestedFilters[name]);
    }
    function paintSnapshot(nextSnapshot, error=null) {
      if (!routeIsCurrent()) return;
      snapshot=nextSnapshot;
      snapshotError=error?.message || null;
      if (error) globalThis.ReclassifierHeaderIndicators?.setKpi?.('error');
      else if (nextSnapshot && nextSnapshot.diagnostics?.stage !== 'primary') {
        globalThis.ReclassifierHeaderIndicators?.setKpi?.(
          nextSnapshot.status === 'ready' ? 'ready' :
          nextSnapshot.status === 'empty' ? 'idle' : 'partial'
        );
      }
      snapshotContextNode.textContent = kpiPassportsSnapshotContext(snapshot,snapshotError);
      // Keep the live selected passport and controls, not the old selection
      // captured before a possibly long asynchronous Worker calculation.
      detailNode.innerHTML = renderKpiPassportsDetail(passport,
        catalog.get(kpiPassportsPageUiState.selectedId),snapshot);
    }
    function fillSnapshotInner() {
      if (!routeIsCurrent()) return;
      try {
        if (!service?.buildSnapshot) throw new Error('Расчётный сервис не подключён');
        const cached=service.getCachedSnapshot?.(requestedFilters);
        if (cached) {paintSnapshot(cached);return;}
        globalThis.ReclassifierHeaderIndicators?.setKpi?.('calculating',0);
        // Native Worker: never invoke cold synchronous Calculator on the UI
        // thread. The legacy synchronous path remains only for unavailable
        // Worker/bare test harnesses.
        if (typeof Worker === 'function' && typeof service.buildSnapshotAsync === 'function') {
          const controller=new AbortController();
          passportCalculationController=controller;
          service.buildSnapshotAsync(requestedFilters,{
            stage:'full',priority:2,signal:controller.signal
          }).then(result=>{
            if (!controller.signal.aborted) paintSnapshot(result);
          }).catch(error=>{
            if (!controller.signal.aborted) paintSnapshot(null,error);
          }).finally(()=>{
            if (passportCalculationController===controller) passportCalculationController=null;
          });
          return;
        }
        paintSnapshot(service.buildSnapshot(requestedFilters));
      } catch (error) {
        paintSnapshot(null,error);
      }
    }

    function fillSnapshot() {
      const profiler=globalThis.ReclassifierPerformanceProfiler;
      const run=()=>fillSnapshotInner();
      return profiler ? profiler.measure('passport.snapshot.fill',run) : run();
    }

    function updateSelectionAndList() {
      const filtered = kpiPassportsFilteredEntries(catalog);
      if (!filtered.some(entry=>entry.id===kpiPassportsPageUiState.selectedId)) {
        kpiPassportsPageUiState.selectedId = filtered[0]?.id || null;
      }
      listNode.innerHTML = renderKpiPassportsCatalogList(catalog,filtered,kpiPassportsPageUiState.selectedId);
      detailNode.innerHTML = renderKpiPassportsDetail(passport,
        catalog.get(kpiPassportsPageUiState.selectedId), snapshot);
    }

    listNode.addEventListener('click', event => {
      const button = event.target?.closest?.('[data-kpi-passport-select]');
      if (!button || !listNode.contains(button)) return;
      const id = button.dataset.kpiPassportSelect;
      const filtered = kpiPassportsFilteredEntries(catalog);
      if (!filtered.some(entry=>entry.id===id)) return;
      kpiPassportsPageUiState.selectedId = id;
      kpiPassportsPageUiState.activeTab = 'overview';
      updateSelectionAndList();
      // The selected button was replaced during the list redraw: restore keyboard focus.
      const nextButton = Array.from(listNode.querySelectorAll?.('[data-kpi-passport-select]') || [])
        .find(node => node.dataset.kpiPassportSelect === id);
      if (nextButton && typeof nextButton.focus === 'function') {
        try { nextButton.focus({ preventScroll: true }); } catch (_) { nextButton.focus(); }
      }
    });
    reportButton.addEventListener('click', () => navigate('reliability_dashboard'));
    // A post-paint timer prevents the synchronous Calculator from delaying the
    // initial catalog display. On return visits it usually reuses cached data.
    const scheduleCalculation = () => {
      if (typeof setTimeout === 'function') setTimeout(fillSnapshot, 0);
      else fillSnapshot();
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(scheduleCalculation);
    } else {
      scheduleCalculation();
    }
  } catch (error) {
    setHeader('Методология показателей','Паспорта KPI','Не удалось открыть каталог.');
    el.pageContent.innerHTML = `<div class="notice" role="alert">Ошибка каталога паспортов: ${escapeHtml(error?.message || String(error))}</div>`;
  }
}
