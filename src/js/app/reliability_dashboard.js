// FILE CONTRACT: Reliability Report Snapshot renderer.
// Purpose: render one immutable Report Snapshot and expose report filters/PDF entrypoint.
// Owns: report-page structure, KPI cards/passports, chart presentation and transient UI state.
// Reads: ReclassifierReliabilityReportService + presentation template.
// Writes: page header and page content.
// Must not: calculate KPI values, scale demo numbers, read SQLite directly or duplicate Dataset business rules.

  function formatReliabilityReportDate(value) {
    const raw = String(value || '');
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    if (!match) return raw || '—';
    return `${match[3]}.${match[2]}.${match[1]}`;
  }

  function formatReliabilityNumber(value) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value);
  }

  // Preserve visible distinction between a genuine 100% KTG and a number
  // just below 100%. The ordinary one-decimal card rounding can hide downtime.
  function formatReliabilityKtgValue(value) {
    if (typeof value !== 'number' || !Number.isFinite(value))
      return formatReliabilityNumber(value);
    if (value > 0 && value < 100) {
      for (let digits = 2; digits <= 8; digits++) {
        if (Number(value.toFixed(digits)) < 100) {
          return new Intl.NumberFormat('ru-RU', {
            minimumFractionDigits: 2, maximumFractionDigits: digits
          }).format(value);
        }
      }
      return '<100';
    }
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
  }

  function formatReliabilityMetric(value, unit = '') {
    const formatted = formatReliabilityNumber(value);
    if (formatted === '—' || !unit) return formatted;
    return `${formatted} ${unit}`;
  }


  // The delta sign is numeric; positive values are not automatically "good".
  function formatReliabilitySignedMetric(value, unit = '') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    const sign = value > 0 ? '+' : value < 0 ? '−' : '';
    return sign + formatReliabilityMetric(Math.abs(value), unit);
  }

  function reliabilityForecastPresentation(forecast, unit = '') {
    const valueReady = forecast?.dataState === 'available' &&
      Number.isFinite(forecast.value) &&
      typeof forecast.horizon === 'string' && Boolean(forecast.horizon.trim()) &&
      typeof forecast.methodId === 'string' && Boolean(forecast.methodId.trim());

    if (valueReady) {
      const changeUnit = unit === '%' ? 'п.п.' : unit;
      const delta = Number.isFinite(forecast.change)
        ? formatReliabilitySignedMetric(forecast.change, changeUnit)
        : null;
      const reportingEstimate=['reporting-month-nowcast',
        'reporting-month-volume-nowcast'].includes(forecast.forecastType);
      return {
        value: formatReliabilityMetric(forecast.value, unit),
        detail: reportingEstimate
          ? (forecast.forecastType==='reporting-month-volume-nowcast'
            ? 'Факт '+formatReliabilityMetric(forecast.observedValue,unit)+
              ' · прогноз итога '+forecast.horizon
            : 'Итог '+forecast.horizon+' · прогноз, не факт')
          : delta ? delta + ' к текущему' : 'Горизонт: ' + forecast.horizon,
        horizon: forecast.horizon,
        tooltip: reportingEstimate
          ? 'Прогноз до конца '+forecast.horizon+
            '; данные по '+(forecast.coverageThrough||'неизвестную дату')+
            '; метод '+forecast.methodId+' (версия '+(forecast.methodVersion||'—')+').'
          : 'Горизонт прогноза: '+forecast.horizon,
        ready: true
      };
    }

    const reason = forecast?.reason || '';
    const message = reason === 'report-month-complete' ? 'Месяц закрыт, прогноз не требуется' : reason === 'kpi-not-implemented'
      ? 'KPI не подключён'
      : ['reporting-cutoff-unconfirmed','reporting-cutoff-not-certified',
          'invalid-reporting-coverage-range'].includes(reason)
        ? 'Не подтверждена полнота выгрузки'
        : reason === 'forecast-method-not-defined' || forecast?.dataState === 'not-calculated'
          ? 'Методика не задана'
        : forecast?.dataState === 'insufficient'
          ? 'Нет пригодной истории или покрытия'
          : forecast?.dataState === 'available'
            ? 'Нет горизонта или метода'
            : 'Прогноз недоступен';
    return { value: '—', detail: message, horizon: null, tooltip: message, ready: false };
  }

  function reliabilityStatusMeta(status) {
    const statuses = {
      good: { label: 'В норме', className: 'good' },
      warning: { label: 'Требует внимания', className: 'warning' },
      neutral: { label: 'Без оценки', className: 'neutral' }
    };
    return statuses[status] || statuses.neutral;
  }

  function reliabilityDataStateMeta(state) {
    const states = {
      available: { label: 'Данные доступны', className: 'available', blocksValue: false },
      'no-data': { label: 'Нет данных', className: 'no-data', blocksValue: true },
      unavailable: { label: 'Расчёт недоступен', className: 'insufficient', blocksValue: true },
      insufficient: { label: 'Недостаточно данных', className: 'insufficient', blocksValue: true },
      'not-applicable': { label: 'Не рассчитывается', className: 'not-applicable', blocksValue: true },
      error: { label: 'Ошибка расчёта', className: 'error', blocksValue: true }
    };
    return states[state] || states.insufficient;
  }

  const reliabilityDashboardUiState = {
    focusedFilterId: null,
    pdfStatusMessage: ''
  };

  const reliabilityDashboardFilterState = {
    period: 'latest',
    mine: 'all',
    equipmentClass: 'all'
  };

  function reliabilityQueryLabel(snapshot) {
    const period = snapshot?.query?.period?.label || 'Период не определён';
    const mine = snapshot?.query?.mine?.label || 'Все рудники';
    const equipment = snapshot?.query?.equipmentClass?.label || 'Всё оборудование';
    return `${period} · ${mine} · ${equipment}`;
  }

  function reliabilitySourceLabel(snapshot) {
    const source = Array.from(snapshot?.sources || [])
      .map(item => {
        if (!item.available) return `${item.id}: нет`;
        const revision = item.activeRevision ? ` r${item.activeRevision}` : '';
        const freshness = item.freshness ? ` · ${formatReliabilityReportDate(item.freshness)}` : '';
        return `${item.id}${revision}${freshness}`;
      })
      .join('; ');
    return source || 'Источники не подключены';
  }

  function reliabilityCardFromTemplate(template, snapshot) {
    const result = snapshot?.results?.[template.id] || null;
    const cardView = snapshot?.kpiView?.cards?.[template.id] || null;
    // The Report View owns comparisons and forecasts; older Snapshots get no invented data.
    const state = cardView?.current?.dataState || result?.dataState || 'not-applicable';
    const value = cardView?.current
      ? cardView.current.value
      : (result?.dataState === 'available' ? result.value : null);
    const availablePrevious = cardView?.previous?.dataState === 'available' &&
      Number.isFinite(cardView.previous.value);

    return {
      ...template,
      title: template.title || result?.title || '',
      value,
      unit: result?.unit || template.unit || '',
      previousValue: availablePrevious ? cardView.previous.value : null,
      change: Number.isFinite(cardView?.change) ? cardView.change : null,
      changeUnit: cardView?.changeUnit || (result?.unit === '%' ? 'п.п.' : result?.unit || template.unit || ''),
      forecast: cardView?.forecast || null,
      target: cardView?.target ?? null,
      targetUnit: result?.unit || template.unit || '',
      status: cardView?.status || 'neutral',
      dataStatus: result ? 'calculated' : 'not-connected',
      dataState: state,
      reason: cardView?.current?.reason || result?.reason || (result ? null : 'not-implemented')
    };
  }

  function renderReliabilityKpiCard(item) {
    const status = reliabilityStatusMeta(item.status);
    const dataState = reliabilityDataStateMeta(item.dataState);
    const blocked = dataState.blocksValue;
    const displayValue = blocked ? '—' : (item.id === 'ktg' ? formatReliabilityKtgValue(item.value) : formatReliabilityNumber(item.value));
    const sourceLabel = item.dataStatus === 'calculated' ? 'KPI · рассчитан' : 'KPI · не подключён';
    const previousDisplay = Number.isFinite(item.previousValue)
      ? formatReliabilityMetric(item.previousValue, item.unit || '')
      : '—';
    const changeDisplay = formatReliabilitySignedMetric(item.change, item.changeUnit || '');
    const forecast = reliabilityForecastPresentation(item.forecast, item.unit || '');
    const coverageNote = item.id === 'classification_quality_cgps' && blocked
      ? item.reason === 'mb-coverage-unknown'
        ? 'Dataset Мобильных бригад отсутствует или недоступен; проверить номера заявок невозможно.'
        : item.reason === 'source-missing'
          ? 'Для расчёта нужны актуальные ITSM Сириус и Мобильные бригады.'
          : item.reason === 'classification-denominator-zero'
            ? 'Нет обращений ЦГПС, соответствующих условиям расчёта за выбранный период.'
            : ''
      : '';

    return `
      <article class="reliability-kpi-card status-${escapeHtml(status.className)} data-${escapeHtml(dataState.className)}" data-kpi-id="${escapeHtml(item.id)}">
        <div class="reliability-kpi-card-head">
          <div>
            <div class="reliability-kpi-card-label">${escapeHtml(sourceLabel)}</div>
            <h3>${escapeHtml(item.title)}</h3>
            ${blocked ? `<span class="reliability-kpi-data-state ${escapeHtml(dataState.className)}">${escapeHtml(dataState.label)}</span>` : ''}
          </div>
          <span class="reliability-kpi-status ${escapeHtml(status.className)}">${escapeHtml(status.label)}</span>
        </div>

        <div class="reliability-kpi-value-row">
          <strong class="reliability-kpi-value">${escapeHtml(displayValue)}</strong>
          <span class="reliability-kpi-unit">${escapeHtml(item.unit || '')}</span>
        </div>

        ${coverageNote ? `<p class="reliability-kpi-coverage-note">${escapeHtml(coverageNote)}</p>` : ''}

        <div class="reliability-kpi-meta" aria-label="Сравнение и прогноз KPI">
          <div class="reliability-kpi-meta-previous">
            <span>Предыдущее</span>
            <strong>${escapeHtml(previousDisplay)}</strong>
          </div>
          <div class="reliability-kpi-meta-change">
            <span>Изменение</span>
            <strong>${escapeHtml(changeDisplay)}</strong>
          </div>
          <div class="reliability-kpi-meta-forecast">
            <span>Прогноз</span>
            <strong>${escapeHtml(forecast.value)}</strong>
            <small class="reliability-kpi-forecast-note" title="${escapeHtml(forecast.tooltip||forecast.detail)}">${escapeHtml(forecast.detail)}</small>
          </div>
        </div>

        <div class="reliability-kpi-actions">
          <button type="button" class="reliability-kpi-chart-button"
            id="reliabilityKpiChartOpen_${escapeHtml(item.id)}"
            data-kpi-chart-open="${escapeHtml(item.id)}"
            aria-haspopup="dialog" aria-controls="reliabilityKpiChartDialog">
            График <span aria-hidden="true">↗</span>
          </button>
          <button type="button" class="reliability-kpi-passport-button"
            id="reliabilityKpiPassportOpen_${escapeHtml(item.id)}"
            data-kpi-passport-open="${escapeHtml(item.id)}"
            aria-haspopup="dialog" aria-controls="reliabilityKpiPassportDialog">
            Паспорт KPI <span aria-hidden="true">↗</span>
          </button>
        </div>
      </article>
    `;
  }

  function renderReliabilityKpiCards(items) {
    return items.map(renderReliabilityKpiCard).join('');
  }

  function reliabilityDashboardKpis(dashboard) {
    return [
      ...dashboard.kpiGroups.dataQuality,
      ...dashboard.kpiGroups.technicalReliability,
      ...dashboard.kpiGroups.organizationalReadiness,
      ...dashboard.labor.summaryKpis,
      ...dashboard.problemManagement.summaryKpis
    ];
  }

  function bindReliabilityPassportDialog(dashboard) {
    const dialog = document.getElementById('reliabilityKpiPassportDialog');
    const body = document.getElementById('reliabilityKpiPassportBody');
    const close = document.getElementById('reliabilityKpiPassportClose');
    const view = globalThis.ReclassifierKpiPassportView;
    if (!dialog || !body || !close || !view?.renderContent) {
      throw new Error('KPI passport dialog or catalog renderer unavailable.');
    }

    // Shared tab delegation: the catalog page uses exactly the same behavior.
    let activePassportId=null;
    view.bindTabs?.(body,null,kpiId=>{
      if(kpiId!==activePassportId)return;
      body.innerHTML=view.renderContent(kpiId,{
        snapshot:dashboard.snapshot,activeTab:'monitor'
      });
    });
    let opener = null;
    reliabilityDashboardKpis(dashboard).forEach(item => {
      const button = document.getElementById('reliabilityKpiPassportOpen_' + item.id);
      if (!button) return;
      button.addEventListener('click', () => {
        opener = button;
        activePassportId=item.id;
        body.innerHTML = view.renderContent(item.id, { snapshot: dashboard.snapshot });
        dialog.scrollTop = 0;
        // showModal owns focus trapping and Esc handling; no popup window.
        if (typeof dialog.showModal !== 'function') {
          body.textContent = 'Ваш браузер не поддерживает модальные окна HTML dialog.';
          return;
        }
        dialog.showModal();
        close.focus();
      });
    });
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {
      // Native dialog backdrop click (not a click on passport content).
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => {
      if (opener && opener.isConnected !== false && typeof opener.focus === 'function') {
        try { opener.focus({ preventScroll: true }); } catch (_) { opener.focus(); }
      }
      opener = null;
    });
  }

  function restoreReliabilityDashboardFocus() {
    const id = reliabilityDashboardUiState.focusedFilterId;
    reliabilityDashboardUiState.focusedFilterId = null;
    if (!id) return;
    const node = document.getElementById(id);
    if (node && typeof node.focus === 'function') {
      try { node.focus({ preventScroll: true }); } catch (_) { node.focus(); }
    }
  }

  function reliabilitySnapshotStatus(snapshot) {
    if (snapshot.status === 'ready') {
      return {
        label: 'Расчёт по Dataset',
        disclaimer: 'Карточки с пометкой Report Snapshot рассчитаны по текущим Dataset. Методики формул пока имеют статус draft.'
      };
    }
    if (snapshot.status === 'empty') {
      return {
        label: 'Нет источников',
        disclaimer: 'Для расчёта отчёта не подключены событийные Dataset. Неподключённые показатели не подменяются demo-значениями.'
      };
    }
    return {
      label: 'Частичный расчёт',
      disclaimer: 'Часть источников отсутствует или имеет предупреждения. Каждый KPI сохраняет собственный dataState и причину.'
    };
  }

  function reliabilityAvailableSeries(monthly, field) {
    // Keep gaps in the selected month axis; a missing month is never silently
    // removed and never connected to the next available month.
    const projection = globalThis.ReclassifierReliabilityPresentation;
    if (projection?.monthly) return projection.monthly({series:{monthly}},field);
    // Isolated legacy harnesses load only the page renderer, without the
    // presentation fragment. Keep null gaps in this compatibility branch too.
    return Array.from(monthly || [],row => ({
      period: row?.period || null, label: row?.label || row?.period || '—',
      value: row?.[field]?.dataState === 'available' &&
        Number.isFinite(row[field].value) ? row[field].value : null
    }));
  }

  function renderReliabilityEvidence(snapshot) {
    const projection = globalThis.ReclassifierReliabilityPresentation;
    const evidence = projection?.summary
      ? projection.summary(snapshot)
      : (() => {
          const results = Object.values(snapshot?.results || {});
          const sources = Array.from(snapshot?.sources || []);
          return {
            kpiAvailable: results.filter(r => r?.dataState === 'available' &&
              Number.isFinite(r.value)).length,
            kpiTotal: results.length,
            sourceAvailable: sources.filter(r => r?.available === true).length,
            sourceTotal: sources.length,
            monthCount: snapshot?.series?.monthly?.length || 0
          };
        })();
    const months = Number(evidence.monthCount || 0);
    const isPrimary = snapshot?.diagnostics?.stage === 'primary';
    return `<div class="reliability-evidence-line" id="reliabilityReportStageStatus"
      role="status" aria-live="polite">
      Рассчитано KPI: <strong>${Number(evidence.kpiAvailable || 0)} из ${Number(evidence.kpiTotal || 0)}</strong>
      <span aria-hidden="true">·</span>
      Доступно источников: <strong>${Number(evidence.sourceAvailable || 0)} из ${Number(evidence.sourceTotal || 0)}</strong>
      <span aria-hidden="true">·</span>
      Наполнение: <strong>${months} месяцев</strong>${isPrimary ? ' · Месячная история рассчитывается' : ''}
    </div>`;
  }

  function buildReliabilityDashboardView(template, snapshot) {
    const status = reliabilitySnapshotStatus(snapshot);
    const slaSeries = reliabilityAvailableSeries(snapshot.series?.monthly || [], 'sla');
    const vbrSeries = reliabilityAvailableSeries(snapshot.series?.monthly || [], 'vbr');
    // Use the same monthly Report Snapshot for both quality indicators;
    // nulls are retained so absent/unknown months are never joined as a line.
    const qualitySeries = Array.from(snapshot.series?.monthly || []).map(row => ({
      period: row.period,
      label: row.label,
      overall: row.classification_quality?.dataState === 'available' &&
        Number.isFinite(row.classification_quality.value)
        ? row.classification_quality.value : null,
      cgps: row.classification_quality_cgps?.dataState === 'available' &&
        Number.isFinite(row.classification_quality_cgps.value)
        ? row.classification_quality_cgps.value : null,
      cgpsReason: row.classification_quality_cgps?.reason || null
    }));

    const card = item => reliabilityCardFromTemplate(item, snapshot);
    const cat=globalThis.ReclassifierKpiCatalog;
    const groupCards=(category,templates)=>{
      const known=new Set(templates.map(item=>item.id));
      const added=(cat?.list({category})||[])
        .filter(entry=>entry.visibleInReport&&!known.has(entry.id))
        .map(entry=>({id:entry.id,title:entry.definition.title,unit:entry.definition.unit}));
      return [...templates,...added].map(card);
    };
    const totalLabor = snapshot.results?.total_labor;
    const reactive = snapshot.results?.reactive_share;

    return {
      schemaVersion: template.schemaVersion,
      mode: template.mode,
      snapshot,
      provenance: {
        status: snapshot.status,
        label: status.label,
        disclaimer: status.disclaimer
      },
      report: {
        title: template.report.title,
        period: snapshot.query.period,
        lastUpdated: snapshot.calculatedAt,
        scope: {
          mine: snapshot.query.mine,
          equipmentType: snapshot.query.equipmentClass
        }
      },
      filters: {
        disclaimer: template.filters.disclaimer,
        periods: snapshot.filters.periods,
        mines: snapshot.filters.mines,
        equipmentTypes: snapshot.filters.equipmentClasses
      },
      activeFilters: {
        period: snapshot.query.period,
        mine: snapshot.query.mine,
        equipmentType: snapshot.query.equipmentClass
      },
      kpiGroups: {
        dataQuality: groupCards('dataQuality',template.kpiGroups.dataQuality),
        technicalReliability: groupCards('technicalReliability',template.kpiGroups.technicalReliability),
        organizationalReadiness: groupCards('organizationalReadiness',template.kpiGroups.organizationalReadiness)
      },
      monthlyDynamics: {
        sla: slaSeries,
        vbr: vbrSeries,
        classification: qualitySeries
      },
      labor: {
        summaryKpis: groupCards('labor',template.labor.summaryKpis),
        totalHours: totalLabor?.dataState === 'available' ? totalLabor.value : null,
        displayHoursUnit: totalLabor?.unit || 'чел.-ч',
        structure: Array.from(snapshot.breakdowns?.labor || []),
        reactiveShare: {
          value: reactive?.dataState === 'available' ? reactive.value : null,
          unit: reactive?.unit || '%'
        }
      },
      problemManagement: {
        summaryKpis: groupCards('problemManagement',template.problemManagement.summaryKpis),
        portfolio: Array.from(snapshot.breakdowns?.problemManagement || []),
        charts: Array.from(snapshot.breakdowns?.problemCharts || []),
        displayHoursUnit: snapshot.results?.problem_coverage_absolute?.unit || 'чел.-ч'
      }
    };
  }

  function renderReliabilityFilterOptions(options, selectedId) {
    return Array.from(options || []).map(option => `
      <option value="${escapeHtml(option.id)}"${option.id === selectedId ? ' selected' : ''}>${escapeHtml(option.label)}</option>
    `).join('');
  }

  // PR12: one toolbar owns the visible filter controls. The selected values
  // still come from the single Report Snapshot query, not a second UI store.
  function renderReliabilityFilters(dashboard) {
    const active = dashboard.activeFilters;
    return `
      <div class="reliability-filters" role="group" aria-label="Фильтры отчёта">
        <label><span>Период</span>
          <select id="reliabilityPeriodFilter">
            ${renderReliabilityFilterOptions(dashboard.filters.periods, active.period?.id)}
          </select>
        </label>
        <label><span>Рудник</span>
          <select id="reliabilityMineFilter">
            ${renderReliabilityFilterOptions(dashboard.filters.mines, active.mine?.id)}
          </select>
        </label>
        <label><span>Класс оборудования</span>
          <select id="reliabilityEquipmentFilter">
            ${renderReliabilityFilterOptions(dashboard.filters.equipmentTypes, active.equipmentType?.id)}
          </select>
        </label>
        <button class="button ghost reliability-filter-reset" id="reliabilityFilterReset" type="button">Сбросить</button>
      </div>
    `;
  }

  function reliabilityPdfExportMessage(result, dashboard) {
    return [
      'PDF скачан: ' + result.filename + '.',
      String(result.pageCount) + ' стр.',
      reliabilityQueryLabel(dashboard.snapshot) + '.'
    ].join(' ');
  }

  function bindReliabilityPdfExport(dashboard) {
    const button = document.getElementById('reliabilityPdfExportButton');
    const status = document.getElementById('reliabilityPdfExportStatus');
    if (!button) return;

    button.addEventListener('click', async () => {
      const renderer = globalThis.ReclassifierReliabilityPdfRenderer;
      if (!renderer?.download) {
        reliabilityDashboardUiState.pdfStatusMessage = 'PDF renderer недоступен.';
        if (status) {
          status.textContent = reliabilityDashboardUiState.pdfStatusMessage;
          status.hidden = false;
        }
        return;
      }

      button.disabled = true;
      reliabilityDashboardUiState.pdfStatusMessage = 'Формирование PDF…';
      if (status) {
        status.textContent = reliabilityDashboardUiState.pdfStatusMessage;
        status.hidden = false;
      }

      // The immutable Snapshot is captured on click; later filter changes must
      // not overwrite the new report's status with a previous PDF export.
      const selected = JSON.stringify(reliabilityDashboardFilterState);
      const stillCurrent = () => state.route === 'reliability_dashboard' &&
        JSON.stringify(reliabilityDashboardFilterState) === selected;
      try {
        const result = await renderer.download(dashboard.snapshot, {
          onProgress: update => {
            if (!stillCurrent() || !Number.isFinite(update?.percent)) return;
            reliabilityDashboardUiState.pdfStatusMessage =
              'Формирование PDF… ' +
              Math.round(update.percent) + '%';
            if (status && status.isConnected !== false) {
              status.textContent = reliabilityDashboardUiState.pdfStatusMessage;
              status.hidden = false;
            }
          }
        });
        if (stillCurrent()) {
          reliabilityDashboardUiState.pdfStatusMessage = reliabilityPdfExportMessage(result, dashboard);
        }
      } catch (error) {
        if (stillCurrent()) {
          reliabilityDashboardUiState.pdfStatusMessage =
            'Не удалось сформировать PDF: ' + (error?.message || String(error));
        }
      } finally {
        button.disabled = false;
        if (stillCurrent() && status && status.isConnected !== false) {
          status.textContent = reliabilityDashboardUiState.pdfStatusMessage;
          status.hidden = false;
        }
      }
    });
  }

  function bindReliabilityDashboardFilters() {
    const bindings = [
      ['reliabilityPeriodFilter', 'period'],
      ['reliabilityMineFilter', 'mine'],
      ['reliabilityEquipmentFilter', 'equipmentClass']
    ];

    bindings.forEach(([id, stateKey]) => {
      const node = document.getElementById(id);
      if (!node) return;
      node.value = reliabilityDashboardFilterState[stateKey];
      node.addEventListener('change', () => {
        reliabilityDashboardFilterState[stateKey] = node.value;
        reliabilityDashboardUiState.focusedFilterId = id;
        reliabilityDashboardUiState.pdfStatusMessage = '';
        renderReliabilityDashboard();
      });
    });

    const passports = document.getElementById('reliabilityOpenKpiPassportsButton');
    passports?.addEventListener('click', () => navigate('kpi_passports'));

    const refresh = document.getElementById('reliabilityRefreshKpiButton');
    refresh?.addEventListener('click', () => {
      reliabilityDashboardUiState.pdfStatusMessage = '';
      renderReliabilityDashboard({forceRefresh:true});
    });

    const reset = document.getElementById('reliabilityFilterReset');
    if (reset) {
      reset.addEventListener('click', () => {
        reliabilityDashboardFilterState.period = 'latest';
        reliabilityDashboardFilterState.mine = 'all';
        reliabilityDashboardFilterState.equipmentClass = 'all';
        reliabilityDashboardUiState.focusedFilterId = 'reliabilityFilterReset';
        reliabilityDashboardUiState.pdfStatusMessage = '';
        renderReliabilityDashboard();
      });
    }
  }

  function reliabilityLineChartTicks(minValue, maxValue, count = 5) {
    const ticks = [];
    for (let index = 0; index < count; index += 1) {
      const ratio = index / (count - 1);
      ticks.push(maxValue - ((maxValue - minValue) * ratio));
    }
    return ticks;
  }

  function reliabilityLineChartPoints(values, minValue, maxValue, geometry) {
    const { left, top, width, height } = geometry;
    const span = Math.max(1, maxValue - minValue);
    const divisor = Math.max(1, values.length - 1);
    return values.map((value, index) => {
      const x = left + (width * index / divisor);
      const y = Number.isFinite(value)
        ? top + height - ((value - minValue) / span * height)
        : null;
      return { x, y, value: Number.isFinite(value) ? value : null };
    });
  }

  function reliabilityLinePath(points) {
    let connected = false;
    return points.map(point => {
      if (!Number.isFinite(point?.value) || !Number.isFinite(point?.y)) {
        connected = false;
        return '';
      }
      const command = connected ? 'L' : 'M';
      connected = true;
      return command + ' ' + point.x.toFixed(1) + ' ' + point.y.toFixed(1);
    }).filter(Boolean).join(' ');
  }

  function renderReliabilityLineChart({ id, title, description, points, minValue, maxValue, forecast = null, showValues = false }) {
    if (!Array.isArray(points) || points.length < 2 ||
        points.filter(point => Number.isFinite(point?.value)).length < 2) {
      return `<p class="reliability-section-note">${escapeHtml(description)} Достоверных месячных значений для линии недостаточно.</p>`;
    }

    const months = points.map(point => ({ label: point.label }));
    const values = points.map(point => point.value);
    // A fixed minimum of 66px per SLA month prevents adjacent value labels
    // from overlapping; the chart scrolls horizontally instead of hiding months.
    const geometry = showValues
      ? { left: 48, top: 28, width: Math.max(692, 66 * (points.length - 1)), height: 130 }
      : { left: 48, top: 18, width: 692, height: 196 };
    const viewWidth = showValues ? geometry.left + geometry.width + 20 : 760;
    const viewHeight = showValues ? 197 : 258;
    const ticks = reliabilityLineChartTicks(minValue, maxValue, 5);
    const chartPoints = reliabilityLineChartPoints(values, minValue, maxValue, geometry);
    const availableCount = values.filter(Number.isFinite).length;
    const gapCount = values.length - availableCount;

    const grid = ticks.map(value => {
      const y = geometry.top + geometry.height - ((value - minValue) / (maxValue - minValue) * geometry.height);
      return `
        <line class="reliability-chart-grid-line" x1="${geometry.left}" y1="${y.toFixed(1)}" x2="${geometry.left + geometry.width}" y2="${y.toFixed(1)}"></line>
        <text class="reliability-chart-axis-label" x="${geometry.left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end">${escapeHtml(formatReliabilityNumber(value))}</text>
      `;
    }).join('');

    const labelEvery = Math.max(1, Math.ceil(months.length / 7));
    const monthLabels = months.map((month, index) => {
      if (!showValues && index % labelEvery !== 0 && index !== months.length - 1) return '';
      const divisor = Math.max(1, months.length - 1);
      const x = geometry.left + (geometry.width * index / divisor);
      return `<text class="reliability-chart-axis-label" x="${x.toFixed(1)}" y="${viewHeight - 12}" text-anchor="middle">${escapeHtml(month.label)}</text>`;
    }).join('');

    const lastObserved=points.at(-1);
    const lastPosition=chartPoints.at(-1);
    const reportGhost=forecast?.forecastType==='reporting-month-nowcast' &&
      forecast.dataState==='available' && Number.isFinite(forecast.value) &&
      forecast.horizon===lastObserved?.period &&
      Number.isFinite(lastObserved?.value) &&
      lastObserved.value===forecast.observedValue &&
      Number.isFinite(lastPosition?.x) && Number.isFinite(lastPosition?.y);
    const previousPosition=chartPoints.at(-2);
    const previousAdjacent = Number.isFinite(previousPosition?.value) && 
      Number.isFinite(previousPosition?.y);
    const ghostSvg=reportGhost ? (()=>{
      const predictedY=geometry.top+geometry.height-
        ((forecast.value-minValue)/(maxValue-minValue))*geometry.height;
      const info='Прогноз итога отчётного месяца '+forecast.horizon+': '+
        formatReliabilityMetric(forecast.value,'%')+
        '. Факт по '+forecast.coverageThrough+': '+
        formatReliabilityMetric(lastObserved.value,'%')+
        '. Метод '+forecast.methodId+', версия '+forecast.methodVersion+
        '; фиксированная численность Drivers; прогноз не является фактом.';
      const from=previousAdjacent?previousPosition:lastPosition;
      const labelY=predictedY<geometry.top+20?predictedY+18:predictedY-10;
      return '<g class="reliability-chart-forecast-ghost" role="img" aria-label="'+
        escapeHtml(info)+'"><path d="M'+from.x.toFixed(1)+' '+from.y.toFixed(1)+
        ' L'+lastPosition.x.toFixed(1)+' '+predictedY.toFixed(1)+
        '" fill="none" stroke="#207c5e" stroke-width="2.3" opacity=".7" stroke-dasharray="5 4"/>'+
        '<circle cx="'+lastPosition.x.toFixed(1)+'" cy="'+predictedY.toFixed(1)+
        '" r="6" fill="white" fill-opacity=".8" stroke="#207c5e" opacity=".72"'+
        ' stroke-width="2.5"><title>'+escapeHtml(info)+'</title></circle>'+
        '<text x="'+(lastPosition.x-8).toFixed(1)+'" y="'+labelY.toFixed(1)+
        '" text-anchor="end" fill="#207c5e" opacity=".68" font-size="12">'+
        escapeHtml(formatReliabilityMetric(forecast.value,'%'))+'</text></g>';
    })() : '';

    // For percentage KPI the incomplete-month fact is audit-only, not the
    // primary chart value; the last visible marker is the projected result.
    const valueLabels = showValues ? chartPoints.map(point => {
      if (!Number.isFinite(point.value)) return '';
      const label = formatReliabilityNumber(point.value) + '%';
      // Clamp to the chart viewport. Even 100% and 0% remain legible.
      const y = Math.min(viewHeight - 32, Math.max(13, point.y - 11));
      return '<text class="reliability-chart-value-label" x="' +
        point.x.toFixed(1) + '" y="' + y.toFixed(1) +
        '" text-anchor="middle">' + escapeHtml(label) + '</text>';
    }).join('') : '';

    const markers = chartPoints.map((point, index) =>
      !Number.isFinite(point.value) || (reportGhost && index===chartPoints.length-1)?'':`
      <circle class="reliability-chart-point series-1" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3.4">
        <title>${escapeHtml(months[index]?.label || '')}: ${escapeHtml(formatReliabilityNumber(point.value))}%</title>
      </circle>
    `).join('');

    return `
      <figure class="reliability-chart reliability-line-chart${showValues ? ' reliability-sla-compact' : ''}" data-chart-id="${escapeHtml(id)}">
        <figcaption class="reliability-chart-head">
          <div>
            <div class="reliability-chart-label">График</div>
            <strong>${escapeHtml(title)}</strong>
            <p>${escapeHtml(description)}</p>
          </div>
        </figcaption>
        <div class="reliability-chart-svg-wrap">
          <svg viewBox="0 0 ${viewWidth} ${viewHeight}" ${showValues ? `style="min-width:${viewWidth}px"` : ''} role="img" aria-label="${escapeHtml(title)}">
            <line class="reliability-chart-axis" x1="${geometry.left}" y1="${geometry.top}" x2="${geometry.left}" y2="${geometry.top + geometry.height}"></line>
            <line class="reliability-chart-axis" x1="${geometry.left}" y1="${geometry.top + geometry.height}" x2="${geometry.left + geometry.width}" y2="${geometry.top + geometry.height}"></line>
            ${grid}
            ${monthLabels}
            <path class="reliability-chart-line series-1" d="${reliabilityLinePath(reportGhost?chartPoints.slice(0,-1):chartPoints)}"></path>
            ${markers}
            ${valueLabels}
            ${ghostSvg}
          </svg>
        </div>
        <p class="reliability-chart-coverage">Фактические значения: ${availableCount} из ${points.length} мес.${gapCount ? ' · Пропуски: ' + gapCount + ' (без соединения линией)' : ''}.</p>
        ${reportGhost
          ? '<figcaption class="reliability-chart-forecast-note">Пунктирный последний участок и приглушённое значение — прогноз итога отчётного месяца вместо промежуточного процента '+escapeHtml(forecast.horizon)+', данные по '+escapeHtml(forecast.coverageThrough)+'. Фактический ВБР сохранён в данных и подсказке прогнозной точки. Численность оборудования из текущего справочника Drivers.</figcaption>'
          : ''}
      </figure>
    `;
  }

  // Comparison uses real KPI monthly results; gaps remain gaps, not zeroes
  // or interpolated values. The detailed chart button opens each KPI separately.
  function renderReliabilityQualityComparisonChart(months = []) {
    if (!Array.isArray(months) || months.length < 2 ||
        !months.some(month => Number.isFinite(month.overall) ||
          Number.isFinite(month.cgps))) {
      return '<p class="reliability-section-note">Для сравнения качества классификации недостаточно месячных данных. Отсутствующие показатели не приравниваются к нулю.</p>';
    }
    const geo = {left:48, top:18, width:692, height:196};
    const width = 760, height = 258;
    const axis = [0,25,50,75,100].map(value => {
      const y = geo.top + geo.height * (1-value/100);
      return '<line class="reliability-chart-grid-line" x1="'+geo.left+
        '" x2="'+(geo.left+geo.width)+'" y1="'+y+'" y2="'+y+'"></line>'+
        '<text class="reliability-chart-axis-label" x="'+(geo.left-8)+
        '" y="'+(y+4)+'" text-anchor="end">'+value+'</text>';
    }).join('');
    const x = i => geo.left+geo.width*i/Math.max(1,months.length-1);
    const y = value => geo.top+geo.height*(1-value/100);
    const monthLabels = months.map((month,i) => {
      // Limit labels for dense histories; data points retain all months.
      if (months.length>15 && i%Math.ceil(months.length/12)!==0 && i!==months.length-1) return '';
      return '<text class="reliability-chart-axis-label" x="'+x(i).toFixed(1)+
        '" y="'+(height-12)+'" text-anchor="middle">'+escapeHtml(month.label||month.period)+'</text>';
    }).join('');
    function series(field,className,title) {
      let path = '', connected = false, count = 0;
      const markers = [];
      months.forEach((month,i) => {
        const value = month[field];
        if (!Number.isFinite(value) || value<0 || value>100) {
          connected=false;return;
        }
        count++;
        path += (connected?' L ':' M ')+x(i).toFixed(1)+' '+y(value).toFixed(1);
        connected=true;
        markers.push('<circle class="reliability-chart-point '+className+
          '" cx="'+x(i).toFixed(1)+'" cy="'+y(value).toFixed(1)+'" r="3.4">'+
          '<title>'+escapeHtml(title+' · '+(month.label||month.period)+': '+
            formatReliabilityNumber(value)+'%')+'</title></circle>');
      });
      return {markup:'<path class="reliability-chart-line '+className+
          '" d="'+path.trim()+'"></path>'+markers.join(''),count};
    }
    const overall = series('overall','series-1','Общее качество');
    const cgps = series('cgps','series-2','Качество ЦГПС');
    const unknown = months.filter(month => month.cgpsReason==='mb-coverage-unknown').length;
    const note = unknown
      ? ' За '+unknown+' мес. показатель ЦГПС недоступен из-за неполного покрытия МБ.'
      : '';
    return '<figure class="reliability-chart reliability-line-chart" data-chart-id="classification-quality-comparison">'+
      '<figcaption class="reliability-chart-head"><div>'+
      '<div class="reliability-chart-label">График</div>'+
      '<strong>Качество классификации: общее и ЦГПС</strong>'+
      '<p>Сравнение месячных значений в выбранном срезе. Для ЦГПС учитываются только подтверждённые обращения МБ; разрывы графика означают отсутствие достоверного значения.'+
      escapeHtml(note)+'</p>'+
      '</div></figcaption>'+
      '<div class="reliability-chart-svg-wrap"><svg viewBox="0 0 '+width+' '+height+
      '" role="img" aria-label="Месячное сравнение общего качества и качества ЦГПС">'+
      '<line class="reliability-chart-axis" x1="'+geo.left+'" y1="'+geo.top+
      '" x2="'+geo.left+'" y2="'+(geo.top+geo.height)+'"></line>'+
      '<line class="reliability-chart-axis" x1="'+geo.left+
      '" y1="'+(geo.top+geo.height)+'" x2="'+(geo.left+geo.width)+
      '" y2="'+(geo.top+geo.height)+'"></line>'+axis+monthLabels+
      overall.markup+cgps.markup+'</svg></div>'+
      '<div class="reliability-chart-legend">'+
      '<span><i class="reliability-chart-legend-swatch series-1"></i>Общее качество ('+overall.count+' мес.)</span>'+
      '<span><i class="reliability-chart-legend-swatch series-2"></i>ЦГПС ('+cgps.count+' мес.)</span>'+
      '</div></figure>';
  }

  // Presentation mapping only: classification and labor totals remain owned by
  // the Report Service. Stable category colors must not depend on sort order.
  function reliabilityLaborTone(title) {
    const value=String(title||'').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').trim();
    if (/то\s+вне\s+графика|внепланов(?:ое|ый)\s+то/.test(value)) return 'unscheduled';
    if (/то\s+по\s+графику|планов(?:ое|ый)\s+то/.test(value)) return 'maintenance';
    if (/^авр$|аварийно.восстановитель/.test(value)) return 'avr';
    if (/зно|монтаж|перенос/.test(value)) return 'install';
    if (/корректирующ/.test(value)) return 'corrective';
    return 'other';
  }

  function renderReliabilityLaborChart(labor) {
    if (!labor.structure.length || !Number.isFinite(labor.totalHours)) {
      return '<p class="reliability-section-note">Структура трудозатрат недоступна для выбранного среза.</p>';
    }

    const segments = labor.structure.map((item, index) => `
      <div
        class="reliability-labor-segment labor-tone-${reliabilityLaborTone(item.title)}"
        style="width:${Math.max(0, item.share)}%"
        title="${escapeHtml(item.title)}: ${escapeHtml(formatReliabilityNumber(item.share))}%"
      ></div>
    `).join('');

    const legend = labor.structure.map((item, index) => `
      <div class="reliability-labor-legend-row">
        <span class="reliability-chart-legend-swatch labor-tone-${reliabilityLaborTone(item.title)}"></span>
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(formatReliabilityNumber(item.share))}%</span>
        <span>${escapeHtml(formatReliabilityMetric(item.hours, labor.displayHoursUnit))}</span>
      </div>
    `).join('');

    const reactive = Number.isFinite(labor.reactiveShare.value)
      ? `Реактивная деятельность: <strong>${escapeHtml(formatReliabilityNumber(labor.reactiveShare.value))}%</strong> (АВР + корректирующие мероприятия).`
      : 'Доля реактивной деятельности недоступна.';

    return `
      <figure class="reliability-chart reliability-labor-chart" data-chart-id="labor-structure">
        <figcaption class="reliability-chart-head">
          <div>
            <div class="reliability-chart-label">График</div>
            <strong>Структура трудозатрат</strong>
            <p>Фактическая трудоёмкость МБ по итоговому типу задачи.</p>
          </div>
          <div class="reliability-chart-total">
            <span>Всего</span>
            <strong>${escapeHtml(formatReliabilityMetric(labor.totalHours, labor.displayHoursUnit))}</strong>
          </div>
        </figcaption>
        <div class="reliability-labor-stack" aria-label="Структура трудозатрат">${segments}</div>
        <div class="reliability-labor-legend">${legend}</div>
        <div class="reliability-chart-callout">${reactive}</div>
      </figure>
    `;
  }

  function renderReliabilityProblemChart(problemManagement) {
    // PR13: exactly one factual overview chart until PR14 replaces its
    // categories with the agreed eight columns. The eight detailed series
    // remain available in the immutable Snapshot, not duplicated on this page.
    if (!problemManagement.portfolio.length) {
      return '<p class="reliability-section-note">Детализация связи задач с ИТ-проблемами недоступна для выбранного среза.</p>';
    }

    const maxCount = Math.max(1, ...problemManagement.portfolio.map(item => item.count));
    const bars = problemManagement.portfolio.map((item, index) => {
      const height = (item.count / maxCount) * 100;
      return `
        <div class="reliability-prb-column">
          <div class="reliability-prb-value">${escapeHtml(formatReliabilityNumber(item.count))}</div>
          <div class="reliability-prb-bar-track">
            <div class="reliability-prb-bar stage-${index + 1}" style="height:${height.toFixed(1)}%"></div>
          </div>
          <div class="reliability-prb-label">${escapeHtml(item.title)}</div>
        </div>
      `;
    }).join('');

    return `
      <figure class="reliability-chart reliability-prb-chart" data-chart-id="prb-linkage">
        <figcaption class="reliability-chart-head">
          <div>
            <div class="reliability-chart-label">График</div>
            <strong>Связь задач МБ с ИТ-проблемами</strong>
            <p>Количество задач МБ по состоянию связи с PRB.</p>
          </div>
        </figcaption>
        <div class="reliability-prb-bars" aria-label="Связь задач с PRB">${bars}</div>
      </figure>
    `;
  }

  // Monochrome section glyphs replace decorative section numbers.
  function reliabilitySectionIcon(id) {
    const paths = {
      'reliability-technical':'<polyline points="2 12 6 12 9 5 13 19 16 12 22 12"/>',
      'reliability-data-quality':'<path d="M12 2 20 6v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"/><path d="m8 12 3 3 5-5"/>',
      'reliability-organizational':'<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 4v-2h6v2M8 11l2 2 4-4M8 18h8"/>',
      'reliability-labor':'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 3"/>',
      'reliability-problems':'<circle cx="5" cy="6" r="2"/><circle cx="19" cy="7" r="2"/><circle cx="12" cy="19" r="2"/><path d="m7 7 10 0M6 8l5 9m7-8-5 8"/>'
    };
    const path = paths[id] || paths['reliability-technical'];
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" ' +
      'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }

  function renderReliabilitySection({ id, index, title, description, kpis, chart = '', note = '' }) {
    const lowerArea = chart || (note ? `<p class="reliability-section-note">${escapeHtml(note)}</p>` : '');
    return `
      <section class="reliability-section" id="${escapeHtml(id)}">
        <div class="reliability-section-head">
          <div class="reliability-section-index">${reliabilitySectionIcon(id)}</div>
          <div>
            <h2>${escapeHtml(title)}</h2>
            <p>${escapeHtml(description)}</p>
          </div>
        </div>
        <div class="reliability-kpi-grid">
          ${renderReliabilityKpiCards(kpis)}
        </div>
        ${lowerArea}
      </section>
    `;
  }

  function renderReliabilityDashboardError(error) {
    globalThis.ReclassifierHeaderIndicators?.setKpi?.('error');
    setHeader('Управленческий отчёт', 'Отчёт по надёжности СДГР', 'Не удалось сформировать Report Snapshot.');
    el.pageContent.innerHTML = `
      <div class="notice error">
        <strong>Ошибка формирования Report Snapshot.</strong>
        <div>${escapeHtml(error?.message || String(error))}</div>
      </div>
    `;
  }

  function renderReliabilityDashboardInner(providedSnapshot = null) {
    try {
      const service = globalThis.ReclassifierReliabilityReportService;
      if (!service?.buildSnapshot) throw new Error('Reliability Report Service недоступен.');
      const profiler=globalThis.ReclassifierPerformanceProfiler;
      const getSnapshot=()=>providedSnapshot || service.buildSnapshot(reliabilityDashboardFilterState);
      const snapshot=profiler ? profiler.measure('dashboard.snapshot.request',getSnapshot) : getSnapshot();
      const dashboard = buildReliabilityDashboardView(reliabilityDashboardData, snapshot);
      const primaryStage = snapshot.diagnostics?.stage === 'primary';

      const serviceChart = renderReliabilityLineChart({
        id: 'sla-dynamics',
        title: 'Динамика SLA',
        description: primaryStage ? 'Месячная история SLA готовится в фоне.' : dashboard.monthlyDynamics.sla.length >= 2
          ? 'Месячный SLA по закрытым обращениям для выбранного среза.'
          : 'Для выбранного среза недостаточно месячных точек SLA для графика.',
        points: dashboard.monthlyDynamics.sla,
        minValue: 0,
        maxValue: 100,
        showValues: true
      });

      setHeader(
        'Управленческий отчёт',
        dashboard.report.title,
        'Показатели по данным подключённых источников.'
      );

      const domStarted=profiler?.start('dashboard.render.dom');
      el.pageContent.innerHTML = `
        <div class="reliability-report-head">
          <div class="reliability-toolbar-row">
            ${renderReliabilityFilters(dashboard)}
            <div class="reliability-report-actions">
              <button class="button reliability-passports-button" id="reliabilityOpenKpiPassportsButton"
                type="button" title="Открыть каталог паспортов KPI">Паспорта KPI</button>
              <button class="button reliability-refresh-button" id="reliabilityRefreshKpiButton"
                type="button" title="Пересчитать KPI для текущего периода, рудника и класса оборудования">
                Обновить KPI
              </button>
              <button class="button reliability-pdf-button" id="reliabilityPdfExportButton"
                type="button" aria-describedby="reliabilityPdfExportStatus"
                ${primaryStage ? 'disabled title="Подготовка месячной истории"' : ''}>Скачать PDF</button>
            </div>
          </div>
          ${renderReliabilityEvidence(snapshot)}
          <p class="reliability-pdf-status" id="reliabilityPdfExportStatus"
            ${reliabilityDashboardUiState.pdfStatusMessage ? '' : ' hidden'}>${escapeHtml(reliabilityDashboardUiState.pdfStatusMessage)}</p>
        </div>

        <nav class="reliability-section-nav" aria-label="Разделы отчёта">
          <a href="#reliability-technical">Техническая надёжность</a>
          <a href="#reliability-data-quality">Данные и качество</a>
          <a href="#reliability-organizational">Организационная готовность</a>
          <a href="#reliability-labor">Трудозатраты</a>
          <a href="#reliability-problems">Управление проблемами</a>
        </nav>

        <div class="reliability-dashboard-sections">
          ${renderReliabilitySection({
            id: 'reliability-technical',
            index: '01',
            title: 'Техническая надёжность',
            description: 'ВБР и КТГ — по численности Drivers; КТГ учитывает длительность INC и работ по предбэклогу ITSM.',
            kpis: dashboard.kpiGroups.technicalReliability
          })}

          ${renderReliabilitySection({
            id: 'reliability-data-quality',
            index: '02',
            title: 'Данные и качество',
            description: 'Качество классификации общее обращений ITSM Сириус и качество обращений, по которым работы зарегистрированы в МБ в рамках деятельности ЦГПС.',
            kpis: dashboard.kpiGroups.dataQuality
          })}

          ${renderReliabilitySection({
            id: 'reliability-organizational',
            index: '03',
            title: 'Организационная готовность',
            description: 'SLA рассчитывается по закрытым обращениям; КОГ и уровень сервиса пока не подключены.',
            kpis: dashboard.kpiGroups.organizationalReadiness,
            chart: serviceChart
          })}

          ${renderReliabilitySection({
            id: 'reliability-labor',
            index: '04',
            title: 'Трудозатраты',
            description: 'Фактические трудозатраты МБ по выбранному периоду, руднику и классу оборудования.',
            kpis: dashboard.labor.summaryKpis,
            chart: renderReliabilityLaborChart(dashboard.labor)
          })}

          ${renderReliabilitySection({
            id: 'reliability-problems',
            index: '05',
            title: 'Управление проблемами',
            description: 'Охват задач и трудозатрат работой по ИТ-проблемам, число уникальных проблем и динамика связей.',
            kpis: dashboard.problemManagement.summaryKpis,
            chart: renderReliabilityProblemChart(dashboard.problemManagement)
          })}
        </div>

        <dialog id="reliabilityKpiPassportDialog" class="reliability-kpi-passport-dialog"
          aria-labelledby="reliabilityKpiPassportTitle" aria-modal="true">
          <div class="reliability-passport-modal-shell">
            <button type="button" id="reliabilityKpiPassportClose"
              class="reliability-kpi-passport-close" aria-label="Закрыть паспорт KPI" title="Закрыть">×</button>
            <div id="reliabilityKpiPassportBody" class="reliability-kpi-passport-body"></div>
          </div>
        </dialog>

        <dialog id="reliabilityKpiChartDialog" class="reliability-kpi-chart-dialog"
          aria-labelledby="reliabilityKpiChartTitle" aria-modal="true">
          <div class="reliability-chart-modal-shell">
            <div class="reliability-chart-modal-head">
              <h2 id="reliabilityKpiChartTitle" tabindex="-1">Динамика KPI</h2>
              <button type="button" id="reliabilityKpiChartClose"
                class="reliability-kpi-passport-close" aria-label="Закрыть график KPI" title="Закрыть">×</button>
            </div>
            <div id="reliabilityKpiChartBody" class="reliability-chart-modal-body"></div>
          </div>
        </dialog>
      `;

      bindReliabilityDashboardFilters();
      bindReliabilityPassportDialog(dashboard);
      bindReliabilityKpiChartDialog(dashboard);
      bindReliabilityPdfExport(dashboard);
      restoreReliabilityDashboardFocus();
      if (!primaryStage) globalThis.ReclassifierHeaderIndicators?.setKpi?.(
        snapshot.status === 'ready' ? 'ready' : snapshot.status === 'empty' ? 'idle' : 'partial'
      );
      profiler?.end('dashboard.render.dom',domStarted);
    } catch (error) {
      renderReliabilityDashboardError(error);
    }
  }
  let stagedReliabilityRequest = 0;
  let stagedReliabilityController = null;
  function cancelStagedReliabilityCalculation() {
    if (stagedReliabilityController && !stagedReliabilityController.signal.aborted) {
      stagedReliabilityController.abort();
      globalThis.ReclassifierHeaderIndicators?.setKpi?.('stale');
    }
    stagedReliabilityController = null;
  }
  function renderReliabilityDashboard(options = {}) {
    const forceRefresh = options?.forceRefresh === true;
    const profiler=globalThis.ReclassifierPerformanceProfiler;
    const synchronously = () => {
      const run = () => forceRefresh
        ? renderReliabilityDashboardInner(
            globalThis.ReclassifierReliabilityReportService.buildSnapshot(
              reliabilityDashboardFilterState,{forceRecalculate:true}))
        : renderReliabilityDashboardInner();
      return profiler ? profiler.measure('dashboard.render.total',run) : run();
    };
    const service=globalThis.ReclassifierReliabilityReportService;
    globalThis.ReclassifierHeaderIndicators?.setKpi?.('calculating', 0);
    // Browserless smoke harness and browsers lacking dedicated Workers retain
    // the existing synchronous path. The PR5 stage is only enabled after
    // Runtime finished restoring the authoritative Dataset.
    if (!state.baselineReady || typeof Worker !== 'function' ||
        !service?.buildSnapshotAsync ||
        !globalThis.ReclassifierKpiBackgroundJobs?.runReport) {
      return synchronously();
    }
    const requestId=++stagedReliabilityRequest;
    stagedReliabilityController?.abort();
    stagedReliabilityController=new AbortController();
    const signal=stagedReliabilityController.signal;
    const requested={...reliabilityDashboardFilterState};
    let currentStage = 'primary';
    const isCurrent=()=>state.route==='reliability_dashboard' &&
      requestId===stagedReliabilityRequest && !signal.aborted;
    setHeader('Управленческий отчёт','Отчёт по надёжности СДГР',
      'Подготовка расчётных показателей по текущим Dataset.');
    el.pageContent.innerHTML=`
      <div class="notice reliability-stage-notice" id="reliabilityReportStageStatus"
        role="status" aria-live="polite">
        Подготовка основных KPI… Данные проверяются в фоновом вычислительном потоке.
      </div>`;
    const onProgress=progress=>{
      if(!isCurrent())return;
      const node=document.getElementById('reliabilityReportStageStatus');
      if(Number.isFinite(progress?.percent)) {
        const pct=Math.min(100,Math.max(0,progress.percent));
        // Stage weighting follows completed Worker phases; no simulated timer.
        const overall=currentStage==='primary' ? pct*0.25 : 25+pct*0.75;
        globalThis.ReclassifierHeaderIndicators?.setKpi?.('calculating',overall);
        if(node && progress?.label) {
          node.textContent=String(progress.label).slice(0,80)+'… '+Math.round(pct)+'%';
        }
      }
    };
    Promise.resolve().then(async()=>{
      let primaryReady=false;
      try {
        const primary=await service.buildSnapshotAsync(requested,{
          stage:'primary',priority:1,signal,onProgress
        });
        if(!isCurrent())return;
        primaryReady=true;
        globalThis.ReclassifierHeaderIndicators?.setKpi?.('calculating',25);
        renderReliabilityDashboardInner(primary);
        if(!isCurrent())return;
        currentStage='full';
        const full=await service.buildSnapshotAsync(requested,{
          stage:'full',priority:3,signal,onProgress,
          forceRecalculate:forceRefresh
        });
        if(!isCurrent())return;
        renderReliabilityDashboardInner(full);
      } catch(error) {
        if(!isCurrent())return;
        const reason=error?.message||String(error);
        // A first-stage error must not permanently hide the report: expose
        // an explicit compatible fallback instead of silently changing paths.
        if(!primaryReady) {
          renderReliabilityDashboardError(error);
          el.pageContent.insertAdjacentHTML?.('beforeend',
            '<button type="button" class="button" id="reliabilityReportFallback">Открыть отчёт в совместимом режиме</button>');
          document.getElementById('reliabilityReportFallback')?.addEventListener('click',synchronously);
        } else {
          globalThis.ReclassifierHeaderIndicators?.setKpi?.('error');
          const node=document.getElementById('reliabilityReportStageStatus');
          if(node)node.textContent='Месячная история недоступна: '+reason+
            '. Основные KPI сохранены. Обновите фильтр или повторите открытие отчёта.';
        }
      } finally {
        if (requestId === stagedReliabilityRequest) stagedReliabilityController = null;
      }
    });
  }
