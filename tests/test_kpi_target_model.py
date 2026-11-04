"""Step 1: validate the design-time KPI model without non-stdlib dependencies."""
from __future__ import annotations

import copy
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / "docs" / "architecture" / "kpi_passport_target_model.md"
SCHEMA = ROOT / "docs" / "contracts" / "kpi_target_model.schema.json"
FIXTURE = ROOT / "docs" / "contracts" / "examples" / "kpi_sla_target_model.example.json"


def _type_matches(value: object, kind: str) -> bool:
    return {
        "null": lambda: value is None,
        "object": lambda: isinstance(value, dict),
        "array": lambda: isinstance(value, list),
        "string": lambda: isinstance(value, str),
        "boolean": lambda: isinstance(value, bool),
        "number": lambda: isinstance(value, (float, int)) and not isinstance(value, bool),
        "integer": lambda: isinstance(value, int) and not isinstance(value, bool),
    }[kind]()


def _verify(value: object, contract: dict, root: dict, location: str = "$") -> None:
    """Evaluate the JSON Schema keywords used by this static fixture.

    This is intentionally a small, strict stdlib-only contract smoke test.
    It is NOT a replacement for a general-purpose JSON Schema validator.
    """
    if "$ref" in contract:
        ref = contract["$ref"]
        assert ref.startswith("#/$defs/"), (location, ref)
        name = ref.removeprefix("#/$defs/")
        assert name in root["$defs"], (location, name)
        return _verify(value, root["$defs"][name], root, location)
    if "anyOf" in contract:
        attempts = []
        for candidate in contract["anyOf"]:
            try:
                _verify(value, candidate, root, location)
                return
            except (AssertionError, KeyError, TypeError) as exc:
                attempts.append(str(exc))
        raise AssertionError((location, "none of anyOf schemas matched", attempts))
    if "const" in contract:
        assert value == contract["const"], (location, value, contract["const"])
    if "enum" in contract:
        assert value in contract["enum"], (location, value, contract["enum"])
    if "type" in contract:
        kinds = contract["type"] if isinstance(contract["type"], list) else [contract["type"]]
        assert any(_type_matches(value, kind) for kind in kinds), (location, value, kinds)
    if "minimum" in contract and isinstance(value, (float, int)):
        assert value >= contract["minimum"], location
    if "maximum" in contract and isinstance(value, (float, int)):
        assert value <= contract["maximum"], location
    if "pattern" in contract and isinstance(value, str):
        assert re.search(contract["pattern"], value), (location, value)
    if isinstance(value, dict):
        assert len(value) >= contract.get("minProperties", 0), location
        properties = contract.get("properties", {})
        assert set(contract.get("required", [])) <= set(value), (location, "missing required")
        for key, item in value.items():
            rule = properties.get(key, contract.get("additionalProperties", True))
            assert rule is not False, (location, "unexpected property", key)
            if isinstance(rule, dict):
                _verify(item, rule, root, f"{location}.{key}")
    if isinstance(value, list):
        assert len(value) >= contract.get("minItems", 0), location
        if contract.get("uniqueItems"):
            assert len(value) == len({json.dumps(item, sort_keys=True) for item in value}), location
        rule = contract.get("items")
        if isinstance(rule, dict):
            for index, item in enumerate(value):
                _verify(item, rule, root, f"{location}[{index}]")


class KpiTargetModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
        cls.fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        cls.spec = SPEC.read_text(encoding="utf-8")

    def test_schema_resolves_all_refs(self):
        self.assertEqual(self.schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
        def walk(value):
            if isinstance(value, dict):
                if "$ref" in value:
                    name = value["$ref"].removeprefix("#/$defs/")
                    self.assertIn(name, self.schema["$defs"])
                for item in value.values():
                    walk(item)
            elif isinstance(value, list):
                for item in value:
                    walk(item)
        walk(self.schema)

    def test_complete_example_follows_schema(self):
        _verify(self.fixture, self.schema, self.schema)

    def test_synthetic_values_are_consistent_and_not_official(self):
        model = self.fixture
        self.assertTrue(model["exampleOnly"])
        self.assertEqual(model["modelVersion"], "1.0.0")
        self.assertEqual(model["definition"]["methodology"]["status"], "draft")
        self.assertIsNone(model["definition"]["target"])
        numerator = model["result"]["components"]["slaSuccessCount"]
        denominator = model["result"]["components"]["slaTotalCount"]
        self.assertEqual((numerator, denominator), (9, 10))
        self.assertEqual(model["result"]["value"], 100 * numerator / denominator)
        self.assertEqual(model["card"]["current"]["value"], 90)
        self.assertEqual(model["card"]["previous"]["value"], 80)
        self.assertEqual(model["card"]["change"], 10)
        self.assertEqual(model["card"]["changeUnit"], "п.п.")
        self.assertIsNone(model["card"]["forecast"]["value"])
        self.assertIsNone(model["card"]["forecast"]["horizon"])
        self.assertEqual(model["card"]["forecast"]["dataState"], "not-calculated")

    def test_trace_matches_calculation_steps_and_result(self):
        model = self.fixture
        kpi_id = model["definition"]["id"]
        for path in ("calculation", "series", "trace", "card"):
            self.assertEqual(model[path]["kpiId"], kpi_id)
        self.assertEqual(model["result"]["id"], kpi_id)
        step_ids = [item["id"] for item in model["calculation"]["steps"]]
        self.assertEqual(len(step_ids), len(set(step_ids)))
        self.assertEqual(step_ids, [item["stepId"] for item in model["trace"]["executions"]])
        self.assertEqual(model["trace"]["output"], model["result"]["value"])
        self.assertEqual(model["trace"]["counts"]["sourceRows"], 13)
        self.assertEqual(model["trace"]["counts"]["eligibleRows"], 10)
        self.assertEqual(model["trace"]["counts"]["excludedUnknownSla"], 3)

    def test_time_and_aggregation_are_explicit(self):
        calculation = self.fixture["calculation"]
        self.assertEqual(calculation["temporal"]["basis"]["field"], "closedAt")
        self.assertEqual(calculation["temporal"]["periodGrain"], "month")
        self.assertEqual(calculation["aggregation"]["combinePeriods"], "sum-components-then-formula")
        self.assertEqual(calculation["temporal"]["rolling"]["method"], "ratio-of-sums")
        self.assertEqual(calculation["temporal"]["rolling"]["defaultWindow"], 4)
        self.assertTrue(calculation["temporal"]["rolling"]["requireCompleteWindow"])
        self.assertEqual(calculation["temporal"]["forecast"]["status"], "not-defined")

    def test_schema_rejects_missing_provenance_and_fake_forecast(self):
        broken = copy.deepcopy(self.fixture)
        del broken["calculation"]["sources"][0]["fields"]
        with self.assertRaises(AssertionError):
            _verify(broken, self.schema, self.schema)

        broken = copy.deepcopy(self.fixture)
        broken["card"]["forecast"]["dataState"] = "approved"
        with self.assertRaises(AssertionError):
            _verify(broken, self.schema, self.schema)

        broken = copy.deepcopy(self.fixture)
        broken["calculation"]["steps"][0]["operation"] = "EVAL"
        with self.assertRaises(AssertionError):
            _verify(broken, self.schema, self.schema)

    def test_identifiers_exist_in_current_runtime(self):
        code = (ROOT / "src/js/kpi/calculator/definitions.js").read_text(encoding="utf-8")
        source_facts = (ROOT / "src/js/kpi/source_facts.js").read_text(encoding="utf-8")
        preparation = (ROOT / "src/js/kpi/preparation/index.js").read_text(encoding="utf-8")
        snapshot = (ROOT / "src/js/kpi/report_snapshot.js").read_text(encoding="utf-8")
        self.assertRegex(code, r"(?m)^\s*sla:\s*definition\(")
        self.assertIn("ReclassifierKpiPrepareSla", preparation)
        self.assertIn("closedAt:", source_facts)
        self.assertIn("slaState:", source_facts)
        self.assertIn("calculatedAt", snapshot)

    def test_spec_states_runtime_boundaries(self):
        for phrase in (
            "Предыдущее → Изменение → Прогноз",
            "KPI Result",
            "KPI Series",
            "KPI Trace",
            "KPI Card View",
            "п.п.",
            "Equipment_Combined",
            "draft",
            "не меняет",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase.casefold(), self.spec.casefold())


if __name__ == "__main__":
    unittest.main()
