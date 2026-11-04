MODULE_ID = "itsm"
MODULE_VERSION = "1.2.0"
REQUIRED_REFERENCES = (
    "reclassification",
    "drivers",
    "customers",
    "type_request",
    "initiators",
    "exceptions",
    "problem_grade",
)


def process(input_bytes: bytes, references: dict, options: dict | None = None):
    """Reserved Python contract.

    ITSM Rules 1.2.0 currently execute in the browser/SheetJS runtime.
    The Python entry point is intentionally kept as a module boundary for
    a future runtime migration without changing the business-rule contract.
    """
    raise NotImplementedError("ITSM Rules 1.2.0 currently use the browser runtime")
