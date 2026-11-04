# Equipment browser component

Equipment is split into four layers:

- `equipment_config.js` — catalog contracts, file-name patterns, approved columns and Equipment state initialization.
- `equipment_logic.js` — Excel normalization, joins and Equipment_Combined calculation.
- `equipment_manager.js` — embedded/user source loading, staging, commit lifecycle, history and public API.
- `equipment_ui.js` — status presentation, previews, upload controls and Equipment pages.

The calculation contract is unchanged by this split. Stationary + Mounted are combined vertically, Transport is linked to Mounted by unit + transport/name, Zabbix by equipment → id, and operational status is calculated from `not_working_since`.
