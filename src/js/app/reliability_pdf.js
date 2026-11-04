// FILE CONTRACT: Reliability Report PDF renderer.
// Purpose: render an already-built immutable Report Snapshot into a downloadable offline PDF.
// Owns: PDF presentation, canvas page layout, JPEG page encoding, PDF byte assembly and download.
// Reads: the supplied Report Snapshot only.
// Writes: a user-initiated PDF download.
// Must not: read Dataset storage, call KPI Preparation/Calculator, rebuild a Snapshot or mutate report inputs.

(() => {
  'use strict';

  const PDF_VERSION = '1.3.0';
  const presentation = globalThis.ReclassifierReliabilityPresentation ||
    (typeof module !== 'undefined' ? require('./reliability_report_presentation.js') : null);
  const PAGE = Object.freeze({
    width: 1240,
    height: 1754,
    marginX: 82,
    top: 122,
    bottom: 98,
    contentWidth: 1076
  });

  const COLORS = Object.freeze({
    ink: '#172033',
    muted: '#64748b',
    subtle: '#94a3b8',
    border: '#dbe3ec',
    panel: '#f8fafc',
    panelStrong: '#eef3f7',
    white: '#ffffff',
    brand: '#15803d',
    brandDark: '#14532d',
    navy: '#0f172a',
    blue: '#2563eb',
    cyan: '#0891b2',
    amber: '#b45309',
    red: '#b91c1c',
    green: '#047857'
  });

  const KPI_ORDER = Object.freeze([
    'vbr',
    'sla',
    'classification_quality',
    'classification_quality_cgps',
    'total_labor',
    'avr_labor',
    'avr_share',
    'maintenance_labor',
    'corrective_labor',
    'reactive_share',
    'problem_coverage_absolute',
    'problem_coverage_relative',
    'problem_linked_tasks',
    'problem_task_coverage',
    'problem_active_count'
  ]);

  function text(value) {
    return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function formatNumber(value, digits = 1) {
    if (!finite(value)) return '—';
    return new Intl.NumberFormat('ru-RU', {
      maximumFractionDigits: digits
    }).format(value);
  }

  function formatMetric(value, unit = '') {
    if (!finite(value)) return '—';
    const number = formatNumber(value);
    return unit ? number + ' ' + unit : number;
  }

  function formatDate(value) {
    const raw = text(value);
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!match) return raw || '—';
    return match[3] + '.' + match[2] + '.' + match[1] +
      (match[4] ? ' ' + match[4] + ':' + match[5] : '');
  }

  function stateLabel(state) {
    const labels = {
      available: 'Данные доступны',
      'no-data': 'Нет данных',
      unavailable: 'Расчёт недоступен',
      insufficient: 'Недостаточно данных',
      'not-applicable': 'Не рассчитывается',
      error: 'Ошибка расчёта'
    };
    return labels[state] || text(state) || 'Не определено';
  }

  function stateColor(state) {
    if (state === 'available') return COLORS.green;
    if (state === 'error') return COLORS.red;
    if (state === 'no-data' || state === 'insufficient') return COLORS.amber;
    return COLORS.muted;
  }

  const QUALITY_KPIS = Object.freeze(['classification_quality','classification_quality_cgps']);
  const QUALITY_LABELS = Object.freeze({
    classification_quality:'Качество классификации общее',
    classification_quality_cgps:'Качество классификации ЦГПС'
  });
  const QUALITY_COMPONENTS = Object.freeze([
    ['classificationIncUnchangedCount','A · INC без изм'],
    ['classificationIncCorrectedCount','B · INC с исправлением'],
    ['classificationIncUnclassifiedCount','C · INC не классифицирован'],
    ['classificationRitmInsteadOfIncCount','D · RITM вместо INC']
  ]);
  function qualityValue(result) {
    return result?.dataState === 'available' && finite(result.value) &&
      result.value >= 0 && result.value <= 100 ? result.value : null;
  }
  function reportEvidence(snapshot) {
    if (presentation?.summary) return presentation.summary(snapshot);
    // Single-file legacy PDF harnesses omit the presentation fragment.
    // This fallback counts statuses only; never computes a KPI value.
    const results=Object.values(snapshot?.results || {});
    const sources=Array.from(snapshot?.sources || []);
    return Object.freeze({
      kpiAvailable:results.filter(r=>r?.dataState==='available' && finite(r.value)).length,
      kpiTotal:results.length,
      sourceAvailable:sources.filter(r=>r?.available===true).length,
      sourceTotal:sources.length,
      monthCount:snapshot?.series?.monthly?.length||0,
      status:snapshot?.status||'empty'
    });
  }
  // Pure projection of the same monthly KPI Results read by the WEB dashboard.
  // Null is retained for unknown/absent months; no interpolation or fake zeros.
  function qualityMonthlyData(monthly = []) {
    return Object.freeze(Array.from(monthly || [], row => Object.freeze({
      period: row.period || null,
      label: row.label || row.period || '',
      overall: qualityValue(row.classification_quality),
      cgps: qualityValue(row.classification_quality_cgps),
      overallReason: row.classification_quality?.reason || null,
      cgpsReason: row.classification_quality_cgps?.reason || null
    })));
  }
  function qualitySegments(monthly, key) {
    const segments=[];let current=[];
    for(let index=0;index<monthly.length;index++) {
      const row=monthly[index];
      if(finite(row[key]))current.push(Object.freeze({index,period:row.period,value:row[key]}));
      else if(current.length){segments.push(Object.freeze(current));current=[];}
    }
    if(current.length)segments.push(Object.freeze(current));
    return Object.freeze(segments);
  }

  function queryLabel(snapshot) {
    return [
      snapshot?.query?.period?.label || 'Период не определён',
      snapshot?.query?.mine?.label || 'Все рудники',
      snapshot?.query?.equipmentClass?.label || 'Всё оборудование'
    ].join(' · ');
  }

  function fingerprintForecast(forecast) {
    if(!['reporting-month-nowcast','reporting-month-volume-nowcast']
      .includes(forecast?.forecastType) ||
       forecast.dataState!=='available' || !finite(forecast.value))return null;
    return {
      forecastType:forecast.forecastType,
      value:forecast.value,observedValue:forecast.observedValue,
      horizon:forecast.horizon,asOf:forecast.asOf,
      coverageFrom:forecast.coverageFrom,coverageThrough:forecast.coverageThrough,
      methodId:forecast.methodId,methodVersion:forecast.methodVersion,
      requestedMethodId:forecast.requestedMethodId,
      strategyId:forecast.strategyId,strategyVersion:forecast.strategyVersion,
      methodComponents:forecast.methodComponents,
      quality:forecast.quality,
      sourceRevisions:forecast.sourceRevisions
    };
  }

  // PDF diagnostics come exclusively from the selected KPI Result. Keep only
  // aggregate counts and group labels: never embed source record text/PII.
  function qualityDiagnosticFingerprint(result) {
    const info=result?.diagnostics?.classificationCoverage;
    if(!info)return null;
    const keys=[
      'classifiedItsmCount','bothSameMonthCount','bothOtherMonthCount',
      'bothUndatedMbCount','missingItsmRequestCount',
      'itsmNotInLoadedMbCount','itsmUnknownMbCoverageCount',
      'itsmConfirmedMbAbsenceCount','mbOnlyLoadedCount',
      'mbUnknownItsmCoverageCount','mbNoRequestTaskCount'
    ];
    const counters=Object.fromEntries(keys.map(key=>[
      key,finite(info[key])?info[key]:null
    ]));
    return {
      version:info.version||null,
      counters,
      mbPresent:info.mbPresent===true,
      itsmCoverageStatus:info.itsmCoverageStatus||null,
      mbCoverageStatus:info.mbCoverageStatus||null,
      byInitiator:Array.from(info.byInitiator||[]).map(group=>({
        label:group.label||'Группа не определена',
        count:finite(group.count)?group.count:null,
        categoryA:finite(group.categoryA)?group.categoryA:null,
        categoryB:finite(group.categoryB)?group.categoryB:null,
        categoryC:finite(group.categoryC)?group.categoryC:null,
        categoryD:finite(group.categoryD)?group.categoryD:null,
        bothSameMonthCount:finite(group.bothSameMonthCount)?group.bothSameMonthCount:null,
        bothOtherMonthCount:finite(group.bothOtherMonthCount)?group.bothOtherMonthCount:null
      }))
    };
  }

  function stableFingerprintPayload(snapshot) {
    const results = {};
    for (const id of Object.keys(snapshot?.results || {}).sort()) {
      const result = snapshot.results[id] || {};
      results[id] = {
        value: finite(result.value) ? result.value : null,
        unit: result.unit || null,
        dataState: result.dataState || null,
        reason: result.reason || null,
        formulaVersion: result.formulaVersion || null,
        components: result.components || {},
        classificationCoverage:id==='classification_quality'
          ? qualityDiagnosticFingerprint(result):null
      };
    }

    return {
      schemaVersion: snapshot?.schemaVersion || null,
      calculatedAt: snapshot?.calculatedAt || null,
      preparationVersion: snapshot?.preparationVersion || null,
      calculatorVersion: snapshot?.calculatorVersion || null,
      query: {
        period: snapshot?.query?.period?.id || snapshot?.query?.period?.month || null,
        periodMonth: snapshot?.query?.period?.month || null,
        mine: snapshot?.query?.mine?.id || null,
        equipmentClass: snapshot?.query?.equipmentClass?.id || null
      },
      results,
      // A PDF chart is part of the report identity: changing a historical
      // point must not keep the same filename/fingerprint when KPI cards match.
      monthlyQuality: qualityMonthlyData(snapshot?.series?.monthly || []),
      // Both operational series affect the PDF chart and must affect its
      // fingerprint even when the current-month KPI cards are unchanged.
      monthlyOperational: Array.from(snapshot?.series?.monthly || [], row => ({
        period: row.period || null,
        vbr: qualityValue(row?.vbr),
        sla: qualityValue(row?.sla)
      })),
      problemCharts: Array.from(snapshot?.breakdowns?.problemCharts || [],chart=>({
        id:chart.id,
        unit:chart.unit,
        items:Array.from(chart.items||[],item=>({
          label:item.label,value:finite(item.value)?item.value:null
        }))
      })),
      forecastVbr: fingerprintForecast(snapshot?.kpiView?.cards?.vbr?.forecast),
      forecastKtg: fingerprintForecast(snapshot?.kpiView?.cards?.ktg?.forecast),
      forecastLabor: Object.fromEntries(
        ['total_labor','avr_labor','maintenance_labor','corrective_labor']
        .map(id=>[id,fingerprintForecast(snapshot?.kpiView?.cards?.[id]?.forecast)])
      ),
      sources: Array.from(snapshot?.sources || []).map(source => ({
        id: source.id,
        available: Boolean(source.available),
        schemaVersion: source.schemaVersion || null,
        activeRevision: source.activeRevision ?? null,
        contentHash: source.contentHash || null,
        freshness: source.freshness || null,
        rowCount: source.rowCount ?? null,
        validationStatus: source.validationStatus || null,
        dependencyStatus: source.dependencyStatus || null,
        reportingCoverage:source.reportingCoverage||null
      }))
    };
  }

  function snapshotFingerprint(snapshot) {
    const source = JSON.stringify(stableFingerprintPayload(snapshot));
    let hash = 0x811c9dc5;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  function fileName(snapshot, fingerprint = snapshotFingerprint(snapshot)) {
    const period = text(snapshot?.query?.period?.month || snapshot?.query?.period?.id || 'report')
      .replace(/[^0-9A-Za-z_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'report';
    return 'Reclassifier_Reliability_' + period + '_' + fingerprint + '.pdf';
  }

  function orderedResults(snapshot) {
    const source = snapshot?.results || {};
    const known = KPI_ORDER.filter(id => source[id]).map(id => source[id]);
    const extra = Object.keys(source)
      .filter(id => !KPI_ORDER.includes(id))
      .sort()
      .map(id => source[id]);
    return known.concat(extra);
  }

  function createPlan(snapshot) {
    if (!snapshot || snapshot.type !== 'reliability-report') {
      throw new Error('PDF renderer requires a reliability Report Snapshot.');
    }
    if (snapshot.diagnostics?.stage === 'primary') {
      throw new Error('PDF недоступен до завершения полного Report Snapshot.');
    }

    return Object.freeze({
      fingerprint: snapshotFingerprint(snapshot),
      title: 'Отчёт по надёжности СДГР',
      queryLabel: queryLabel(snapshot),
      status: snapshot.status || 'partial',
      evidence: reportEvidence(snapshot),
      calculatedAt: snapshot.calculatedAt || null,
      preparationVersion: snapshot.preparationVersion || null,
      calculatorVersion: snapshot.calculatorVersion || null,
      results: Object.freeze(orderedResults(snapshot).slice()),
      monthly: Object.freeze(Array.from(snapshot.series?.monthly || [])),
      monthlyQuality: qualityMonthlyData(snapshot.series?.monthly || []),
      forecastVbr: snapshot.kpiView?.cards?.vbr?.forecast || null,
      forecastKtg: snapshot.kpiView?.cards?.ktg?.forecast || null,
      forecastLabor: Object.freeze(Object.fromEntries(
        ['total_labor','avr_labor','maintenance_labor','corrective_labor']
        .map(id=>[id,snapshot.kpiView?.cards?.[id]?.forecast||null])
      )),
      labor: Object.freeze(Array.from(snapshot.breakdowns?.labor || [])),
      problemManagement: Object.freeze(Array.from(snapshot.breakdowns?.problemManagement || [])),
      problemCharts: Object.freeze(Array.from(snapshot.breakdowns?.problemCharts || [])),
      sources: Object.freeze(Array.from(snapshot.sources || []))
    });
  }

  function font(size, weight = 400) {
    return String(weight) + ' ' + String(size) + 'px Arial, "Segoe UI", sans-serif';
  }

  function setFont(ctx, size, weight = 400, color = COLORS.ink) {
    ctx.font = font(size, weight);
    ctx.fillStyle = color;
    ctx.textBaseline = 'alphabetic';
  }

  function roundRect(ctx, x, y, width, height, radius, fill, stroke = null) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function wrapLines(ctx, value, maxWidth, maxLines = 100) {
    const source = text(value);
    if (!source) return [];
    const words = source.split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? line + ' ' + word : word;
      if (!line || ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    }
    if (line && lines.length < maxLines) lines.push(line);
    if (lines.length === maxLines && words.length) {
      const last = lines.length - 1;
      let current = lines[last];
      while (current.length > 1 && ctx.measureText(current + '…').width > maxWidth) {
        current = current.slice(0, -1);
      }
      lines[last] = current.replace(/[ ,.;:]+$/g, '') + '…';
    }
    return lines;
  }

  function drawLines(ctx, lines, x, y, lineHeight, color = null) {
    if (color) ctx.fillStyle = color;
    lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
    return y + lines.length * lineHeight;
  }

  function drawPageChrome(page, plan, pageNumber, totalPages) {
    const { ctx } = page;
    ctx.fillStyle = COLORS.navy;
    ctx.fillRect(0, 0, PAGE.width, 82);

    roundRect(ctx, PAGE.marginX, 21, 42, 42, 12, COLORS.brand);
    setFont(ctx, 27, 700, COLORS.white);
    ctx.textAlign = 'center';
    ctx.fillText('R', PAGE.marginX + 21, 52);
    ctx.textAlign = 'left';

    setFont(ctx, 24, 700, COLORS.white);
    ctx.fillText('Reclassifier', PAGE.marginX + 58, 50);
    setFont(ctx, 17, 400, '#cbd5e1');
    ctx.fillText('Reliability Report · Snapshot ' + plan.fingerprint, PAGE.width - PAGE.marginX - 360, 49);

    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAGE.marginX, PAGE.height - 68);
    ctx.lineTo(PAGE.width - PAGE.marginX, PAGE.height - 68);
    ctx.stroke();

    setFont(ctx, 15, 400, COLORS.muted);
    ctx.fillText('Report Snapshot · ' + formatDate(plan.calculatedAt), PAGE.marginX, PAGE.height - 38);
    ctx.textAlign = 'right';
    ctx.fillText('Страница ' + pageNumber + ' / ' + totalPages, PAGE.width - PAGE.marginX, PAGE.height - 38);
    ctx.textAlign = 'left';
  }

  function createFlowDocument(plan) {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      throw new Error('Canvas PDF rendering requires a browser document.');
    }

    const pages = [];
    let current = null;
    let y = PAGE.top;

    function newPage() {
      const canvas = document.createElement('canvas');
      canvas.width = PAGE.width;
      canvas.height = PAGE.height;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('Canvas 2D context is unavailable.');
      ctx.fillStyle = COLORS.white;
      ctx.fillRect(0, 0, PAGE.width, PAGE.height);
      current = { canvas, ctx };
      pages.push(current);
      y = PAGE.top;
      return current;
    }

    function ensure(height) {
      if (!current) newPage();
      if (y + height > PAGE.height - PAGE.bottom) newPage();
      return current.ctx;
    }

    function gap(value = 18) {
      y += value;
    }

    function heading(title, subtitle = '') {
      const ctx = ensure(subtitle ? 100 : 68);
      setFont(ctx, 28, 700, COLORS.ink);
      ctx.fillText(title, PAGE.marginX, y + 28);
      y += 42;
      if (subtitle) {
        setFont(ctx, 17, 400, COLORS.muted);
        const lines = wrapLines(ctx, subtitle, PAGE.contentWidth, 3);
        y = drawLines(ctx, lines, PAGE.marginX, y + 4, 24, COLORS.muted);
      }
      y += 16;
    }

    function paragraph(value, options = {}) {
      const size = options.size || 17;
      const lineHeight = options.lineHeight || Math.round(size * 1.45);
      const ctx = ensure(lineHeight * 2 + 10);
      setFont(ctx, size, options.weight || 400, options.color || COLORS.ink);
      const lines = wrapLines(ctx, value, options.width || PAGE.contentWidth, options.maxLines || 20);
      const required = Math.max(lineHeight, lines.length * lineHeight) + (options.after ?? 12);
      ensure(required);
      const actualCtx = current.ctx;
      setFont(actualCtx, size, options.weight || 400, options.color || COLORS.ink);
      y = drawLines(actualCtx, lines, PAGE.marginX + (options.indent || 0), y + size, lineHeight);
      y += options.after ?? 12;
    }

    function labelValue(label, value, x, width) {
      const ctx = current.ctx;
      setFont(ctx, 14, 600, COLORS.muted);
      ctx.fillText(label.toUpperCase(), x, y + 15);
      setFont(ctx, 20, 600, COLORS.ink);
      const lines = wrapLines(ctx, value, width, 2);
      drawLines(ctx, lines, x, y + 42, 26, COLORS.ink);
    }

    function snapshotSummary() {
      ensure(230);
      const ctx = current.ctx;
      setFont(ctx, 42, 700, COLORS.ink);
      ctx.fillText(plan.title, PAGE.marginX, y + 42);
      y += 66;

      setFont(ctx, 19, 400, COLORS.muted);
      const scopeLines = wrapLines(ctx, plan.queryLabel, PAGE.contentWidth, 3);
      y = drawLines(ctx, scopeLines, PAGE.marginX, y + 5, 28, COLORS.muted);
      y += 22;

      roundRect(ctx, PAGE.marginX, y, PAGE.contentWidth, 108, 14, COLORS.panel, COLORS.border);
      const col = PAGE.contentWidth / 3;
      labelValue('Состояние', plan.status === 'ready' ? 'Готов' : plan.status === 'empty' ? 'Нет данных' : 'Частичный', PAGE.marginX + 22, col - 44);
      labelValue('Рассчитано', formatDate(plan.calculatedAt), PAGE.marginX + col + 22, col - 44);
      labelValue('Snapshot', plan.fingerprint, PAGE.marginX + col * 2 + 22, col - 44);
      y += 132;
      // Evidence is derived from the same frozen Snapshot as the WEB report:
      // no extra Dataset reads and no interpretation of missing values as 0.
      const evidence = plan.evidence;
      ensure(90);
      const evidenceCtx = current.ctx;
      roundRect(evidenceCtx, PAGE.marginX, y, PAGE.contentWidth, 73, 12,
        COLORS.panelStrong, COLORS.border);
      setFont(evidenceCtx, 15, 600, COLORS.muted);
      evidenceCtx.fillText('КОМПЛЕКТНОСТЬ ОТЧЁТА', PAGE.marginX + 18, y + 23);
      setFont(evidenceCtx, 19, 700, COLORS.ink);
      evidenceCtx.fillText(
        'KPI: ' + evidence.kpiAvailable + '/' + evidence.kpiTotal +
        '  ·  Источники: ' + evidence.sourceAvailable + '/' + evidence.sourceTotal +
        '  ·  Месячная история: ' + evidence.monthCount + ' мес.',
        PAGE.marginX + 18, y + 52);
      y += 91;
    }

    function kpiCards() {
      heading('Ключевые показатели', 'Значения взяты непосредственно из KPI Result текущего Report Snapshot.');
      const gapX = 18;
      const cardWidth = (PAGE.contentWidth - gapX) / 2;
      const cardHeight = 144;

      for (let index = 0; index < plan.results.length; index += 2) {
        ensure(cardHeight + 16);
        const ctx = current.ctx;
        for (let column = 0; column < 2; column += 1) {
          const result = plan.results[index + column];
          if (!result) continue;
          const x = PAGE.marginX + column * (cardWidth + gapX);
          roundRect(ctx, x, y, cardWidth, cardHeight, 14, COLORS.white, COLORS.border);

          setFont(ctx, 17, 600, COLORS.muted);
          const titleLines = wrapLines(ctx, result.title || result.id, cardWidth - 34, 2);
          drawLines(ctx, titleLines, x + 18, y + 25, 22, COLORS.muted);

          const available = result.dataState === 'available' && finite(result.value);
          setFont(ctx, 34, 700, available ? COLORS.ink : COLORS.subtle);
          ctx.fillText(available ? formatMetric(result.value, result.unit) : '—', x + 18, y + 92);

          setFont(ctx, 14, 600, stateColor(result.dataState));
          ctx.fillText(stateLabel(result.dataState), x + 18, y + 121);
          if (result.reason) {
            setFont(ctx, 13, 400, COLORS.muted);
            const reason = text(result.reason);
            ctx.textAlign = 'right';
            ctx.fillText(reason.length > 30 ? reason.slice(0, 29) + '…' : reason, x + cardWidth - 18, y + 121);
            ctx.textAlign = 'left';
          }
        }
        y += cardHeight + 16;
      }
      gap(8);
    }

    function lineChart() {
      // PR13: one compact overview plot — SLA, same monthly Result objects
      // as WEB. VBR and classification detail remain in KPI cards/passports.
      heading('Динамика SLA',
        'Месячный SLA по закрытым обращениям. Пропущенные месяцы не соединяются линией.');
      const rows=plan.monthly;
      const actual=rows.map(row=>qualityValue(row?.sla));
      if(actual.filter(finite).length<2) {
        paragraph('Месячная динамика SLA: недостаточно достоверных точек.',
          {color:COLORS.muted});
        return;
      }
      // Keep PDF month labels readable: render at most twelve observations
      // per chart page, without resampling, dropping gaps or overlap.
      for(let startMonth=0;startMonth<rows.length;startMonth+=12) {
      ensure(325);
      const visibleRows=rows.slice(startMonth,startMonth+12);
      const visibleValues=visibleRows.map(row=>qualityValue(row?.sla));
      const ctx=current.ctx;
      const chartY=y+25,height=220;
      const left=PAGE.marginX+54,right=PAGE.marginX+PAGE.contentWidth-20;
      const top=chartY+22,bottom=chartY+height-41;
      setFont(ctx,14,400,COLORS.muted);
      for(let tick=0;tick<=4;tick++){
        const value=100-tick*25;
        const yy=top+(bottom-top)*tick/4;
        ctx.strokeStyle='#e2e8f0';ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(right,yy);ctx.stroke();
        ctx.textAlign='right';ctx.fillText(String(value),left-11,yy+5);
      }
      const divisor=Math.max(1,visibleRows.length-1);
      const coordinates=visibleValues.map((value,index)=>({
        value,x:left+(right-left)*index/divisor,
        y:finite(value)?bottom-(value/100)*(bottom-top):null
      }));
      ctx.strokeStyle=COLORS.blue;ctx.lineWidth=3;
      ctx.beginPath();
      let connected=false;
      for(const point of coordinates){
        if(!finite(point.value)){connected=false;continue;}
        if(connected)ctx.lineTo(point.x,point.y);
        else ctx.moveTo(point.x,point.y);
        connected=true;
      }
      ctx.stroke();
      coordinates.forEach((point,index)=>{
        if(!finite(point.value))return;
        ctx.fillStyle=COLORS.blue;ctx.beginPath();
        ctx.arc(point.x,point.y,4,0,Math.PI*2);ctx.fill();
        // The label belongs to the actual month; all values carry percent.
        // Clamp to chart bounds so both 0% and 100% stay visible.
        setFont(ctx,12,700,COLORS.ink);
        ctx.textAlign='center';
        ctx.fillText(formatNumber(point.value)+'%',point.x,
          Math.min(bottom-13,Math.max(chartY+14,point.y-10)));
      });
      setFont(ctx,12,400,COLORS.muted);
      ctx.textAlign='center';
      visibleRows.forEach((row,index)=>{
        const xx=coordinates[index].x;
        ctx.save();ctx.translate(xx,bottom+22);ctx.rotate(-0.25);
        ctx.fillText(row.label||row.period||'',0,0);ctx.restore();
      });
      ctx.textAlign='left';
      y=chartY+height+18;
      const missing=visibleRows.length-visibleValues.filter(finite).length;
      if(missing)paragraph('Месяцев без достоверного SLA: '+
        formatNumber(missing,0)+'. Пропуск не равен 0%.',
        {size:14,color:COLORS.muted,maxLines:2});
      }
    }

    // Dedicated quality comparison on the same 0–100 scale used by the WEB
    // chart. No connecting line across unavailable months; no zeros inserted.
    function qualityComparisonChart() {
      heading('Качество классификации: сравнение',
        'Два независимых KPI из текущего Report Snapshot. При отсутствии данных МБ линия ЦГПС прерывается.');
      const rows=plan.monthlyQuality;
      const hasValues=rows.some(row=>finite(row.overall)||finite(row.cgps));
      if(!rows.length || !hasValues) {
        paragraph('Для сравнения качества классификации нет достоверной месячной динамики. Отсутствие данных не считается нулём.', {color:COLORS.muted});
        return;
      }
      ensure(430);
      const ctx=current.ctx;
      const x=PAGE.marginX,chartY=y+44,height=310;
      const left=x+54,right=x+PAGE.contentWidth-20;
      const top=chartY+10,bottom=chartY+height-55;
      setFont(ctx,15,400,COLORS.muted);
      for(let tick=0;tick<=4;tick++) {
        const v=100-tick*25;
        const yy=top+(bottom-top)*tick/4;
        ctx.strokeStyle='#e2e8f0';
        ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(right,yy);ctx.stroke();
        ctx.textAlign='right';ctx.fillText(String(v),left-10,yy+5);
      }
      ctx.textAlign='left';
      const series=[
        ['overall','Качество классификации общее',COLORS.cyan],
        ['cgps','Качество классификации ЦГПС',COLORS.amber]
      ];
      const divisor=Math.max(1,rows.length-1);
      series.forEach(([field,label,color],seriesIndex)=>{
        const segments=qualitySegments(rows,field);
        ctx.strokeStyle=color;ctx.lineWidth=4;
        segments.forEach(segment=>{
          ctx.beginPath();
          segment.forEach((point,i)=>{
            const px=left+(right-left)*point.index/divisor;
            const py=bottom-(point.value/100)*(bottom-top);
            if(i===0)ctx.moveTo(px,py);
            else ctx.lineTo(px,py);
          });
          ctx.stroke();
          segment.forEach(point=>{
            const px=left+(right-left)*point.index/divisor;
            const py=bottom-(point.value/100)*(bottom-top);
            ctx.fillStyle=color;ctx.beginPath();ctx.arc(px,py,5,0,Math.PI*2);ctx.fill();
          });
        });
        const legendX=x+seriesIndex*540;
        ctx.fillStyle=color;ctx.fillRect(legendX,chartY-6,24,5);
        setFont(ctx,15,600,COLORS.ink);
        ctx.fillText(label,legendX+34,chartY);
      });
      const labelEvery=Math.max(1,Math.ceil(rows.length/7));
      setFont(ctx,13,400,COLORS.muted);
      rows.forEach((row,index)=>{
        if(index%labelEvery!==0&&index!==rows.length-1)return;
        const px=left+(right-left)*index/divisor;
        ctx.save();ctx.translate(px,bottom+24);ctx.rotate(-0.35);
        ctx.fillText(row.label||row.period||'',0,0);ctx.restore();
      });
      y=chartY+height+12;
      const unknown=rows.filter(row=>row.cgpsReason==='mb-coverage-unknown').length;
      paragraph(unknown
        ? 'ЦГПС: в '+formatNumber(unknown,0)+' мес. Dataset МБ недоступен. На графике это пропуски, а не 0%.'
        : 'Для каждого месяца показаны значения только при доступном расчёте. Пропуски не соединяются линией.',
        {size:15,color:COLORS.muted,maxLines:3});
    }

    function qualityDetails() {
      const results=QUALITY_KPIS.map(id=>plan.results.find(result=>result.id===id)).filter(Boolean);
      if(!results.length)return;
      heading('Качество классификации: состав расчёта',
        'Категории инженерной проверки ITSM Сириус и диагностические исключения МБ из текущего KPI Result.');
      for(const result of results) {
        const cgps=result.id==='classification_quality_cgps';
        const diagnostic=!cgps
          ? qualityDiagnosticFingerprint(result):null;
        const height=cgps?395:diagnostic?475:290;
        ensure(height+20);
        const ctx=current.ctx;
        const x=PAGE.marginX;
        roundRect(ctx,x,y,PAGE.contentWidth,height,14,COLORS.panel,COLORS.border);
        setFont(ctx,22,700,COLORS.ink);
        ctx.fillText(QUALITY_LABELS[result.id],x+22,y+32);
        const good=qualityValue(result);
        ctx.textAlign='right';
        setFont(ctx,22,700,good===null?COLORS.amber:COLORS.green);
        ctx.fillText(good===null?'—':formatMetric(good,'%'),PAGE.width-PAGE.marginX-22,y+32);
        ctx.textAlign='left';
        setFont(ctx,15,400,COLORS.muted);
        ctx.fillText(cgps
          ? 'A, B, C: есть в МБ — любой инициатор. D: есть в МБ — инициатор ЦГПС.'
          : 'A, B, C, D: все группы инициаторов, независимо от наличия заявки в МБ.',
          x+22,y+60);
        const values=result.components||{};
        const columns=QUALITY_COMPONENTS.map(([field,label],i)=>({
          label:cgps&&i===3?'D · RITM вместо INC (ЦГПС)':label,
          value:finite(values[field])?formatNumber(values[field],0):'—'
        }));
        const cell=(PAGE.contentWidth-44)/4;
        columns.forEach((item,i)=>{
          const xx=x+22+i*cell;
          roundRect(ctx,xx,y+78,cell-12,77,8,COLORS.white,COLORS.border);
          setFont(ctx,13,600,COLORS.muted);
          ctx.fillText(item.label,xx+10,y+101);
          setFont(ctx,25,700,COLORS.ink);
          ctx.fillText(item.value,xx+10,y+136);
        });
        const numerator=finite(values.classificationSuccessCount)
          ?formatNumber(values.classificationSuccessCount,0):'—';
        const denominator=finite(values.classificationTotalCount)
          ?formatNumber(values.classificationTotalCount,0):'—';
        setFont(ctx,16,700,COLORS.ink);
        ctx.fillText('A / (A + B + C + D) × 100 = '+numerator+' / '+denominator+' × 100'+
          (good===null?' → —':' = '+formatMetric(good,'%')),x+22,y+184);
        setFont(ctx,14,400,COLORS.muted);
        const basis=cgps
          ? 'ITSM Сириус.number ↔ МБ.request; только загруженные номера, без проверки дат.'
          : 'Источник: ITSM Сириус. «RITM без изм» в расчёт не входит.';
        ctx.fillText(basis,x+22,y+213);
        if(cgps) {
          const excluded=[
            ['Нет в МБ',values.excludedNoMbCount],
            ['Нет данных МБ',values.unknownMbCoverageCount],
            ['RITM иных инициаторов',values.excludedOtherInitiatorRitmCount]
          ];
          excluded.forEach(([label,count],index)=>{
            const xx=x+22+index*(PAGE.contentWidth-40)/3;
            setFont(ctx,14,600,COLORS.muted);
            ctx.fillText(label+': '+(finite(count)?formatNumber(count,0):'—'),xx,y+250);
          });
          const extra=[
            ['RITM без группы инициаторов',values.excludedUnknownInitiatorRitmCount],
            ['Нет номера ITSM',values.excludedMissingRequestCount]
          ];
          extra.forEach(([label,count],index)=>{
            const xx=x+22+index*(PAGE.contentWidth-40)/2;
            setFont(ctx,14,600,COLORS.muted);
            ctx.fillText(label+': '+(finite(count)?formatNumber(count,0):'—'),xx,y+281);
          });
          const message=result.reason==='mb-coverage-unknown'
            ? 'Итог недоступен: Dataset МБ отсутствует или недоступен. Сверка номеров заявок невозможна.'
            : result.reason==='classification-denominator-zero'
              ? 'Итог недоступен: нет обращений, соответствующих условиям расчёта.'
              : good===null?'Расчёт недоступен: '+text(result.reason||stateLabel(result.dataState))
                :'Данные МБ учитываются на момент создания Report Snapshot.';
          setFont(ctx,15,600,good===null?COLORS.amber:COLORS.muted);
          const messageLines=wrapLines(ctx,message,PAGE.contentWidth-48,2);
          drawLines(ctx,messageLines,x+22,y+318,20);
        } else {
          setFont(ctx,14,400,COLORS.muted);
          ctx.fillText('Проверка основана на итоговой категории; текст обращения не анализируется формулой KPI.',x+22,y+247);
          if(diagnostic){
            const counts=diagnostic.counters;
            setFont(ctx,16,700,COLORS.ink);
            ctx.fillText('Сверка ITSM и МБ · диагностические счётчики',x+22,y+277);
            const cells=[
              ['Всего ITSM (A+B+C+D)',counts.classifiedItsmCount],
              ['Один месяц ITSM/МБ',counts.bothSameMonthCount],
              ['Другой месяц МБ',counts.bothOtherMonthCount],
              ['Не найдено в выгрузке МБ',counts.itsmNotInLoadedMbCount],
              ['Покрытие МБ неизвестно',counts.itsmUnknownMbCoverageCount],
              ['Только в загруженной МБ',counts.mbOnlyLoadedCount]
            ];
            cells.forEach(([label,value],index)=>{
              const col=index%2,row=Math.floor(index/2);
              const xx=x+22+col*(PAGE.contentWidth-40)/2;
              setFont(ctx,13,500,COLORS.muted);
              ctx.fillText(label,xx,y+309+row*30);
              setFont(ctx,16,700,COLORS.ink);
              ctx.fillText(finite(value)?formatNumber(value,0):'—',
                xx+270,y+309+row*30);
            });
            setFont(ctx,14,500,COLORS.muted);
            const grouped=diagnostic.byInitiator;
            const top=grouped.slice(0,3).map(g=>
              g.label+': '+(finite(g.count)?formatNumber(g.count,0):'—')).join(' · ');
            const more=grouped.length>3?' · ещё '+(grouped.length-3)+' гр.':'';
            const lines=wrapLines(ctx,'Инициаторы: '+(top||'не определены')+
              more,PAGE.contentWidth-48,2);
            drawLines(ctx,lines,x+22,y+404,17);
            setFont(ctx,12,400,COLORS.muted);
            const note=diagnostic.mbPresent
              ?'Отсутствие номера в загруженной МБ не доказывает его отсутствия в корпоративной системе.'
              :'Dataset МБ недоступен: совпадения с МБ не подтверждены.';
            drawLines(ctx,wrapLines(ctx,note,PAGE.contentWidth-48,2),x+22,y+446,15);
          }
        }
        y+=height+16;
      }
      paragraph('Дата учёта: выполнение обращения; если дата отсутствует или непригодна — закрытие. За диапазон месяцев используется отношение сумм, а не среднее процентов.',
        {size:15,color:COLORS.muted,maxLines:3});
    }

    function barRows(items, title, subtitle, valueFormatter, colorForItem = null) {
      heading(title, subtitle);
      if (!items.length) {
        paragraph('Данные для выбранного среза отсутствуют.', { color: COLORS.muted });
        return;
      }

      const max = Math.max(1, ...items.map(item => Math.max(0, Number(item.hours ?? item.laborHours ?? item.count ?? 0))));
      for (const item of items) {
        ensure(76);
        const ctx = current.ctx;
        const raw = Number(item.hours ?? item.laborHours ?? item.count ?? 0);
        const value = Number.isFinite(raw) ? raw : 0;
        const share = Math.max(0, Math.min(1, value / max));
        setFont(ctx, 17, 600, COLORS.ink);
        const titleLines = wrapLines(ctx, item.title || item.id || '—', 510, 1);
        ctx.fillText(titleLines[0] || '—', PAGE.marginX, y + 21);
        setFont(ctx, 16, 600, COLORS.muted);
        ctx.textAlign = 'right';
        ctx.fillText(valueFormatter(item), PAGE.width - PAGE.marginX, y + 21);
        ctx.textAlign = 'left';

        roundRect(ctx, PAGE.marginX, y + 36, PAGE.contentWidth, 14, 7, '#e2e8f0');
        roundRect(ctx, PAGE.marginX, y + 36, Math.max(8, PAGE.contentWidth * share), 14, 7,
          typeof colorForItem === 'function' ? colorForItem(item) : COLORS.brand);
        y += 70;
      }
      gap(8);
    }

    // Match the WEB legend: category color is stable across filters and order.
    function laborCategoryColor(title) {
      const value=String(title||'').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').trim();
      if (/то\s+вне\s+графика|внепланов(?:ое|ый)\s+то/.test(value)) return '#2c9b80';
      if (/то\s+по\s+графику|планов(?:ое|ый)\s+то/.test(value)) return '#277da1';
      if (/^авр$|аварийно.восстановитель/.test(value)) return '#d65b55';
      if (/зно|монтаж|перенос/.test(value)) return '#b28a41';
      if (/корректирующ/.test(value)) return '#7b61a3';
      return '#88939d';
    }

    function laborBreakdown() {
      barRows(
        plan.labor,
        'Структура трудозатрат',
        'Фактическая трудоёмкость МБ по итоговому типу задачи.',
        item => formatMetric(Number(item.hours || 0), 'чел.-ч') +
          (finite(item.share) ? ' · ' + formatNumber(item.share) + '%' : ''),
        item => laborCategoryColor(item.title)
      );
      const names={
        total_labor:'Общая трудоёмкость',
        avr_labor:'Трудоёмкость АВР',
        maintenance_labor:'Плановое ТО',
        corrective_labor:'Корректирующие работы'
      };
      for(const [id,label] of Object.entries(names)){
        const f=plan.forecastLabor[id];
        if(f?.forecastType!=='reporting-month-volume-nowcast'||
           f.dataState!=='available'||!finite(f.value))continue;
        paragraph(label+' ('+f.horizon+'): факт '+
          formatMetric(f.observedValue,'чел.-ч')+' по '+
          formatDate(f.coverageThrough)+
          '; прогноз итога '+formatMetric(f.value,'чел.-ч')+
          '. Метод '+f.methodId+' v'+f.methodVersion+
          '. Экспериментальный прогноз, не факт.',{
            size:15,color:COLORS.muted,maxLines:3
          });
      }
    }

    function problemBreakdown() {
      barRows(
        plan.problemManagement,
        'Управление проблемами',
        'Задачи МБ сгруппированы по состоянию связи с ИТ-проблемами.',
        item => formatNumber(Number(item.count || 0), 0) + ' задач · ' +
          formatMetric(Number(item.laborHours || 0), 'чел.-ч')
      );
    }

    function managementChartsPdf() {
      // Eight factual charts already materialized into Report Snapshot by the
      // same prepared rows used by KPI Calculator. Never re-query source data.
      for(const chart of plan.problemCharts){
        const rows=Array.from(chart.items||[]);
        const available=rows.filter(item=>finite(item.value));
        barRows(available.map(item=>({title:item.label,hours:item.value})),
          chart.title,chart.description||'По данным выбранного отчётного среза.',
          item=>formatMetric(item.hours,chart.unit||''));
        const gaps=rows.length-available.length;
        if(gaps)paragraph('Недоступно значений: '+gaps+
          '. Пропуски данных не считаются нулём.',
          {size:14,color:COLORS.muted,maxLines:2});
      }
    }

    function kpiDetails() {
      heading('Паспорта рассчитанных KPI', 'Формула, компоненты и состояние результата. PDF не выполняет повторный расчёт.');
      for (const result of plan.results) {
        // Quality KPIs receive a dedicated, legible A/B/C/D table above;
        // do not repeat their values as clipped generic component strings.
        if (QUALITY_KPIS.includes(result.id)) continue;
        const baseHeight = 160;
        ensure(baseHeight);
        const ctx = current.ctx;
        roundRect(ctx, PAGE.marginX, y, PAGE.contentWidth, baseHeight, 14, COLORS.panel, COLORS.border);
        setFont(ctx, 20, 700, COLORS.ink);
        ctx.fillText(result.title || result.id, PAGE.marginX + 20, y + 30);

        setFont(ctx, 16, 600, result.dataState === 'available' ? COLORS.green : stateColor(result.dataState));
        ctx.textAlign = 'right';
        ctx.fillText(
          result.dataState === 'available' && finite(result.value)
            ? formatMetric(result.value, result.unit)
            : stateLabel(result.dataState),
          PAGE.width - PAGE.marginX - 20,
          y + 30
        );
        ctx.textAlign = 'left';

        setFont(ctx, 15, 400, COLORS.muted);
        const formulaLines = wrapLines(ctx, 'Формула: ' + (result.formula || 'Не определена'), PAGE.contentWidth - 40, 2);
        drawLines(ctx, formulaLines, PAGE.marginX + 20, y + 62, 22, COLORS.muted);
        const comp = Object.entries(result.components || {})
          .map(([name, value]) => name + '=' + (finite(value) ? formatNumber(value) : text(value) || '—'))
          .join('; ');
        const componentLines = wrapLines(ctx, 'Компоненты: ' + (comp || 'нет'), PAGE.contentWidth - 40, 2);
        drawLines(ctx, componentLines, PAGE.marginX + 20, y + 110, 22, COLORS.muted);

        y += baseHeight + 14;
      }
    }

    function sources() {
      heading('Источники и трассировка', 'Версии и ревизии источников, зафиксированные в текущем Report Snapshot.');
      if (!plan.sources.length) {
        paragraph('Источники в Snapshot отсутствуют.', { color: COLORS.muted });
        return;
      }

      for (const source of plan.sources) {
        ensure(126);
        const ctx = current.ctx;
        roundRect(ctx, PAGE.marginX, y, PAGE.contentWidth, 112, 12, COLORS.white, COLORS.border);
        setFont(ctx, 18, 700, COLORS.ink);
        ctx.fillText(source.id || 'source', PAGE.marginX + 18, y + 28);

        setFont(ctx, 14, 600, source.available ? COLORS.green : COLORS.red);
        ctx.textAlign = 'right';
        ctx.fillText(source.available ? 'доступен' : 'нет источника', PAGE.width - PAGE.marginX - 18, y + 28);
        ctx.textAlign = 'left';

        setFont(ctx, 14, 400, COLORS.muted);
        const details = [
          'schema ' + (source.schemaVersion || '—'),
          source.activeRevision !== null && source.activeRevision !== undefined ? 'revision ' + source.activeRevision : null,
          source.freshness ? 'freshness ' + formatDate(source.freshness) : null,
          Number.isFinite(Number(source.rowCount)) ? 'rows ' + formatNumber(Number(source.rowCount), 0) : null,
          source.validationStatus ? 'validation ' + source.validationStatus : null,
          source.dependencyStatus ? 'dependency ' + source.dependencyStatus : null,
          source.reportingCoverage?.status==='confirmed'
            ? 'подтверждённый интервал '+source.reportingCoverage.coverageFrom+
              ' — '+source.reportingCoverage.coverageThrough
            : null
        ].filter(Boolean).join(' · ');
        const lines = wrapLines(ctx, details, PAGE.contentWidth - 36, 2);
        drawLines(ctx, lines, PAGE.marginX + 18, y + 58, 21, COLORS.muted);
        y += 126;
      }

      ensure(120);
      const ctx = current.ctx;
      roundRect(ctx, PAGE.marginX, y, PAGE.contentWidth, 96, 12, COLORS.panelStrong);
      setFont(ctx, 15, 600, COLORS.muted);
      ctx.fillText('РАСЧЁТНЫЙ КОНТУР', PAGE.marginX + 18, y + 26);
      setFont(ctx, 17, 600, COLORS.ink);
      ctx.fillText(
        'Preparation ' + (plan.preparationVersion || '—') +
        ' · Calculator ' + (plan.calculatorVersion || '—') +
        ' · PDF Renderer ' + PDF_VERSION,
        PAGE.marginX + 18,
        y + 58
      );
      setFont(ctx, 14, 400, COLORS.muted);
      ctx.fillText('WEB и PDF используют один Report Snapshot: ' + plan.fingerprint, PAGE.marginX + 18, y + 82);
      y += 116;
    }

    newPage();
    snapshotSummary();
    kpiCards();
    lineChart();
    // Detailed A/B/C/D quality calculations are retained, without the
    // duplicate two-line classification chart on the report overview.
    qualityDetails();
    laborBreakdown();
    // PR13 overview has one factual task/PRB linkage chart. PR14 will
    // introduce the agreed eight-column aggregation without guessed metrics.
    problemBreakdown();
    kpiDetails();
    sources();

    const totalPages = pages.length;
    pages.forEach((page, index) => drawPageChrome(page, plan, index + 1, totalPages));
    return pages.map(page => page.canvas);
  }

  function blobFromCanvas(canvas, type = 'image/jpeg', quality = 0.9) {
    return new Promise((resolve, reject) => {
      if (typeof canvas.toBlob !== 'function') {
        reject(new Error('Canvas JPEG encoding is unavailable.'));
        return;
      }
      canvas.toBlob(blob => {
        if (!blob) reject(new Error('Canvas JPEG encoding returned no data.'));
        else resolve(blob);
      }, type, quality);
    });
  }

  function ascii(value) {
    return new TextEncoder().encode(String(value));
  }

  function concatBytes(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.length;
    }
    return output;
  }

  function pdfStream(dictionary, data) {
    return concatBytes([
      ascii('<< ' + dictionary + ' /Length ' + data.length + ' >>\nstream\n'),
      data,
      ascii('\nendstream')
    ]);
  }

  function buildPdfBytes(jpegPages, options = {}) {
    if (!Array.isArray(jpegPages) || !jpegPages.length) {
      throw new Error('At least one JPEG page is required.');
    }

    const fingerprint = text(options.fingerprint || 'unknown').replace(/[^0-9a-f]/gi, '').slice(0, 32) || 'unknown';
    const objects = new Map();
    const pageObjectNumbers = [];

    objects.set(1, ascii('<< /Type /Catalog /Pages 2 0 R >>'));

    let objectNumber = 3;
    jpegPages.forEach((page, index) => {
      const pageObject = objectNumber++;
      const imageObject = objectNumber++;
      const contentObject = objectNumber++;
      pageObjectNumbers.push(pageObject);

      const imageName = 'Im' + String(index + 1);
      const content = ascii(
        'q\n595.28 0 0 841.89 0 0 cm\n/' + imageName + ' Do\nQ'
      );
      objects.set(
        pageObject,
        ascii(
          '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] ' +
          '/Resources << /XObject << /' + imageName + ' ' + imageObject + ' 0 R >> >> ' +
          '/Contents ' + contentObject + ' 0 R >>'
        )
      );
      objects.set(
        imageObject,
        pdfStream(
          '/Type /XObject /Subtype /Image /Width ' + page.width +
          ' /Height ' + page.height +
          ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode',
          page.bytes
        )
      );
      objects.set(contentObject, pdfStream('', content));
    });

    objects.set(
      2,
      ascii(
        '<< /Type /Pages /Count ' + pageObjectNumbers.length +
        ' /Kids [' + pageObjectNumbers.map(number => number + ' 0 R').join(' ') + '] >>'
      )
    );

    const objectCount = objectNumber - 1;
    const header = concatBytes([
      ascii('%PDF-1.4\n'),
      new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]),
      ascii('% ReclassifierSnapshot: ' + fingerprint + '\n')
    ]);

    const parts = [header];
    const offsets = new Array(objectCount + 1).fill(0);
    let offset = header.length;

    for (let number = 1; number <= objectCount; number += 1) {
      const body = objects.get(number);
      if (!body) throw new Error('Missing PDF object ' + number + '.');
      const wrapped = concatBytes([
        ascii(number + ' 0 obj\n'),
        body,
        ascii('\nendobj\n')
      ]);
      offsets[number] = offset;
      parts.push(wrapped);
      offset += wrapped.length;
    }

    const xrefOffset = offset;
    const xref = [
      'xref\n0 ' + (objectCount + 1) + '\n',
      '0000000000 65535 f \n'
    ];
    for (let number = 1; number <= objectCount; number += 1) {
      xref.push(String(offsets[number]).padStart(10, '0') + ' 00000 n \n');
    }
    xref.push(
      'trailer\n<< /Size ' + (objectCount + 1) + ' /Root 1 0 R >>\n' +
      'startxref\n' + xrefOffset + '\n%%EOF\n'
    );
    parts.push(ascii(xref.join('')));
    return concatBytes(parts);
  }

  async function renderInner(snapshot, options = {}) {
    const plan = createPlan(snapshot);
    const canvases = createFlowDocument(plan);
    const jpegPages = [];
    for (const canvas of canvases) {
      const blob = await blobFromCanvas(canvas);
      jpegPages.push({
        width: canvas.width,
        height: canvas.height,
        bytes: new Uint8Array(await blob.arrayBuffer())
      });
      // Progress is tied only to successfully encoded pages, not a timer.
      options.onProgress?.(Object.freeze({
        stage: 'encode', completed: jpegPages.length,
        total: canvases.length,
        percent: Math.floor(jpegPages.length / canvases.length * 95)
      }));
    }

    const bytes = buildPdfBytes(jpegPages, { fingerprint: plan.fingerprint });
    options.onProgress?.(Object.freeze({
      stage: 'complete', completed: jpegPages.length,
      total: canvases.length, percent: 100
    }));
    const blob = new Blob([bytes], { type: 'application/pdf' });
    return Object.freeze({
      blob,
      bytes: bytes.length,
      pageCount: jpegPages.length,
      fingerprint: plan.fingerprint,
      filename: fileName(snapshot, plan.fingerprint),
      queryLabel: plan.queryLabel
    });
  }

  async function render(snapshot, options = {}) {
    const profiler=globalThis.ReclassifierPerformanceProfiler;
    const run=()=>renderInner(snapshot,options);
    return profiler ? profiler.measureAsync('pdf.render.total',run) : run();
  }

  async function download(snapshot, options = {}) {
    const result = await render(snapshot,options);
    if (typeof document === 'undefined' || typeof URL === 'undefined') {
      throw new Error('PDF download requires a browser environment.');
    }
    const url = URL.createObjectURL(result.blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.filename;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }
    return result;
  }

  const api = Object.freeze({
    version: PDF_VERSION,
    snapshotFingerprint,
    fileName,
    createPlan,
    qualityMonthlyData,
    qualitySegments,
    buildPdfBytes,
    render,
    download
  });

  globalThis.ReclassifierReliabilityPdfRenderer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
