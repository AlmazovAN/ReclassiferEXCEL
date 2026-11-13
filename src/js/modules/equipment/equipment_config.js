  const equipmentDatasetCatalog = globalThis.ReclassifierDatasetCatalog;
  if (!equipmentDatasetCatalog?.get) {
    throw new Error('Dataset Catalog не загружен до Equipment Config.');
  }
  const equipmentDatasetDefinition = id => equipmentDatasetCatalog.get(id);
  const EQUIPMENT_RULES_VERSION = equipmentDatasetDefinition('combined').schemaVersion;
  const EQUIPMENT_SOURCE_IDS = ['mounted', 'stationary', 'transport', 'transport_start_points', 'zabbix'];
  const EQUIPMENT_CATALOG_ORDER = ['combined', ...EQUIPMENT_SOURCE_IDS];
  const EQUIPMENT_STATUS_COLUMN = 'Статус эксплуатации';
  const EQUIPMENT_VARIANT_COLUMNS = ['transport_or_warehouse', 'identifier', 'level', 'group_number'];
  const EQUIPMENT_COMBINED_COLUMNS = [
    'source_catalog', 'id', 'unit', 'unit_department', 'name', 'equipment_type', 'location', 'address', 'horizon',
    'transport', 'not_working_since', EQUIPMENT_STATUS_COLUMN, 'customer', 'parent', 'commissioning_date',
    'transport__id', 'transport__transport_type', 'transport__description', 'transport__location', 'transport__self_moving_type',
    'zabbix__id', 'zabbix__name', 'zabbix__site_address_b', 'zabbix__site_address_c',
    'zabbix__zabbix_equipment_type__name', 'zabbix__update',
    ...EQUIPMENT_VARIANT_COLUMNS
  ];
  const EQUIPMENT_LEGACY_COMBINED_COLUMNS = EQUIPMENT_COMBINED_COLUMNS.filter(column =>
    column !== EQUIPMENT_STATUS_COLUMN && !EQUIPMENT_VARIANT_COLUMNS.includes(column));

  const equipmentConfig = {
    mounted: {
      partitionField: equipmentDatasetDefinition('mounted').partitionField,
      allowEmpty: equipmentDatasetDefinition('mounted').allowEmpty,
      title: 'CatalogMountedEquipment',
      description: 'Навесное оборудование',
      schemaVersion: equipmentDatasetDefinition('mounted').schemaVersion,
      sourceCatalog: 'Mounted',
      filePattern: /^CatalogMountedEquipment(?:-(\d{4}-\d{2}-\d{2}))?/i,
      requiredHeaders: ['id', 'unit', 'name', 'equipment_type', 'location', 'transport', 'not_working_since', 'customer', 'parent', 'commissioning_date'],
      approvedColumns: ['source_catalog', 'id', 'unit', 'name', 'equipment_type', 'location', 'transport', 'not_working_since', 'customer', 'parent', 'commissioning_date', 'unit_department', ...EQUIPMENT_VARIANT_COLUMNS]
    },
    stationary: {
      allowEmpty: equipmentDatasetDefinition('stationary').allowEmpty,
      title: 'CatalogStationaryEquipment',
      description: 'Стационарное оборудование',
      schemaVersion: equipmentDatasetDefinition('stationary').schemaVersion,
      partitionField: equipmentDatasetDefinition('stationary').partitionField,
      sourceCatalog: 'Stationary',
      filePattern: /^CatalogStationaryEquipment(?:-(\d{4}-\d{2}-\d{2}))?/i,
      requiredHeaders: ['id', 'unit', 'name', 'equipment_type', 'location', 'address', 'horizon', 'transport', 'not_working_since', 'customer', 'parent', 'commissioning_date'],
      approvedColumns: ['source_catalog', 'id', 'unit', 'unit_department', 'name', 'equipment_type', 'location', 'address', 'horizon', 'transport', 'not_working_since', 'customer', 'parent', 'commissioning_date', ...EQUIPMENT_VARIANT_COLUMNS]
    },
    transport: {
      partitionField: equipmentDatasetDefinition('transport').partitionField,
      allowEmpty: equipmentDatasetDefinition('transport').allowEmpty,
      title: 'CatalogTransport',
      description: 'Транспорт; публикуются только 5 одобренных полей',
      schemaVersion: equipmentDatasetDefinition('transport').schemaVersion,
      filePattern: /^CatalogTransport-(\d{4}-\d{2}-\d{2})(?!.*StartPoints)/i,
      requiredHeaders: ['id', 'unit', 'name', 'transport_type', 'description', 'location', 'self_moving_type'],
      approvedColumns: ['transport__id', 'transport__transport_type', 'transport__description', 'transport__location', 'transport__self_moving_type']
    },
    transport_start_points: {
      partitionField: equipmentDatasetDefinition('transport_start_points').partitionField,
      // This source intentionally publishes no records: only its validated join index is used at runtime.
      allowEmpty: equipmentDatasetDefinition('transport_start_points').allowEmpty,
      title: 'CatalogTransport StartPoints',
      description: 'Служебный источник стартовых точек транспорта; проверяется и индексируется, но не публикует поля в Equipment_Combined',
      schemaVersion: equipmentDatasetDefinition('transport_start_points').schemaVersion,
      filePattern: /^CatalogTransport-(\d{4}-\d{2}-\d{2}).*StartPoints/i,
      requiredHeaders: ['unit', 'name', 'maintenance_date', 'maintenance_position', 'maintenance_type'],
      approvedColumns: []
    },
    zabbix: {
      partitionField: equipmentDatasetDefinition('zabbix').partitionField,
      allowEmpty: equipmentDatasetDefinition('zabbix').allowEmpty,
      title: 'CatalogZabbixEquipmentTree',
      description: 'Дерево оборудования мониторинга Zabbix',
      schemaVersion: equipmentDatasetDefinition('zabbix').schemaVersion,
      filePattern: /^CatalogZabbixEquipmentTree-(\d{4}-\d{2}-\d{2})/i,
      requiredHeaders: ['id', 'name', 'site_address_b', 'site_address_c', 'zabbix_equipment_type__name', 'equipment', 'update'],
      approvedColumns: ['zabbix__id', 'zabbix__name', 'zabbix__site_address_b', 'zabbix__site_address_c', 'zabbix__zabbix_equipment_type__name', 'zabbix__update']
    },
    combined: {
      allowEmpty: equipmentDatasetDefinition('combined').allowEmpty,
      title: 'Equipment_Combined',
      description: 'Производный справочник оборудования; пересчитывается из текущих входных каталогов и содержит расчётный статус эксплуатации',
      schemaVersion: equipmentDatasetDefinition('combined').schemaVersion,
      approvedColumns: EQUIPMENT_COMBINED_COLUMNS
    }
  };

  state.equipmentHistory = state.equipmentHistory || {};
  state.activeEquipmentId = state.activeEquipmentId || null;
  state.pendingEquipmentId = null;
  state.equipmentStaging = state.equipmentStaging || { files: [], catalogs: {}, combined: null, messages: [], processedAt: null, controlCombined: null };
