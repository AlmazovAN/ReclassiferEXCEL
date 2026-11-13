function createImportedDirectory(files,{pendingFile,observeFile}) {
  const directory = () => {
    const children = new Map();
    return {kind:'directory',children,entries:()=>children.entries(),isSameEntry:other=>other?.children===children};
  };
  const root = directory();
  for (const {path,file} of files) {
    const [name, ...parts] = path.split('/');
    if (parts.length === 1 && parts[0] === pendingFile) {
      throw new Error('В папке есть незавершённая запись. Сначала восстановите пару в режиме прямого доступа.');
    }
    if (!name || parts.length < 2 || !/^(catalogs|itsm|mb)$/i.test(parts[0])) continue;
    let parent = root;
    for (const part of parts.slice(0,-1)) {
      if (!parent.children.has(part)) parent.children.set(part,directory());
      parent = parent.children.get(part);
    }
    const source = observeFile(file,parts[0].toUpperCase());
    parent.children.set(parts.at(-1),{kind:'file',getFile:async()=>source});
  }
  for (const name of ['Catalogs','ITSM','MB']) {
    if (![...root.children.keys()].some(key=>key.toLowerCase()===name.toLowerCase())) {
      root.children.set(name,directory());
    }
  }
  return root;
}
