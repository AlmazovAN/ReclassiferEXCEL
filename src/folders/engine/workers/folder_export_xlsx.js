// Streaming OOXML for the generated folder exports. Keep compressed parts,
// without materializing a SheetJS cell object or an XML string for every row.
(() => {
  'use strict';

  const xmlHeader='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const main='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const relation='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const packageRelation='http://schemas.openxmlformats.org/package/2006/relationships';
  const encoder=new TextEncoder();
  const mib=1048576;
  const localLimits=globalThis.ReclassifierLocalExportLimits;
  const maxBytes=localLimits?.maxBytes??192*mib;
  const maxPart=localLimits?.maxPart??160*mib;
  const maxExpanded=localLimits?.maxExpanded??1024*mib;
  const crcTable=Uint32Array.from({length:256},(_,index)=>{
    let value=index;
    for(let bit=0;bit<8;bit++) value=(value>>>1)^((value&1)?0xedb88320:0);
    return value;
  });

  function xml(value) {
    return String(value).replace(/_x[\da-f]{4}_/gi,match=>'_x005F_'+match.slice(1))
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,
        char=>'_x'+char.charCodeAt(0).toString(16).padStart(4,'0')+'_')
      .replace(/[&<>"\r]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\r':'&#13;'})[char]);
  }

  function cell(value,address,sheetName) {
    if(value==null) return '';
    if(typeof value==='number' && Number.isFinite(value)) return '<c r="'+address+'"><v>'+value+'</v></c>';
    if(typeof value==='boolean') return '<c r="'+address+'" t="b"><v>'+Number(value)+'</v></c>';
    if(value instanceof Date && Number.isFinite(value.getTime())) {
      return '<c r="'+address+'" s="1"><v>'+(value.getTime()/86400000+25569)+'</v></c>';
    }
    if(typeof value!=='string' || value.length>32767) {
      const reason=typeof value==='string'?'текст длиннее 32 767 символов':'неподдерживаемое значение Excel';
      throw new Error('Лист «'+sheetName+'», ячейка '+address+' — '+reason+'.');
    }
    return '<c r="'+address+'" t="inlineStr"><is><t'+(/^\s|\s$/.test(value)?' xml:space="preserve"':'')+
      '>'+xml(value)+'</t></is></c>';
  }

  // Генерируем XML порциями из строк. В памяти одновременно строится небольшой фрагмент листа.
  async function* sheetXml(sheet,onRows) {
    const columns=Array.from({length:sheet.width},(_,i)=>globalThis.XLSX.utils.encode_col(i));
    const end=columns.at(-1)+(sheet.count||1);
    yield xmlHeader+'<worksheet xmlns="'+main+'"><dimension ref="A1:'+end+'"/><sheetData>';
    let count=0,chunk='';
    const interval=Math.max(1,Math.ceil((sheet.count-1)/100));
    for await(const row of sheet.rows()) {
      const index=++count;
      if(index>1048576 || row.length>columns.length) throw new Error('Превышен диапазон листа '+sheet.name+'.');
      let line='<row r="'+index+'">';
      for(let i=0;i<row.length;i++) {
        if(row[i]!=null) line+=cell(row[i],columns[i]+index,sheet.name);
      }
      chunk+=line+'</row>';
      if(onRows&&index>1&&(index-1)%interval===0) onRows(index-1,sheet.count-1);
      if(chunk.length>=65536){yield chunk;chunk='';}
    }
    if(count!==sheet.count) throw new Error('Не совпало число строк листа '+sheet.name+'.');
    yield chunk+'</sheetData>'+(sheet.filter?'<autoFilter ref="A1:'+end+'"/>':'')+'</worksheet>';
  }

  // Сжимаем фрагменты и считаем CRC несжатого XML для ZIP и служебного индекса.
  async function compress(parts, partLimit) {
    let stream;
    try { stream=new CompressionStream('deflate-raw'); }
    catch (_) { throw new Error('Для формирования XLSX нужен браузер с поддержкой deflate-raw.'); }
    const writer=stream.writable.getWriter();
    const chunks=[];
    const nativeCrc=localLimits?.crc32;
    let size=0,rawSize=0,crc=nativeCrc?0:0xffffffff;
    const read=(async()=>{
      const reader=stream.readable.getReader();
      try {
        for(;;) {
          const {done,value}=await reader.read();
          if(done) break;
          chunks.push(value);
          size+=value.length;
        }
      } finally {reader.releaseLock();}
    })();
    // Attach a rejection handler while the producer is still writing.
    read.catch(()=>{});
    try {
      for await(const part of parts) {
        const bytes=encoder.encode(part);
        rawSize+=bytes.length;
        if(rawSize>partLimit) throw new Error('Лист XLSX превышает безопасный размер распаковки.');
        if(nativeCrc) crc=nativeCrc(bytes,crc);
        else for(const byte of bytes) crc=(crc>>>8)^crcTable[(crc^byte)&255];
        await writer.write(bytes);
      }
      await writer.close();
      await read;
      return {chunks,size,rawSize,crc:nativeCrc?crc:(crc^0xffffffff)>>>0};
    } catch(error) {
      try {await writer.abort(error);} catch (_) {}
      try {await read;} catch (_) {}
      throw error;
    }
  }

  function header(size,signature,words,ints,name) {
    const bytes=new Uint8Array(size+(name?.length||0));
    const dv=new DataView(bytes.buffer);
    dv.setUint32(0,signature,true);
    for(const [offset,value] of words) dv.setUint16(offset,value,true);
    for(const [offset,value] of ints) dv.setUint32(offset,value,true);
    if(name) bytes.set(name,size);
    return bytes;
  }

  // Собираем XLSX из сжатых частей. Размер всего распакованного XML не равен размеру буферов записи.
  async function write(sheets,onProgress=()=>{},onRows) {
    const locals=[],directory=[];
    let offset=0,expanded=0;
    async function add(path,parts,partLimit=maxPart) {
      const name=encoder.encode(path);
      const part=await compress(parts,partLimit);
      expanded+=part.rawSize;
      const local=header(30,0x04034b50,[[4,20],[8,8],[12,33],[26,name.length]],
        [[14,part.crc],[18,part.size],[22,part.rawSize]],name);
      directory.push(header(46,0x02014b50,[[4,20],[6,20],[10,8],[14,33],[28,name.length]],
        [[16,part.crc],[20,part.size],[24,part.rawSize],[42,offset]],name));
      offset+=local.length+part.size;
      if(offset>maxBytes || expanded>maxExpanded) {
        throw new Error('Превышен размер XLSX при записи '+path+': ZIP '+Math.ceil(offset/mib)+
          ' из '+maxBytes/mib+' МиБ; распаковано '+Math.ceil(expanded/mib)+' из '+maxExpanded/mib+' МиБ.');
      }
      locals.push(local,...part.chunks);
      return part.crc.toString(16).padStart(8,'0');
    }
    const paths=sheets.map((_,i)=>'worksheets/sheet'+(i+1)+'.xml');
    const nsType='application/vnd.openxmlformats-officedocument.spreadsheetml.';
    await add('[Content_Types].xml',[xmlHeader+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
      '<Default Extension="xml" ContentType="application/xml"/>'+
      [['workbook.xml',nsType+'sheet.main+xml'],['styles.xml',nsType+'styles+xml'],
        ...paths.map(path=>[path,nsType+'worksheet+xml'])].map(([path,type])=>
        '<Override PartName="/xl/'+path+'" ContentType="'+type+'"/>').join('')+'</Types>']);
    await add('_rels/.rels',[xmlHeader+'<Relationships xmlns="'+packageRelation+'">'+
      '<Relationship Id="rId1" Type="'+relation+'/officeDocument" Target="xl/workbook.xml"/></Relationships>']);
    await add('xl/workbook.xml',[xmlHeader+'<workbook xmlns="'+main+'" xmlns:r="'+relation+'"><sheets>'+
      sheets.map((sheet,i)=>'<sheet name="'+xml(sheet.name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"'+
        (sheet.hidden?' state="hidden"':'')+'/>').join('')+'</sheets></workbook>']);
    await add('xl/_rels/workbook.xml.rels',[xmlHeader+'<Relationships xmlns="'+packageRelation+'">'+
      paths.map((path,i)=>'<Relationship Id="rId'+(i+1)+'" Type="'+relation+'/worksheet" Target="'+path+'"/>').join('')+
      '<Relationship Id="styles" Type="'+relation+'/styles" Target="styles.xml"/></Relationships>']);
    await add('xl/styles.xml',[xmlHeader+'<styleSheet xmlns="'+main+'">'+
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm:ss.000"/></numFmts>'+
      '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'+
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'+
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'+
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
      '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'+
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'+
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>']);
    for(let i=0;i<sheets.length;i++){
      onProgress('Подготовка листа «'+sheets[i].name+'»');
      const crc=await add('xl/'+paths[i],sheetXml(sheets[i],i===0?onRows:null),sheets[i].hidden?maxPart:localLimits?.maxDataPart??maxPart);
      sheets[i].recordCrc?.(crc);
    }
    const size=directory.reduce((total,part)=>total+part.length,0);
    const end=header(22,0x06054b50,[[8,directory.length],[10,directory.length]],[[12,size],[16,offset]]);
    return new Blob([...locals,...directory,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }

  // For previously generated books, decode only the requested worksheets.
  // SheetJS otherwise inflates all ZIP parts even when only one sheet is read.
  // Читаем каталог ZIP и находим отдельные листы, чтобы распаковывать нужную часть по запросу.
  async function open(blob) {
    function check(condition) {
      if(!condition) throw new Error('Повреждён ZIP накопительной книги.');
    }
    check(blob.size>=22&&blob.size<=maxBytes);
    const tailStart=Math.max(0,blob.size-65557);
    const tail=new DataView(await blob.slice(tailStart).arrayBuffer());
    let end=tail.byteLength-22;
    while(end>=0){
      if(tail.getUint32(end,true)===0x06054b50&&end+22+tail.getUint16(end+20,true)===tail.byteLength) break;
      end--;
    }
    check(end>=0);
    const count=tail.getUint16(end+10,true);
    const start=tail.getUint32(end+16,true);
    const directorySize=tail.getUint32(end+12,true);
    check(count>0&&count<10000&&directorySize<=16*mib&&start+directorySize===tailStart+end);
    const directory=new Uint8Array(await blob.slice(start,start+directorySize).arrayBuffer());
    const view=new DataView(directory.buffer);
    const decoder=new TextDecoder();
    const parts=[];
    const names=new Set();
    let pos=0,expanded=0,highest=0;
    for(let i=0;i<count;i++){
      check(pos+46<=directorySize&&view.getUint32(pos,true)===0x02014b50);
      const length=view.getUint16(pos+28,true);
      const entryEnd=pos+46+length+view.getUint16(pos+30,true)+view.getUint16(pos+32,true);
      const local=view.getUint32(pos+42,true);
      const compressed=view.getUint32(pos+20,true);
      const size=view.getUint32(pos+24,true);
      const flags=view.getUint16(pos+8,true);
      check(entryEnd<=directorySize&&local+30<=start&&!(flags&9));
      const head=new DataView(await blob.slice(local,local+30).arrayBuffer());
      check(head.getUint32(0,true)===0x04034b50);
      const dataStart=local+30+head.getUint16(26,true)+head.getUint16(28,true);
      const dataEnd=dataStart+compressed;
      check(dataEnd<=start&&size<=(localLimits?.maxDataPart??maxPart));
      expanded+=size;
      check(expanded<=maxExpanded);
      const name=decoder.decode(directory.subarray(pos+46,pos+46+length));
      check(!names.has(name)&&!name.includes('..'));
      names.add(name);
      const sheet=Number(name.match(/^xl\/worksheets\/sheet(\d+)\.xml$/)?.[1]||0);
      highest=Math.max(highest,sheet);
      parts.push({name,sheet,size,method:view.getUint16(pos+10,true),data:blob.slice(dataStart,dataEnd),
        crc:view.getUint32(pos+16,true).toString(16).padStart(8,'0'),local:blob.slice(local,dataEnd),central:directory.subarray(pos,entryEnd)});
      pos=entryEnd;
    }
    check(pos===directorySize&&highest>0);
    const partsByName=new Map(parts.map(part=>[part.name,part]));
    const byName=name=>partsByName.get(name);
    const sheetCount=parts.filter(part=>part.sheet).length;
    return {highest,sheetCount,sharedSize:byName('xl/sharedStrings.xml')?.size??0,crc:sheet=>parts.find(part=>part.sheet===sheet)?.crc,
      rows:(sheet,width,context)=>readRows(parts.find(part=>part.sheet===sheet),width,context),
      async worksheetIds(){
        const workbook=byName('xl/workbook.xml');
        const relationships=byName('xl/_rels/workbook.xml.rels');
        check(workbook&&relationships);
        const targets=new Map();
        for(const [,entry] of (await smallXml(relationships)).matchAll(/<Relationship\b([^>]+)>/g)){
          if(!attr(entry,'Type')?.endsWith('/worksheet')) continue;
          const target=decodeText(attr(entry,'Target')||'');
          const part=byName(target.startsWith('/')?target.slice(1):'xl/'+target);
          check(part?.sheet);
          targets.set(attr(entry,'Id'),part.sheet);
        }
        const sheets=new Map();
        const used=new Set();
        for(const [,entry] of (await smallXml(workbook)).matchAll(/<sheet\b([^>]+)>/g)){
          const sheet=targets.get(attr(entry,'r:id'));
          const name=decodeText(attr(entry,'name')||'');
          check(sheet&&name&&!sheets.has(name)&&!used.has(sheet));
          sheets.set(name,sheet);
          used.add(sheet);
        }
        check(sheets.size===sheetCount);
        return sheets;
      },
      async excelContext(progress){
        const shared=byName('xl/sharedStrings.xml');
        const styles=byName('xl/styles.xml');
        const workbook=byName('xl/workbook.xml');
        const strings=[];
        if(shared){
          if(shared.size>maxPart) throw new Error('Таблица строк XLSX превышает лимит '+Math.round(maxPart/1e6)+' Мб.');
          progress('Общая таблица строк · '+Math.round(shared.size/1e6)+' Мб после распаковки');
          for await(const item of xmlParts(shared,/<\/si>|<si\b[^>]*\/>/g,'</sst>')) strings.push(readText(item));
        }
        const formatIds=new Map();
        const styleXml=styles?await smallXml(styles):'';
        for(const entry of styleXml.matchAll(/<numFmt\b([^>]+)\/?\s*>/g)){
          formatIds.set(attr(entry[1],'numFmtId'),decodeText(attr(entry[1],'formatCode')||''));
        }
        const xfs=styleXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1]||'';
        const dateStyles=[...xfs.matchAll(/<xf\b([^>]+)>/g)].map(entry=>{
          const id=attr(entry[1],'numFmtId');
          const format=formatIds.get(id)||globalThis.XLSX.SSF._table[id];
          return Boolean(format&&globalThis.XLSX.SSF.is_date(format));
        });
        const date1904=workbook&&/\bdate1904="(?:1|true)"/.test(await smallXml(workbook));
        return {strings,dateStyles,date1904};
      },
      async select(sheets,{excludeShared=false}={}){
      const chunks=[],directory=[];
      let offset=0;
      for(const part of parts){
        if((part.sheet&&!sheets.includes(part.sheet))||(excludeShared&&part.name==='xl/sharedStrings.xml')) continue;
        const central=part.central.slice();
        new DataView(central.buffer).setUint32(42,offset,true);
        chunks.push(part.local);
        directory.push(central);
        offset+=part.local.size;
      }
      const size=directory.reduce((total,part)=>total+part.length,0);
      const end=header(22,0x06054b50,[[8,directory.length],[10,directory.length]],[[12,size],[16,offset]]);
      return new Uint8Array(await new Blob([...chunks,...directory,end]).arrayBuffer());
    }};
  }

  const attributes=new Map();
  function attr(source,name) {
    if(!attributes.has(name)) attributes.set(name,new RegExp('(?:^|\\s)'+name+'="([^"]*)"'));
    return attributes.get(name).exec(source)?.[1];
  }

  const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
  function decodeText(value){
    return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi,(_,name)=>
      name[0]!=='#'?entities[name]:String.fromCodePoint(name[1].toLowerCase()==='x'?
        parseInt(name.slice(2),16):Number(name.slice(1))))
      .replace(/_x([\da-f]{4})_/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)));
  }

  function readText(value){
    const text=[...value.replace(/<rPh\b[^>]*>[\s\S]*?<\/rPh>/g,'').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map(item=>item[1]).join('');
    return (' '+decodeText(text)).slice(1);
  }

  function readRow(source,width,context) {
    const values=[];
    if(context){
      for(const cell of source.matchAll(/<c\s+([^>]*?)(?:\s*\/>|>([\s\S]*?)<\/c>)/g)){
        const address=attr(cell[1],'r');
        const letters=address?.match(/^[A-Z]+/)?.[0];
        if(!letters) throw new Error('Ячейка XLSX без координат.');
        const column=globalThis.XLSX.utils.decode_col(letters);
        if(column>=width) continue;
        const type=attr(cell[1],'t');
        const body=cell[2]||'';
        const value=type==='inlineStr'?null:body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        if(type==='inlineStr') values[column]=readText(body);
        else if(value!=null&&value!==''){
          if(type==='s'){
            const text=context.strings[Number(value)];
            if(text===undefined) throw new Error('Не найдена общая строка XLSX № '+value+'.');
            values[column]=text;
          }else if(type==='b') values[column]=value==='1';
          else if(type==='str') values[column]=decodeText(value);
          else if(type==='d') values[column]=new Date(value);
          else if(type!=='e'){
            const number=Number(value);
            if(!Number.isFinite(number)) throw new Error('Некорректное числовое значение XLSX.');
            values[column]=context.dateStyles[Number(attr(cell[1],'s')||0)]?
              new Date(Math.round((number-(context.date1904?24107:25569))*86400000)):number;
          }
        }
      }
      return values;
    }
    for(const cell of source.matchAll(/<c r="([A-Z]+)[0-9]+"(?: t="(b|inlineStr)"| s="(1)")?>([\s\S]*?)<\/c>/g)){
      const column=globalThis.XLSX.utils.decode_col(cell[1]);
      if(column>=width) break;
      const body=cell[4];
      if(cell[2]==='inlineStr'){
        const entities={'amp':'&','lt':'<','gt':'>','quot':'"','#13':'\r'};
        values[column]=body.slice(body.indexOf('>',4)+1,-9)
          .replace(/&(amp|lt|gt|quot|#13);/g,(_,name)=>entities[name])
          .replace(/_x([\da-f]{4})_/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)));
      }else{
        const number=Number(body.slice(3,-4));
        values[column]=cell[3]?new Date(Math.round((number-25569)*86400000)):
          cell[2]==='b'?Boolean(number):number;
      }
    }
    return values;
  }

  async function* xmlChunks(part){
    if(!part||![0,8].includes(part.method)) throw new Error('Не найден XML накопительной книги.');
    const source=part.data.stream();
    const stream=part.method===8?source.pipeThrough(new DecompressionStream('deflate-raw')):source;
    const decoder=new TextDecoder('utf-8',{fatal:true});
    let size=0,crc=0xffffffff;
    for await(const bytes of stream){
      size+=bytes.length;
      if(size>part.size) throw new Error('Превышен заявленный размер листа.');
      for(const byte of bytes) crc=(crc>>>8)^crcTable[(crc^byte)&255];
      yield decoder.decode(bytes,{stream:true});
    }
    yield decoder.decode();
    if(size!==part.size||((crc^0xffffffff)>>>0).toString(16).padStart(8,'0')!==part.crc)
      throw new Error('Повреждён XML накопительной книги.');
  }

  async function smallXml(part){
    if(part.size>16*mib) throw new Error('Служебный XML превышает 16 Мб.');
    const chunks=[];
    for await(const text of xmlChunks(part)) chunks.push(text);
    return chunks.join('');
  }

  async function* xmlParts(part,delimiter,tail){
    let pending='';
    for await(const text of xmlChunks(part)){
      pending+=text;
      let start=0,match;
      delimiter.lastIndex=0;
      while((match=delimiter.exec(pending))!==null){
        yield pending.slice(start,match.index);
        start=delimiter.lastIndex;
      }
      pending=pending.slice(start);
      if(pending.length>16*mib) throw new Error('Слишком большой фрагмент XML накопительной книги.');
    }
    if(!pending.includes(tail)) throw new Error('Повреждена структура XML накопительной книги.');
  }

  // Отдаём готовые строки по мере распаковки листа. Ширина ограничивает число возвращаемых столбцов.
  async function* readRows(part,width,context) {
    for await(const row of xmlParts(part,/<\/row>/g,'</sheetData>')) yield readRow(row,width,context);
  }

  globalThis.ReclassifierFolderExportXlsx=Object.freeze({write,open,maxBytes});
})();
