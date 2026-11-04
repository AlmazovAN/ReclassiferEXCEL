"""Reference Manager logical registry contract.

The browser layer owns file selection, schema validation and normalization.
Analytical modules request references by logical id and must not depend on local
file names or disk paths.
"""

REFERENCE_IDS = (
    "reclassification",
    "drivers",
    "customers",
    "type_request",
    "initiators",
    "exceptions",
    "problem_grade",
    "mobile_brigade_data",
    "itsm_data",
)

REFERENCE_SCHEMA_VERSIONS = {
    "reclassification": "1.2.0",
    "drivers": "1.0.0",
    "customers": "1.1.0",
    "type_request": "1.0.0",
    "initiators": "1.0.0",
    "exceptions": "1.0.0",
    "problem_grade": "1.0.0",
    "mobile_brigade_data": "1.5.0",
    "itsm_data": "1.2.0",
}


def validate_reference_id(reference_id: str) -> None:
    if reference_id not in REFERENCE_IDS:
        raise KeyError(f"Unknown reference: {reference_id}")


def get_schema_version(reference_id: str) -> str:
    validate_reference_id(reference_id)
    return REFERENCE_SCHEMA_VERSIONS[reference_id]
