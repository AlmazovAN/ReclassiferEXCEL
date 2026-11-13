const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('streaming MB preserves all fields, ordering and provenance without staging the history', async () => {
  const release = fs.readFileSync(path.join(__dirname,'../dist/Reclassifier_Folders.html'),'utf8');
  const source = JSON.parse(release.match(/id="folders-worker">([\s\S]*?)<\/script>/)[1]);
  const app = vm.createContext({
    Blob, ArrayBuffer, Uint8Array, Date, Map, Set, TextEncoder, TextDecoder, TextDecoderStream,
    crypto:globalThis.crypto, ReadableStream, CompressionStream, DecompressionStream,
    console, setTimeout
  });
  app.self = app;
  vm.runInContext(source,app);
  const binary=new Uint8Array(8*1048576+17);
  for(let i=0;i<binary.length;i+=89) binary[i]=i%251;
  assert.equal(await app.hashBlob(new Blob([binary])),require('node:crypto').hash('sha256',binary));
  const stagedSizes=[];
  app.ReclassifierLocalExportLimits = {
    ...app.ReclassifierLocalExportLimits,
    async stageRows(rows) {
      stagedSizes.push(rows.size);
      return app.stageRows(rows);
    },
    async stageBook(blob) {return blob;}
  };
  function makeSource(kind,name,rows,createdAt){
    const xlsx=app.XLSX, book=xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(book,xlsx.utils.aoa_to_sheet(rows),'Данные');
    const bytes=xlsx.write(book,{type:'array',bookType:'xlsx'});
    const file=Object.assign(new Blob([bytes]),{name});
    return {file,path:kind.toUpperCase()+'/'+name,
      sha256:require('node:crypto').hash('sha256',new Uint8Array(bytes)),createdAt};
  }
  const headers=['Тип задачи','Фактическая дата','Фактические трудозатраты',
    'Участок','Номер задачи','Заявка','Трудозатраты','Ссылка на заявку','Комментарий'];
  const row=(date,num,labor,id)=>['ТО',date,1,'Шахта',num,'INC1',labor,id?'https://example.test/tasks-for-shift/'+id:null];
  const oldMb=makeSource('mb','tasks_2026-10-01_2026-10-30.xlsx',[headers,
    row('2026-10-01','001','0ч. 36мин.',12),
    row('2026-10-02','002','1ч. 0мин.',null),
    row('2026-10-03','003','1ч. 0мин.',15),
    [...row('2026-10-04','006','2ч. 0мин.',18),'x'.repeat(32767)]
  ],'2026-10-30T12:00:00Z');
  const itsm=makeSource('itsm','report_09_11_2026_8_53.xlsx',[
    ['Номер','Дата создания вызова'],['INC1','2026-10-01']
  ]);
  const payload={references:{},referenceHash:'0'.repeat(64),asOf:'2026-11-09T12:00:00Z'};
  const process = app.ReclassifierFolderExportProcessor.process;
  const initial=await process({...payload,current:{itsm:null,mb:null},sources:{itsm:[itsm],mb:[oldMb]}});
  const current=Object.fromEntries(Object.entries(initial.books).map(([kind,book])=>[
    kind,Object.assign(book.blob,{name:'export_'+kind.toUpperCase()+'.xlsx'})
  ]));
  const incoming=makeSource('mb','tasks_2026-10-01_2026-11-09.xlsx',[headers,
    row('2026-11-02','001','0ч. 37мин.',12),
    row('2026-10-02','002','1ч. 11мин.',14),
    row('2026-10-01','004','1ч. 0мин.',16)
  ],'2026-11-09T12:00:00Z');
  const update={...payload,current,sources:{itsm:[],mb:[incoming]}};
  stagedSizes.length=0;
  const stream=await process(update);
  assert.equal(stream.status,'prepared');
  assert.deepEqual(stagedSizes,[1]);
  const baseline=await process({...update,disableMbStreaming:true});
  assert.equal(baseline.status,'prepared');
  assert.equal(stream.summary.mb.rows,5);
  assert.equal(stream.summary.mb.updated,2);
  assert.equal(stream.summary.mb.added,1);
  const archive=await app.ReclassifierFolderExportXlsx.open(stream.books.mb.blob);
  const context=await archive.excelContext(()=>{});
  const actualRows=[];
  for await(const row of archive.rows(1,72,context)) actualRows.push(row);
  const [columns,...records]=actualRows;
  const column=name=>columns.indexOf(name);
  assert.deepEqual(records.map(row=>row[column('Номер задачи')]),['004','002','003','006','001']);
  assert.equal(records[1][column('Трудозатраты')],'1ч. 11мин.');
  assert.equal(records[4][column('Трудозатраты')],'0ч. 37мин.');
  assert.equal(records[4][column('ФактТрудочас, чел-час')],1);
  assert.equal(records[2][column('Трудозатраты')],'1ч. 0мин.');
  for(const kind of ['itsm','mb']){
    const actual=await app.ReclassifierFolderExportXlsx.open(stream.books[kind].blob);
    const expected=await app.ReclassifierFolderExportXlsx.open(baseline.books[kind].blob);
    for(let i=1;i<actual.highest;i++) assert.equal(actual.crc(i),expected.crc(i),kind+' sheet '+i);
  }
  const written=Object.fromEntries(Object.entries(stream.books).map(([kind,book])=>[
    kind,Object.assign(book.blob,{name:'export_'+kind.toUpperCase()+'.xlsx'})
  ]));
  const repeat=await process({...update,current:written});
  assert.equal(repeat.status,'unchanged');
  assert.equal(repeat.summary.mb.added,0);
  assert.equal(repeat.summary.mb.updated,0);
  const withoutInputs=await process({...update,current:written,sources:{itsm:[],mb:[]}});
  assert.equal(withoutInputs.status,'unchanged');

  // An editor can change the worksheet part numbers without changing the named sheets.
  const {CFB}=app.XLSX;
  const itsmArchive=await app.ReclassifierFolderExportXlsx.open(written.itsm);
  const itsmSheets=await itsmArchive.worksheetIds();
  const metaId=itsmSheets.get('_Meta');
  const zip=CFB.read(new Uint8Array(await written.itsm.arrayBuffer()),{type:'array'});
  const readPart=name=>Buffer.from(CFB.find(zip,'/xl/'+name).content);
  const writePart=(name,content)=>CFB.utils.cfb_add(zip,'/xl/'+name,content);
  const firstName='worksheets/sheet1.xml';
  const metaName='worksheets/sheet'+metaId+'.xml';
  const firstSheet=readPart(firstName);
  writePart(firstName,readPart(metaName));
  writePart(metaName,firstSheet);
  const rels='_rels/workbook.xml.rels';
  const relationships=readPart(rels).toString('utf8').replace(/Target="(worksheets\/sheet\d+\.xml)"/g,
    (match,target)=>target===firstName ? 'Target="'+metaName+'"' : target===metaName ? 'Target="'+firstName+'"' : match);
  writePart(rels,Buffer.from(relationships));
  const renumbered=Object.assign(new Blob([CFB.write(zip,{type:'array',fileType:'zip',compression:true})]),{name:written.itsm.name});
  const result=await process({...update,current:{...written,itsm:renumbered},sources:{itsm:[],mb:[]}});
  assert.equal(result.status,'unchanged');
  assert.deepEqual(result.summary.itsm,withoutInputs.summary.itsm);

  // Empty SST items still occupy an index, including before the format marker.
  const metaBook=app.XLSX.utils.book_new();
  app.XLSX.utils.book_append_sheet(metaBook,app.XLSX.utils.aoa_to_sheet([['Reclassifier/folder-exports/2']]),'_Meta');
  const sharedBytes=new Uint8Array(app.XLSX.write(metaBook,{type:'array',bookType:'xlsx',bookSST:true}));
  const sharedZip=CFB.read(sharedBytes,{type:'array'});
  for(const [name,rewrite] of [
    ['sharedStrings.xml',xml=>xml.replace('<si>','<si/><si>')],
    ['worksheets/sheet1.xml',xml=>xml.replace('<v>0</v>','<v>1</v>')]
  ]){
    const part=Buffer.from(CFB.find(sharedZip,'/xl/'+name).content).toString('utf8');
    CFB.utils.cfb_add(sharedZip,'/xl/'+name,Buffer.from(rewrite(part)));
  }
  const sharedArchive=await app.ReclassifierFolderExportXlsx.open(new Blob([CFB.write(sharedZip,{type:'array',fileType:'zip',compression:true})]));
  const sharedContext=await sharedArchive.excelContext(()=>{});
  const metaRows=[];
  for await(const row of sharedArchive.rows(1,1,sharedContext)) metaRows.push(row[0]);
  assert.deepEqual(metaRows,['Reclassifier/folder-exports/2']);
});

