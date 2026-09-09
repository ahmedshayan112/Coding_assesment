"""
Execution Sandbox for Candidate Code (Task 28)

Executes Python code in an isolated subprocess with:
- Strict execution timeouts (prevents infinite loops)
- Standard output and error capturing
- Support for both synchronous functions and asyncio coroutines
- Latency measurement (ms)
"""

import sys
import json
import time
import subprocess
import tempfile
import os
from typing import Dict, Any, Optional


EXECUTION_HARNESS_TEMPLATE = """# -*- coding: utf-8 -*-
import sys
import json
import time
import asyncio
import inspect
from types import ModuleType

# Mock / stub common ML and Web libraries if not installed in sandbox
class _GenericMock:
    def __init__(self, *args, **kwargs): pass
    def __call__(self, *args, **kwargs): return self
    def __getattr__(self, name): return self
    def __getitem__(self, item): return self
    @classmethod
    def from_pretrained(cls, *args, **kwargs): return cls()
    def train(self, *args, **kwargs): pass
    def evaluate(self, *args, **kwargs): return dict(eval_accuracy=0.75)

for _mname in ['transformers', 'sklearn', 'sklearn.model_selection', 'torch', 'joblib', 'fastapi', 'pydantic']:
    if _mname not in sys.modules:
        try:
            __import__(_mname)
        except Exception:
            _dummy_mod = ModuleType(_mname)
            sys.modules[_mname] = _dummy_mod
            _dummy_mod.AutoModelForSequenceClassification = _GenericMock
            _dummy_mod.Trainer = _GenericMock
            _dummy_mod.TrainingArguments = _GenericMock
            _dummy_mod.FastAPI = _GenericMock
            _dummy_mod.BaseModel = object
            _dummy_mod.train_test_split = lambda *a, **kw: (a[0][:2] if a else [], a[0][2:] if a else [], a[1][:2] if len(a)>1 else [], a[1][2:] if len(a)>1 else [])
            _dummy_mod.load = lambda *a, **kw: _GenericMock()

# Candidate Submitted Code
{candidate_code}


async def _harness_main():
    {test_call_block}

if __name__ == "__main__":
    try:
        _start = time.time()
        _val = asyncio.run(_harness_main())
        _elapsed = int((time.time() - _start) * 1000)
        
        # Serialize result
        print("\\n__SANDBOX_RESULT_START__")
        try:
            print(json.dumps(_val))
        except Exception:
            print(json.dumps(str(_val)))
        print("__SANDBOX_RESULT_END__")
        print(f"__SANDBOX_TIME__={{_elapsed}}")
    except Exception as _e:
        import traceback
        _tb = traceback.format_exc()
        print("\\n__SANDBOX_ERROR_START__")
        print(json.dumps({{"type": type(_e).__name__, "message": str(_e), "traceback": _tb}}))
        print("__SANDBOX_ERROR_END__")
        sys.exit(1)
"""


def _prepare_call_block(test_call: str) -> str:
    """Formats the test case call snippet inside the async harness."""
    stripped = test_call.strip()

    # If it contains multiple statements or explicit return
    if "\n" in stripped or stripped.startswith("async def ") or stripped.startswith("def ") or "return " in stripped:
        lines = stripped.split("\n")
        indented = "\n    ".join(lines)
        return f"""{indented}"""

    # If it is a simple expression with or without await
    if stripped.startswith("await "):
        return f"""_res = {stripped}\n    return _res"""
    else:
        return f"""_res = {stripped}\n    if inspect.iscoroutine(_res):\n        _res = await _res\n    return _res"""


def execute_test_case(
    candidate_code: str,
    test_call: str,
    timeout_seconds: float = 4.0
) -> Dict[str, Any]:
    """
    Executes a single test case against the candidate's code in a subprocess.
    Returns:
      {
        "status": "passed" | "failed" | "error" | "timeout",
        "result": Any,
        "stdout": str,
        "stderr": str,
        "duration_ms": int,
        "error": str | None
      }
    """
    call_block = _prepare_call_block(test_call)
    full_script = EXECUTION_HARNESS_TEMPLATE.format(
        candidate_code=candidate_code,
        test_call_block=call_block
    )

    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False, encoding="utf-8") as tmp:
        tmp.write(full_script)
        tmp_path = tmp.name

    start_time = time.time()
    try:
        proc = subprocess.run(
            [sys.executable, "-u", tmp_path],
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            encoding="utf-8",
            errors="replace"
        )
        elapsed_ms = int((time.time() - start_time) * 1000)

        stdout_raw = proc.stdout or ""
        stderr_raw = proc.stderr or ""

        # Parse harness output markers
        clean_stdout = []
        result_json_str = None
        error_info = None

        lines = stdout_raw.split("\n")
        idx = 0
        while idx < len(lines):
            line = lines[idx]
            if line.strip() == "__SANDBOX_RESULT_START__":
                idx += 1
                r_lines = []
                while idx < len(lines) and lines[idx].strip() != "__SANDBOX_RESULT_END__":
                    r_lines.append(lines[idx])
                    idx += 1
                result_json_str = "\n".join(r_lines)
            elif line.strip() == "__SANDBOX_ERROR_START__":
                idx += 1
                e_lines = []
                while idx < len(lines) and lines[idx].strip() != "__SANDBOX_ERROR_END__":
                    e_lines.append(lines[idx])
                    idx += 1
                try:
                    error_info = json.loads("\n".join(e_lines))
                except Exception:
                    error_info = {"message": "\n".join(e_lines)}
            elif line.startswith("__SANDBOX_TIME__="):
                try:
                    elapsed_ms = int(line.split("=")[1])
                except Exception:
                    pass
            else:
                clean_stdout.append(line)
            idx += 1

        user_stdout = "\n".join(clean_stdout).strip()

        if error_info:
            err_msg = error_info.get("message", "Runtime Error")
            err_type = error_info.get("type", "Exception")
            return {
                "status": "error",
                "result": None,
                "stdout": user_stdout,
                "stderr": stderr_raw.strip(),
                "duration_ms": elapsed_ms,
                "error": f"{err_type}: {err_msg}",
                "traceback": error_info.get("traceback")
            }

        parsed_result = None
        if result_json_str is not None:
            try:
                parsed_result = json.loads(result_json_str)
            except Exception:
                parsed_result = result_json_str

        return {
            "status": "success",
            "result": parsed_result,
            "stdout": user_stdout,
            "stderr": stderr_raw.strip(),
            "duration_ms": elapsed_ms,
            "error": None
        }

    except subprocess.TimeoutExpired:
        elapsed_ms = int((time.time() - start_time) * 1000)
        return {
            "status": "timeout",
            "result": None,
            "stdout": "",
            "stderr": f"Execution timed out after {timeout_seconds}s. Check for infinite loops or blocking synchronous calls.",
            "duration_ms": elapsed_ms,
            "error": f"Execution Timeout ({timeout_seconds}s limit exceeded)"
        }
    except Exception as e:
        elapsed_ms = int((time.time() - start_time) * 1000)
        return {
            "status": "error",
            "result": None,
            "stdout": "",
            "stderr": str(e),
            "duration_ms": elapsed_ms,
            "error": str(e)
        }
    finally:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass


def run_sample_tests(candidate_code: str, sample_test_cases: list) -> Dict[str, Any]:
    """
    Runs candidate code against all visible sample test cases.
    Returns per-test breakdown with pass/fail and diff.
    """
    tests_summary = []
    all_passed = True
    total_duration = 0

    for idx, tc in enumerate(sample_test_cases):
        name = tc.get("name", f"Sample Test #{idx + 1}")
        call = tc.get("call", "")
        expected = tc.get("expected")

        exec_res = execute_test_case(candidate_code, call, timeout_seconds=4.0)
        total_duration += exec_res["duration_ms"]

        is_match = False
        if exec_res["status"] == "success":
            # Compare output
            actual = exec_res["result"]
            is_match = _loose_compare(actual, expected)

        status = "passed" if is_match else ("error" if exec_res["status"] == "error" else ("timeout" if exec_res["status"] == "timeout" else "failed"))
        if not is_match:
            all_passed = False

        tests_summary.append({
            "id": tc.get("id", f"sample-{idx}"),
            "name": name,
            "call": tc.get("call", ""),
            "status": status,
            "expected": expected,
            "actual": exec_res.get("result"),
            "stdout": exec_res.get("stdout"),
            "duration_ms": exec_res["duration_ms"],
            "error": exec_res.get("error"),
            "explanation": tc.get("explanation")
        })

    all_stdout = "\n".join(t["stdout"] for t in tests_summary if t.get("stdout")).strip()
    return {
        "all_passed": all_passed,
        "passed_count": sum(1 for t in tests_summary if t["status"] == "passed"),
        "total_count": len(tests_summary),
        "total_duration_ms": total_duration,
        "results": tests_summary,
        "test_results": tests_summary,
        "stdout": all_stdout
    }


def _loose_compare(actual: Any, expected: Any) -> bool:
    """Compares actual vs expected with tolerance for float rounding and dict key order."""
    if actual == expected:
        return True

    if isinstance(actual, float) and isinstance(expected, (float, int)):
        return abs(actual - float(expected)) < 1e-4

    if isinstance(actual, dict) and isinstance(expected, dict):
        if set(actual.keys()) != set(expected.keys()):
            return False
        return all(_loose_compare(actual[k], expected[k]) for k in actual)

    if isinstance(actual, list) and isinstance(expected, list):
        if len(actual) != len(expected):
            return False
        return all(_loose_compare(a, e) for a, e in zip(actual, expected))

    return False
