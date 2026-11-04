// Read-only XLSX writer for period-filtered Full Dataset rows.
// No classification rules or database writes are performed in this Worker.
(() => {
  'use strict';

  const DATE_HEADERS = new Set([
    'Дата создания Вызова', 'Дата выполнения обращения', 'Дата закрытия',
    'Фактическая дата', 'Дата запроса', 'Дата создания вызова ITSM'
  ]);

  function asExcelDate(value) {
    if (value == null || value === '') return value;
    if (Object.prototype.toString.call(value) === '[object Date]') {
      return Number.isNaN(value.getTime()) ? '' : value;
    }
    // Dates stored as Excel serials must remain dates, not displayed serial numbers.
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 1 || value > 2958465) return value;
      const parsed = globalThis.XLSX?.SSF?.parse_date_code?.(value);
      if (!parsed) return value;
      const decoded = new Date(parsed.y, parsed.m - 1, parsed.d,
        parsed.H || 0, parsed.M || 0, Math.floor(parsed.S || 0));
      return Number.isNaN(decoded.getTime()) ? value : decoded;
    }
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    const local = trimmed.match(/^(\d{4})-(\d\d)-(\d\d)(?:[T ](\d\d):(\d\d)(?::(\d\d))?)?$/);
    const ru = trimmed.match(/^(\d\d)\.(\d\d)\.(\d{4})(?:[ T](\d\d):(\d\d)(?::(\d\d))?)?$/);
    const parts = local ? [
      Number(local[1]), Number(local[2]), Number(local[3]),
      Number(local[4] || 0), Number(local[5] || 0), Number(local[6] || 0)
    ] : ru ? [
      Number(ru[3]), Number(ru[2]), Number(ru[1]),
      Number(ru[4] || 0), Number(ru[5] || 0), Number(ru[6] || 0)
    ] : null;
    let date;
    if (parts) {
      date = new Date(...[parts[0],parts[1]-1,parts[2],parts[3],parts[4],parts[5]]);
      if (date.getFullYear()!==parts[0] || date.getMonth()!==parts[1]-1 ||
          date.getDate()!==parts[2]) return value;
    } else if (/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/i.test(trimmed)) {
      date = new Date(trimmed);
    } else return value;
    return Number.isNaN(date.getTime()) ? value : date;
  }

  function columnDateFlags(columns) {
    return columns.map(label => DATE_HEADERS.has(String(label || '').trim()));
  }

  // XLSX does not permit more than 32767 UTF-16 characters in one cell.
  // The primary sheet keeps its original columns and first text fragment;
  // every continuation is saved in a separate sheet, never silently lost.
  const EXCEL_CELL_TEXT_LIMIT = 32767;
  function excelTextBoundary(value, start) {
    let end = Math.min(value.length, start + EXCEL_CELL_TEXT_LIMIT);
    // Do not split a Unicode surrogate pair, which could corrupt XML.
    if (end < value.length && end > start) {
      const last = value.charCodeAt(end - 1);
      if (last >= 0xD800 && last <= 0xDBFF) end--;
    }
    return end;
  }

  function preserveExcelText(value, rowIndex, colIndex, columns, addOverflow) {
    if (typeof value !== 'string' || value.length <= EXCEL_CELL_TEXT_LIMIT) return value;
    let start = 0;
    let part = 1;
    let first = '';
    while (start < value.length) {
      const end = excelTextBoundary(value, start);
      const fragment = value.slice(start, end);
      if (part === 1) first = fragment;
      else addOverflow([
        rowIndex + 2, colIndex + 1, columns[colIndex], part, fragment
      ]);
      start = end;
      part++;
    }
    return first;
  }

  function normalizedChunk(chunk, dateFlags, columns, startRow = 0, addOverflow = () => {}) {
    return chunk.map((row, localIndex) => row.map((value, index) => {
      const converted = dateFlags[index] ? asExcelDate(value) : value;
      return preserveExcelText(converted, startRow + localIndex, index, columns, addOverflow);
    }));
  }

  function process(payload, reportProgress = () => {}) {
    if (!globalThis.XLSX?.utils || typeof globalThis.XLSX.write !== 'function') {
      throw new Error('SheetJS не подключён к WebWorker экспорта.');
    }
    const columns = payload?.columns;
    const rows = payload?.rows;
    const sheetName = payload?.sheetName;
    if (!Array.isArray(columns) || !columns.length ||
        !Array.isArray(rows) || !rows.length ||
        !columns.every(value => typeof value === 'string')) {
      throw new Error('Нет корректных строк или заголовков Full Dataset для Excel.');
    }
    if (!['ITSM', 'Мобильные бригады'].includes(sheetName)) {
      throw new Error('Неизвестный модуль выгрузки Excel.');
    }
    if (rows.length > 1048575) {
      throw new Error('Превышен лимит Excel: 1 048 575 строк данных.');
    }
    const width = columns.length;
    const dateFlags = columnDateFlags(columns);
    const overflowHeaders = [
      'Строка на основном листе', 'Номер колонки', 'Название колонки',
      'Номер части текста', 'Продолжение текста'
    ];
    let overflowSheet = null;
    let overflowBuffered = [];
    let overflowParts = 0;
    let overflowCells = 0;
    let lastOverflowCell = '';
    function flushOverflow() {
      if (!overflowBuffered.length) return;
      globalThis.XLSX.utils.sheet_add_aoa(overflowSheet, overflowBuffered, {
        origin: {r:overflowParts - overflowBuffered.length + 1,c:0}
      });
      overflowBuffered = [];
    }
    function addOverflow(part) {
      if (!overflowSheet) {
        overflowSheet = globalThis.XLSX.utils.aoa_to_sheet([overflowHeaders]);
      }
      const cellId = part[0] + ':' + part[1];
      if (cellId !== lastOverflowCell) {
        overflowCells++;
        lastOverflowCell = cellId;
      }
      overflowParts++;
      if (overflowParts > 1048575) {
        throw new Error('Слишком много частей длинных текстов для одного XLSX. ' +
          'Выберите более короткий период.');
      }
      overflowBuffered.push(part);
      if (overflowBuffered.length >= 500) flushOverflow();
    }
    for (let index = 0; index < rows.length; index += 1) {
      if (!Array.isArray(rows[index]) || rows[index].length !== width) {
        throw new Error('Full Dataset содержит некорректную строку ' + (index + 1) + '.');
      }
    }

    reportProgress({ percent: 5, label: 'Подготовка Excel' });
    // SheetJS needs cell objects in memory, but the extra all-rows AOA
    // temporarily duplicates the entire workbook. Append chunks instead.
    const chunkSize = 2000;
    let sheet;
    if (rows.length > chunkSize) {
      if (typeof globalThis.XLSX.utils.sheet_add_aoa !== 'function') {
        throw new Error('SheetJS не поддерживает построчную сборку большого XLSX.');
      }
      sheet = globalThis.XLSX.utils.aoa_to_sheet([columns], { cellDates: true });
      for (let offset = 0; offset < rows.length; offset += chunkSize) {
        globalThis.XLSX.utils.sheet_add_aoa(
          sheet,
          normalizedChunk(rows.slice(offset, offset + chunkSize), dateFlags,
            columns, offset, addOverflow),
          { origin: { r: offset + 1, c: 0 }, cellDates: true }
        );
        reportProgress({
          percent: 5 + Math.round(Math.min(rows.length, offset + chunkSize) / rows.length * 45),
          label: 'Подготовка Excel'
        });
      }
    } else {
      sheet = globalThis.XLSX.utils.aoa_to_sheet([
        columns, ...normalizedChunk(rows, dateFlags, columns, 0, addOverflow)
      ], { cellDates: true });
    }
    sheet['!autofilter'] = {
      ref: 'A1:' + globalThis.XLSX.utils.encode_cell({
        r: rows.length, c: width - 1
      })
    };
    sheet['!cols'] = columns.map(value => ({
      wch: Math.min(46, Math.max(11, value.length + 2))
    }));
    reportProgress({ percent: 55, label: 'Запись Excel' });
    const workbook = globalThis.XLSX.utils.book_new();
    globalThis.XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
    if (overflowSheet) {
      flushOverflow();
      overflowSheet['!cols'] = [{wch:20},{wch:16},{wch:38},{wch:20},{wch:70}];
      globalThis.XLSX.utils.book_append_sheet(
        workbook, overflowSheet, 'Продолжения текстов'
      );
    }
    const written = globalThis.XLSX.write(workbook, {
      bookType: 'xlsx',
      type: 'array',
      compression: true,
      bookSST: false
    });
    const bytes = written instanceof ArrayBuffer
      ? written
      : (ArrayBuffer.isView(written)
        ? written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength)
        : null);
    if (!bytes) throw new Error('SheetJS не смог сформировать XLSX.');
    reportProgress({ percent: 100, label: 'Готово' });
    return {
      bytes, rows: rows.length, columns: width,
      longTextCells: overflowCells, overflowParts
    };
  }

  // A single workbook assembled from bounded batches sent by SQLite.
  // The output is ONE XLSX, even if the database reader uses many batches.
  // SheetJS still holds the worksheet until XLSX.write, so large exports
  // remain memory-intensive; dense storage avoids sparse address overhead.
  function createStream({columns, sheetName}, reportDiagnostic = () => {}) {
    function trace(phase, event, values = {}) {
      try {
        const bytes = typeof performance !== 'undefined'
          ? performance.memory?.usedJSHeapSize : undefined;
        const memory = Number.isFinite(bytes) && bytes >= 0
          ? {workerJsHeapMiB:Math.round(bytes / 1048576 * 100) / 100} : {};
        reportDiagnostic(phase, event, {...values, ...memory});
      } catch (_) { /* Diagnostics must not disrupt the XLSX contract. */ }
    }
    if (!globalThis.XLSX?.utils?.sheet_add_aoa ||
        typeof globalThis.XLSX.write !== 'function') {
      throw new Error('SheetJS не поддерживает пакетный экспорт XLSX.');
    }
    if (!Array.isArray(columns) || !columns.length ||
        !columns.every(value => typeof value === 'string') ||
        !['ITSM','Мобильные бригады'].includes(sheetName)) {
      throw new Error('Некорректные колонки или лист XLSX.');
    }
    const utils = globalThis.XLSX.utils;
    const dateFlags = columnDateFlags(columns);
    const sheet = utils.aoa_to_sheet([columns], {dense:true, cellDates:true});
    const overflowHeaders = [
      'Строка на основном листе','Номер колонки','Название колонки',
      'Номер части текста','Продолжение текста'
    ];
    let extra = null, extraPending = [], extraCount = 0;
    let longCells = 0, lastCell = '';
    let count = 0, closed = false;
    function flushExtra() {
      if (!extraPending.length) return;
      utils.sheet_add_aoa(extra, extraPending, {
        origin:{r:extraCount-extraPending.length+1,c:0},cellDates:true
      });
      extraPending = [];
    }
    function addExtra(row) {
      if (!extra) extra=utils.aoa_to_sheet([overflowHeaders],{dense:true});
      if (extraCount >= 1048575) {
        throw new Error('Превышен лимит Excel для продолжений длинных текстов.');
      }
      const key=row[0]+':'+row[1];
      if (key!==lastCell) { longCells++; lastCell=key; }
      extraCount++;
      extraPending.push(row);
      if(extraPending.length>=500) flushExtra();
    }
    function append(rows) {
      if (closed) throw new Error('Экспорт XLSX уже завершён.');
      const appendStarted = Date.now();
      trace('xlsx-worker-append','start',{batchRows:Array.isArray(rows) ? rows.length : 0,
        totalRows:count, totalCells:count*columns.length});
      if (!Array.isArray(rows) || rows.length > 10000) {
        throw new Error('Некорректная партия XLSX (максимум 10 000 строк внутри Worker).');
      }
      if (count+rows.length > 1048575) {
        throw new Error('Один лист Excel допускает не более 1 048 575 строк данных.');
      }
      const chunk=2000;
      for(let i=0;i<rows.length;i+=chunk) {
        const piece=rows.slice(i,i+chunk);
        for(const row of piece) {
          if (!Array.isArray(row) || row.length!==columns.length) {
            throw new Error('Неверная ширина строки Full Dataset.');
          }
        }
        utils.sheet_add_aoa(sheet,normalizedChunk(
          piece,dateFlags,columns,count+i,addExtra
        ),{origin:{r:count+i+1,c:0},cellDates:true});
      }
      count+=rows.length;
      trace('xlsx-worker-append','end',{batchRows:rows.length, totalRows:count,
        totalCells:count*columns.length, durationMs:Math.max(0,Date.now()-appendStarted),
        longTextCells:longCells, overflowParts:extraCount});
      return count;
    }
    function finish(reportProgress=()=>{}) {
      if (closed) throw new Error('Экспорт XLSX уже завершён.');
      const finalizeStarted = Date.now();
      trace('xlsx-worker-finalize','start',{totalRows:count,totalCells:count*columns.length,
        longTextCells:longCells, overflowParts:extraCount});
      closed=true;
      if(!count) throw new Error('За выбранный период не найдено строк XLSX.');
      sheet['!autofilter']={
        ref:'A1:'+utils.encode_cell({r:count,c:columns.length-1})
      };
      sheet['!cols']=columns.map(c=>({wch:Math.min(46,Math.max(11,c.length+2))}));
      reportProgress({label:'Формирование единого XLSX',percent:90});
      const workbook=utils.book_new();
      utils.book_append_sheet(workbook,sheet,sheetName);
      if(extra) {
        flushExtra();
        extra['!cols']=[{wch:20},{wch:16},{wch:38},{wch:20},{wch:70}];
        utils.book_append_sheet(workbook,extra,'Продолжения текстов');
      }
      trace('xlsx-worker-serialize','start',{totalRows:count,totalCells:count*columns.length,
        longTextCells:longCells,overflowParts:extraCount});
      const writeStarted = Date.now();
      const written=globalThis.XLSX.write(workbook,{
        bookType:'xlsx',type:'array',compression:true,bookSST:false
      });
      const bytes=written instanceof ArrayBuffer ? written:
        ArrayBuffer.isView(written)
          ? written.buffer.slice(written.byteOffset,written.byteOffset+written.byteLength)
          : null;
      if(!bytes) throw new Error('Не удалось сформировать XLSX.');
      trace('xlsx-worker-serialize','end',{totalRows:count,
        outputBytes:bytes.byteLength,durationMs:Math.max(0,Date.now()-writeStarted)});
      trace('xlsx-worker-finalize','end',{totalRows:count,
        outputBytes:bytes.byteLength,durationMs:Math.max(0,Date.now()-finalizeStarted)});
      reportProgress({label:'Готово',percent:100});
      return {bytes,rows:count,columns:columns.length,
        longTextCells:longCells,overflowParts:extraCount};
    }
    return Object.freeze({append,finish});
  }

  globalThis.ReclassifierDatasetExportWorkerProcessor = Object.freeze({ process, asExcelDate, createStream });
})();
