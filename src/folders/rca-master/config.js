const RCA_SCHEMA_VERSION = 1;
const RCA_COLLECTIONS = Object.freeze([
  'participants', 'symptoms', 'classifications', 'incidents', 'equipmentReferences',
  'rcaNodes', 'evidence', 'actions', 'attachments', 'history'
]);
const RCA_UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const RCA_INDEX_NAME = /^index-(\d{12})\.json$/;
const RCA_SNAPSHOT_NAME = /^\d+-[0-9a-f-]{36}\.json$/;
