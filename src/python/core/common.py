"""Common contracts for Reclassifier analytical modules."""

APP_CONTRACT_VERSION = "0.1"


def validate_input_bytes(data: bytes) -> None:
    if not isinstance(data, (bytes, bytearray)):
        raise TypeError("input data must be bytes")
    if not data:
        raise ValueError("input file is empty")
