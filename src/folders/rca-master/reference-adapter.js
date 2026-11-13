function rcaPassportReferences(dictionaries, officialRegistry, references, prbNumber) {
  const unique = values => [...new Set(values.map(value => value?.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'ru'));
  const local = key => dictionaries.filter(item => item.status === 'active' && item.category === key)
    .map(item => item.value);
  const paths = new Map();
  if (prbNumber) {
    for (const row of references?.classifications ?? []) {
      if (row.problemId?.trim().toUpperCase() !== prbNumber.toUpperCase()) continue;
      const values = [row.equipment, row.element, row.fault, row.reason];
      if (values.every(Boolean)) paths.set(JSON.stringify(values), values);
    }
  }
  return {
    suggestions: {
      equipment: unique([...local('equipment'), ...(references?.equipment ?? [])]),
      location: unique([...local('location'), ...(references?.locations ?? [])]),
      project: unique(officialRegistry?.records.map(row => row.project) ?? [])
    },
    paths: [...paths.values()]
  };
}
