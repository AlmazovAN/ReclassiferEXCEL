# Reference Manager architecture

Reference Manager is split into four explicit browser-side components. They are concatenated in reviewed order into the single release HTML.

- `reference_config.js` — `referenceConfig`, schemas and declarative contracts.
- `reference_normalizers.js` — common normalization helpers plus normalizers for Drivers, Customers, TypeRequest, Reclassification, Initiators, Exceptions and ProblemGrade.
- `reference_manager.js` — user-file loading, validation state, history metadata and the public `ReclassifierReferenceManager` API.
- `reference_ui.js` — list/detail rendering, previews, validation presentation, history markup and drag/drop bindings.

Rules:
- schema/config changes belong in `reference_config.js`;
- Excel parsing and normalization belong in `reference_normalizers.js`;
- data lifecycle/state belongs in `reference_manager.js`;
- DOM and visual presentation belong in `reference_ui.js`;
- Reference-specific logic must not return to the common `src/js/app/*` shell.
