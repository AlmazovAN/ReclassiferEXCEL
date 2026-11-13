// PR-3: compact, offline OOXML formatting for the Re-Class comparison report.
// SheetJS Community writes values, but not custom cell fills or conditional rules.
// Reuse its bundled CFB ZIP reader/writer; no runtime network dependency.
(() => {
  'use strict';

  const PREFERRED_DATE_FORMAT = 'dd.mm.yyyy hh:mm';
  const CSS = Object.freeze({
    primary: 'FFF7D7B5',
    engineer: 'FFF0BE91',
    machine: 'FFDDECC8',
    neutral: 'FFE9EEF4',
    text: 'FF253247'
  });
  const excel = globalThis.XLSX;
  if (!excel?.CFB?.read || !excel?.CFB?.write) {
    throw new Error('SheetJS CFB ZIP support is required for formatted Re-Class export.');
  }
  const CFB = excel.CFB;
  const enc = new TextEncoder(), dec = new TextDecoder('utf-8');

  function entry(cfb,path) {
    const suffix = '/' + path;
    const index = cfb.FullPaths.findIndex(name =>
      name.replace(/\\/g,'/').endsWith(suffix));
    if (index < 0) throw new Error('В XLSX не найден служебный XML: ' + path);
    return cfb.FileIndex[index];
  }
  function xmlPart(cfb,path) {
    const current = entry(cfb,path);
    return {current,xml:dec.decode(current.content)};
  }
  function replaceXml(part,xml) {
    const bytes = enc.encode(xml);
    part.current.content = bytes;
    part.current.size = bytes.length;
  }
  function insertPart(xml,tag,parts) {
    const full = new RegExp('(<'+tag+'\\b[^>]*>)([\\s\\S]*?)(<\\/'+tag+'>)');
    const match = xml.match(full);
    if(match){
      const originalCount=Number(match[1].match(/\bcount="(\d+)"/)?.[1]);
      if(!Number.isSafeInteger(originalCount))throw new Error('Неверный счётчик '+tag);
      const opening=match[1].replace(/\bcount="\d+"/,'count="'+(originalCount+parts.length)+'"');
      return {xml:xml.replace(full,opening+match[2]+parts.join('')+match[3]),base:originalCount};
    }
    const selfClosing=new RegExp('<'+tag+'\\b([^>]*)\\/>');
    const short=xml.match(selfClosing);
    if(short){
      const n=Number(short[1].match(/\bcount="(\d+)"/)?.[1]);
      if(!Number.isSafeInteger(n))throw new Error('Неверный счётчик '+tag);
      const attrs=short[1].replace(/\bcount="\d+"/,'count="'+(n+parts.length)+'"');
      return {xml:xml.replace(short[0],'<'+tag+attrs+'>'+parts.join('')+'</'+tag+'>'),base:n};
    }
    // A SheetJS-generated workbook may omit the empty dxfs collection.
    if(tag==='dxfs'){
      const addition='<dxfs count="'+parts.length+'">'+parts.join('')+'</dxfs>';
      const insertion=xml.includes('<tableStyles')?'<tableStyles':'</styleSheet>';
      return {xml:xml.replace(insertion,addition+insertion),base:0};
    }
    throw new Error('XLSX styles.xml: отсутствует блок '+tag);
  }
  function xmlStyle(embedded) {
    let xml = embedded;
    const fonts = [
      '<font><b/><sz val="12"/><color rgb="'+CSS.text+'"/><name val="Calibri"/></font>',
      '<font><b/><sz val="10"/><color rgb="'+CSS.text+'"/><name val="Calibri"/></font>'
    ];
    let block=insertPart(xml,'fonts',fonts);xml=block.xml;
    const titleFont=block.base,headerFont=block.base+1;
    const fills=[CSS.primary,CSS.engineer,CSS.machine,CSS.neutral]
      .map(color=>'<fill><patternFill patternType="solid"><fgColor rgb="'+color+'"/><bgColor indexed="64"/></patternFill></fill>');
    block=insertPart(xml,'fills',fills);xml=block.xml;
    const firstFill=block.base;
    block=insertPart(xml,'borders',[
      '<border><left style="thin"><color rgb="FFD2D9E2"/></left><right/><top/><bottom style="thin"><color rgb="FFD2D9E2"/></bottom><diagonal/></border>'
    ]);xml=block.xml;
    const border=block.base;
    const xf=(font,fill,wrap)=>'<xf numFmtId="0" fontId="'+font+'" fillId="'+fill+
      '" borderId="'+border+'" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">'+
      '<alignment horizontal="left" vertical="center" wrapText="'+(wrap?1:0)+'"/></xf>';
    const additions=[
      xf(titleFont,firstFill,false),xf(titleFont,firstFill+1,false),
      xf(titleFont,firstFill+2,false),
      xf(headerFont,firstFill+3,true),
      xf(headerFont,firstFill,true),xf(headerFont,firstFill+1,true),
      xf(headerFont,firstFill+2,true)
    ];
    block=insertPart(xml,'cellXfs',additions);xml=block.xml;
    const xfBase=block.base;
    block=insertPart(xml,'dxfs',[
      '<dxf><font><color rgb="FF9C5700"/></font><fill><patternFill><bgColor rgb="FFFFEB9C"/></patternFill></fill></dxf>',
      '<dxf><font><color rgb="FF9C0006"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf>'
    ]);xml=block.xml;
    return {xml,styles:{group:[xfBase,xfBase+1,xfBase+2],
      neutral:xfBase+3,headers:[xfBase+4,xfBase+5,xfBase+6],
      warningDxf:block.base,errorDxf:block.base+1}};
  }
  function excelColumn(index) {
    let result='';
    for(let n=index+1;n>0;n=Math.floor((n-1)/26))result=String.fromCharCode(65+(n-1)%26)+result;
    return result;
  }
  function setStyle(element,index) {
    if(/\bs="\d+"/.test(element))return element.replace(/\bs="\d+"/,'s="'+index+'"');
    return element.replace(/^<c\b/,'<c s="'+index+'"');
  }
  function styleRow(xml,number,cb) {
    const pattern = new RegExp('<row\\b[^>]*\\br="'+number+'"[^>]*>[\\s\\S]*?<\\/row>');
    const target = xml.match(pattern)?.[0];
    if(!target)throw new Error('XLSX: не найдена строка заголовков '+number);
    const replaced = target.replace(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g,cell=>{
      const col=cell.match(/\br="([A-Z]+)\d+"/)?.[1];
      if(!col)return cell;
      let idx=0;for(const ch of col)idx=idx*26+ch.charCodeAt(0)-64;
      const style = cb(idx-1);
      return style==null?cell:setStyle(cell,style);
    });
    return xml.replace(target,replaced);
  }
  function addRowHeight(xml,row,height) {
    const pat = new RegExp('<row\\b([^>]*\\br="'+row+'"[^>]*)>');
    return xml.replace(pat,(all,attrs)=>'<row'+attrs.replace(/\s(?:ht|customHeight)="[^"]*"/g,'')+
      ' ht="'+height+'" customHeight="1">');
  }
  function mergeHeaders(xml) {
    const tag='<mergeCells count="3"><mergeCell ref="D1:H1"/><mergeCell ref="I1:N1"/><mergeCell ref="O1:T1"/></mergeCells>';
    if(xml.includes('<mergeCells'))throw new Error('Неожиданное объединение в исходном сравнительном листе.');
    // CT_Worksheet sequence requires autoFilter BEFORE mergeCells, followed
    // by conditionalFormatting. Never insert a merge after conditional rules.
    if(xml.includes('</autoFilter>'))return xml.replace('</autoFilter>','</autoFilter>'+tag);
    const filter=xml.match(/<autoFilter\b[^>]*\/>/);
    if(filter)return xml.replace(filter[0],filter[0]+tag);
    if(!xml.includes('</sheetData>'))throw new Error('XLSX: отсутствует sheetData.');
    return xml.replace('</sheetData>','</sheetData>'+tag);
  }
  function frozenView(xml) {
    const view='<sheetViews><sheetView workbookViewId="0">'+
      '<pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/>'+
      '<selection pane="bottomLeft" activeCell="A3" sqref="A3"/>'+
      '</sheetView></sheetViews>';
    if(/<sheetViews\b/.test(xml)) {
      return xml.replace(/<sheetViews\b[^>]*>[\s\S]*?<\/sheetViews>/,view);
    }
    if(/<dimension\b[^>]*\/>/.test(xml)){
      return xml.replace(/(<dimension\b[^>]*\/>)/,'$1'+view);
    }
    return xml.replace(/<sheetData\b/ ,view+'<sheetData');
  }
  function conditionalQuality(xml,styles,lastRow) {
    if(lastRow<3)return xml;
    const rules='<conditionalFormatting sqref="N3:N'+lastRow+' T3:T'+lastRow+'">'+
      '<cfRule type="cellIs" dxfId="'+styles.warningDxf+'" priority="1" operator="equal">'+
      '<formula>"INC с исправлением"</formula></cfRule>'+
      '<cfRule type="cellIs" dxfId="'+styles.errorDxf+'" priority="2" operator="equal">'+
      '<formula>"RITM вместо INC"</formula></cfRule></conditionalFormatting>';
    // In OOXML, conditional formatting follows mergeCells and precedes validations.
    return xml.replace('</mergeCells>','</mergeCells>'+rules);
  }
  function applySheetStyles(xml,styles,rowCount) {
    const row1=index=>{
      if(index>=3&&index<=7)return styles.group[0];
      if(index>=8&&index<=13)return styles.group[1];
      if(index>=14&&index<=19)return styles.group[2];
      return null;
    };
    const row2=index=>{
      if(index>=3&&index<=7)return styles.headers[0];
      if(index>=8&&index<=13)return styles.headers[1];
      if(index>=14&&index<=19)return styles.headers[2];
      return styles.neutral;
    };
    xml=styleRow(xml,1,row1);
    xml=styleRow(xml,2,row2);
    xml=addRowHeight(xml,1,25);
    xml=addRowHeight(xml,2,38);
    xml=frozenView(xml);
    xml=mergeHeaders(xml);
    return conditionalQuality(xml,styles,rowCount+2);
  }
  function format(bytes,reportIndex,rowCount) {
    const archive=CFB.read(new Uint8Array(bytes),{type:'array'});
    const styles=xmlPart(archive,'xl/styles.xml');
    const styled=xmlStyle(styles.xml);
    replaceXml(styles,styled.xml);
    const sheet=xmlPart(archive,'xl/worksheets/sheet'+(reportIndex+1)+'.xml');
    replaceXml(sheet,applySheetStyles(sheet.xml,styled.styles,rowCount));
    const written=CFB.write(archive,{type:'array',fileType:'zip',compression:true});
    return written instanceof ArrayBuffer ? written :
      written.buffer.slice(written.byteOffset,written.byteOffset+written.byteLength);
  }
  globalThis.ReclassifierReclassificationXlsxFormat=Object.freeze({
    format,preferredDateFormat:PREFERRED_DATE_FORMAT
  });
})();
