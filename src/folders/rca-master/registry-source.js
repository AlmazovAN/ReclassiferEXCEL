function validateOfficialRegistry(value) {
  if (value?.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(value.sourceHash) ||
      typeof value.fileName !== 'string' || !Number.isFinite(Date.parse(value.loadedAt)) ||
      !Number.isSafeInteger(value.rowCount) || !Array.isArray(value.warnings) ||
      value.warnings.some(warning => typeof warning !== 'string') || !Array.isArray(value.records) ||
      !value.records.length || value.rowCount < value.records.length) {
    throw new Error('Некорректный снимок официального реестра.');
  }
  const ids = new Set();
  for (const record of value.records) {
    if (!record || !/^PRB\d+$/.test(record.prbNumber) || ids.has(record.prbNumber) ||
        !['title', 'itsmStatus'].every(key => typeof record[key] === 'string' && record[key].trim()) ||
        Object.values(record).some(field => field !== null && typeof field !== 'string')) {
      throw new Error('Некорректная запись официального реестра.');
    }
    ids.add(record.prbNumber);
  }
  return value;
}

function createOfficialRegistryStore({names, read, write, hash, writable, analytics = false, plans = false}) {
  const path = plans ? ['references','plan-templates'] : analytics ? ['analytics','itsm'] : ['references', 'it-problems'];
  const pattern = /^registry-(\d{12})\.json$/;
  const validate = plans ? validateRcaPlanLibrary : analytics ? validateRcaItsmIndex : validateOfficialRegistry;
  async function generations() {
    return (await names(path)).filter(name => pattern.test(name)).sort().reverse();
  }
  async function readLatest(files = null) {
    for (const name of files ?? await generations()) {
      try {
        const envelope = JSON.parse(await read(path, name));
        if (await hash(JSON.stringify(envelope.registry)) !== envelope.hash) continue;
        return validate(envelope.registry);
      } catch (error) {
        if (['NotAllowedError', 'SecurityError'].includes(error.name)) throw error;
      }
    }
    return null;
  }
  async function publish(registry) {
    validate(registry);
    const save = async () => {
      if (!await writable()) return false;
      const files = await generations();
      const previous = await readLatest(files);
      if (previous?.sourceHash === registry.sourceHash && previous.rules === registry.rules) return true;
      const generation = files.length ? Number(pattern.exec(files[0])[1]) + 1 : 1;
      if (generation > 999999999999) throw new Error('Исчерпаны номера версий реестра.');
      const text = JSON.stringify({hash: await hash(JSON.stringify(registry)), registry});
      await write(path, 'registry-' + String(generation).padStart(12, '0') + '.json', text);
      return true;
    };
    return navigator.locks?.request ? navigator.locks.request('reclassifier-rca-' + path.join('/'), save) : save();
  }
  return {readLatest, publish};
}
