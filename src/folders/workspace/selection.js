function inspectFolderImport(selection) {
  const files = Array.from(selection,file=>({path:file.webkitRelativePath,file}));
  if (!files.length) return null;
  const name = files[0].path.split('/')[0];
  return {name,files,valid:Boolean(name && files.some(({path})=>/^[^/]+\/catalogs\/.+/i.test(path)))};
}

async function findInvalidWorkspaceFolders(handle) {
  const required = ['Catalogs','ITSM','MB'];
  const directories = new Map(required.map(name=>[name.toLowerCase(),0]));
  for await (const entry of handle.values()) {
    const name = entry.name.toLowerCase();
    if (entry.kind === 'directory' && directories.has(name)) {
      directories.set(name,directories.get(name)+1);
    }
  }
  return required.filter(name=>directories.get(name.toLowerCase())!==1);
}
