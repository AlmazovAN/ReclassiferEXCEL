MODULE_ID = "mobile_brigade"
MODULE_VERSION = "1.1.0"
REQUIRED_REFERENCES = ()


def process(input_bytes: bytes, references: dict, options: dict | None = None):
    """Reserved Python contract.

    Mobile Brigade Rules 1.4.0 execute in the browser/SheetJS WebWorker runtime.
    The Python entry point is kept as a stable module boundary for a future
    runtime migration without changing the business-rule contract.
    """
    raise NotImplementedError("Mobile Brigade Rules 1.4.0 currently use the browser runtime")
