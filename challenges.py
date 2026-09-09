"""
Challenges Registry for Candidate Coding Assessment (Tasks 28, 29, 30)

Supports:
- Dynamic generation tailored directly to candidate's Job Description (JD)
- Built-in default challenges for AI / Backend / Data roles
- Safe extraction of public schema vs hidden evaluation suites
"""

from typing import Dict, Any, List, Optional
from jd_generator import generate_challenges_from_jd

# Default benchmark challenges (Task 29 & Task 30)
DEFAULT_CHALLENGES: List[Dict[str, Any]] = [
    {
        "id": "task-29-async-fastapi-debugging",
        "title": "Task 29: Async/FastAPI Concurrency & Blocking Call Debugging",
        "category": "Async Python / Backend Concurrency",
        "difficulty": "Medium",
        "time_limit_minutes": 15,
        "description_markdown": """### Problem Statement
You are given a broken asynchronous service intended for high-concurrency workloads (e.g. FastAPI / asyncio microservice).

In production, incoming requests are experiencing **severe latency spikes and starvation**:
1. When 5 concurrent requests hit the endpoint, instead of completing concurrently in ~1 second, they are queuing sequentially and taking **5+ seconds**.
2. Investigation revealed **blocking synchronous calls** (`time.sleep`), **un-awaited coroutines**, and improper I/O inside the async request handler.

### Your Task
Fix the `process_candidate_request` function and its helper routines:
- Eliminate the event loop blocking calls.
- Use proper non-blocking asynchronous concurrency (`asyncio.sleep`, proper `await`, or thread offloading where appropriate).
- Ensure that 5 concurrent requests can all complete within **1.4 seconds total** without thread starvation.
- Correctly process the incoming candidate data dictionary and return the final sanitized response:
  `{"status": "success", "candidate_id": id, "processed_score": round(score * 1.1, 2), "latency_flag": "fast"}`

### Constraints
- Do NOT use synchronous `time.sleep()`.
- Do NOT block the primary asyncio event loop.
- All returned numeric scores must be rounded to 2 decimal places.
""",
        "starter_code": """import asyncio
import time
from typing import Dict, Any

# --- BROKEN CODE (STARVATION & BLOCKING CALLS) ---
# Candidates must debug and fix the blocking calls, starvation, and async awaits.

def simulate_heavy_db_fetch(candidate_id: str) -> dict:
    # BUG: Blocking synchronous sleep blocks the entire asyncio event loop!
    time.sleep(0.3)
    return {"id": candidate_id, "active": True}

async def process_candidate_request(payload: Dict[str, Any]) -> Dict[str, Any]:
    candidate_id = payload.get("candidate_id", "unknown")
    raw_score = float(payload.get("score", 0.0))

    # BUG 1: Synchronous blocking call on the event loop
    db_record = simulate_heavy_db_fetch(candidate_id)

    # BUG 2: Synchronous sleep blocking all concurrent requests
    time.sleep(0.5)

    # Calculate score
    processed = round(raw_score * 1.1, 2)

    return {
        "status": "success",
        "candidate_id": candidate_id,
        "processed_score": processed,
        "latency_flag": "fast"
    }
""",
        "sample_test_cases": [
            {
                "id": "sample-1",
                "name": "Single Payload Correctness",
                "call": "await process_candidate_request({'candidate_id': 'c-101', 'score': 80.0})",
                "expected": {
                    "status": "success",
                    "candidate_id": "c-101",
                    "processed_score": 88.0,
                    "latency_flag": "fast"
                },
                "explanation": "Validates score multiplication (80.0 * 1.1 = 88.0) and output formatting."
            },
            {
                "id": "sample-2",
                "name": "Concurrency & Non-Blocking Throughput (3 Concurrent Requests)",
                "call": """async def _run():
    import asyncio, time
    start = time.time()
    tasks = [process_candidate_request({'candidate_id': f'c-{i}', 'score': 70.0}) for i in range(3)]
    results = await asyncio.gather(*tasks)
    duration = time.time() - start
    return {"count": len(results), "is_fast": duration < 1.2}
return await _run()""",
                "expected": {
                    "count": 3,
                    "is_fast": True
                },
                "explanation": "3 concurrent requests must finish concurrently in < 1.2s instead of sequentially in 2.4s+."
            }
        ],
        "hidden_test_cases": [
            {
                "id": "hidden-1",
                "name": "Single Request Baseline Calculation",
                "weight": 25,
                "call": "await process_candidate_request({'candidate_id': 'c-999', 'score': 90.5})",
                "expected": {"status": "success", "candidate_id": "c-999", "processed_score": 99.55, "latency_flag": "fast"}
            },
            {
                "id": "hidden-2",
                "name": "High Concurrency Starvation Test (5 Requests < 1.4s)",
                "weight": 35,
                "call": """async def _run():
    import asyncio, time
    start = time.time()
    tasks = [process_candidate_request({'candidate_id': f'c-{i}', 'score': 50.0 + i}) for i in range(5)]
    results = await asyncio.gather(*tasks)
    duration = time.time() - start
    return {"completed": len(results), "non_blocking": duration < 1.4}
return await _run()""",
                "expected": {"completed": 5, "non_blocking": True}
            },
            {
                "id": "hidden-3",
                "name": "Zero & Edge Case Score Handling",
                "weight": 20,
                "call": "await process_candidate_request({'candidate_id': 'edge-0', 'score': 0.0})",
                "expected": {"status": "success", "candidate_id": "edge-0", "processed_score": 0.0, "latency_flag": "fast"}
            },
            {
                "id": "hidden-4",
                "name": "Static Inspection: No Blocking time.sleep",
                "weight": 20,
                "type": "static_check",
                "check": "no_time_sleep",
                "description": "Code must not invoke blocking time.sleep() inside async execution paths."
            }
        ],
        "static_rules": [
            {"type": "forbid_pattern", "pattern": r"time\.sleep\(", "message": "Blocking call 'time.sleep()' detected! Use 'asyncio.sleep()' or 'asyncio.to_thread()' instead."}
        ]
    },
    {
        "id": "task-30-vector-similarity-reranking",
        "title": "Task 30: Vector Similarity & Cosine Reranking from Scratch",
        "category": "Machine Learning / Algorithms",
        "difficulty": "Medium",
        "time_limit_minutes": 15,
        "description_markdown": """### Problem Statement
In production vector databases and retrieval-augmented generation (RAG) pipelines, candidate embedding vectors are reranked based on semantic proximity to a recruiter query.

You must implement **Cosine Similarity and Top-K Vector Reranking using pure Python**.
To test your algorithmic fundamentals, **external mathematical packages (numpy, scipy, scikit-learn) are strictly forbidden**.

### Your Task
Implement two functions:

1. `cosine_similarity(vec_a: List[float], vec_b: List[float]) -> float`:
   - Compute: `dot_product(vec_a, vec_b) / (norm(vec_a) * norm(vec_b))`
   - Where `norm(v) = sqrt(sum(x^2 for x in v))`
   - **Edge Cases**:
     - If either vector has zero magnitude (`norm == 0`), return `0.0` (prevent `ZeroDivisionError`).
     - If `len(vec_a) != len(vec_b)`, raise a `ValueError("Vector dimensions must match")`.
   - Return a float rounded to **4 decimal places**.

2. `rerank_documents(query_vec: List[float], documents: List[Dict[str, Any]], top_k: int = 3) -> List[Dict[str, Any]]`:
   - Each item in `documents` is a dictionary: `{"id": str, "title": str, "vector": List[float]}`.
   - Calculate the cosine similarity between `query_vec` and each document's `"vector"`.
   - Add a `"score"` key to each document containing the calculated similarity rounded to 4 decimals.
   - Return the top `top_k` documents sorted by `"score"` in descending order.

### Constraints
- **Strict Rule**: Rely only on Python standard library (`math`, `typing`, etc.).
- Do **NOT** import `numpy`, `scipy`, or `sklearn`.
""",
        "starter_code": """import math
from typing import List, Dict, Any

def cosine_similarity(vec_a: List[float], vec_b: List[float]) -> float:
    \"\"\"
    Compute cosine similarity between two vectors using pure Python.
    Formula: dot_product(a, b) / (norm(a) * norm(b))
    Returns 0.0 if either norm is zero.
    Raises ValueError if lengths do not match.
    \"\"\"
    # TODO: Implement cosine similarity from scratch
    pass

def rerank_documents(query_vec: List[float], documents: List[Dict[str, Any]], top_k: int = 3) -> List[Dict[str, Any]]:
    \"\"\"
    Reranks documents by cosine similarity against query_vec.
    Returns top_k documents sorted in descending order of 'score'.
    \"\"\"
    # TODO: Implement document reranking
    pass
""",
        "sample_test_cases": [
            {
                "id": "sample-1",
                "name": "Identical Parallel Vectors",
                "call": "cosine_similarity([1.0, 2.0, 3.0], [1.0, 2.0, 3.0])",
                "expected": 1.0,
                "explanation": "Identical vectors have an angle of 0 degrees, cosine similarity = 1.0"
            },
            {
                "id": "sample-2",
                "name": "Orthogonal Vectors",
                "call": "cosine_similarity([1.0, 0.0], [0.0, 1.0])",
                "expected": 0.0,
                "explanation": "Perpendicular vectors have a dot product of 0, cosine similarity = 0.0"
            },
            {
                "id": "sample-3",
                "name": "Top-2 Document Reranking",
                "call": """docs = [
    {"id": "doc-1", "title": "FastAPI Guide", "vector": [0.9, 0.1, 0.0]},
    {"id": "doc-2", "title": "PyTorch Deep Learning", "vector": [0.1, 0.9, 0.1]},
    {"id": "doc-3", "title": "Microservices API", "vector": [0.8, 0.2, 0.1]},
]
q = [1.0, 0.0, 0.0]
return [{"id": d["id"], "score": d["score"]} for d in rerank_documents(q, docs, top_k=2)]""",
                "expected": [
                    {"id": "doc-1", "score": 0.9939},
                    {"id": "doc-3", "score": 0.9631}
                ],
                "explanation": "Documents with highest alignment to query [1.0, 0.0, 0.0] ranked top."
            }
        ],
        "hidden_test_cases": [
            {
                "id": "hidden-1",
                "name": "Dimension Mismatch Validation",
                "weight": 20,
                "call": """try:
    cosine_similarity([1.0, 2.0], [1.0, 2.0, 3.0])
    return False
except ValueError:
    return True""",
                "expected": True
            },
            {
                "id": "hidden-2",
                "name": "Zero Vector Handling (No ZeroDivisionError)",
                "weight": 20,
                "call": "cosine_similarity([0.0, 0.0, 0.0], [1.0, 2.0, 3.0])",
                "expected": 0.0
            },
            {
                "id": "hidden-3",
                "name": "Opposite Negative Vectors",
                "weight": 20,
                "call": "cosine_similarity([1.0, 2.0], [-1.0, -2.0])",
                "expected": -1.0
            },
            {
                "id": "hidden-4",
                "name": "High-Dimensional Top-K Reranking (16-D Vectors)",
                "weight": 25,
                "call": """q = [0.1] * 16
docs = [
    {"id": "d1", "title": "A", "vector": [0.1] * 16},
    {"id": "d2", "title": "B", "vector": [-0.1] * 16},
    {"id": "d3", "title": "C", "vector": [0.05] * 16}
]
res = rerank_documents(q, docs, top_k=2)
return [d["id"] for d in res]""",
                "expected": ["d1", "d3"]
            },
            {
                "id": "hidden-5",
                "name": "Pure Python Static Rule (No numpy/scipy/sklearn)",
                "weight": 15,
                "type": "static_check",
                "check": "no_external_math_libs",
                "description": "Code must implement vectors from scratch without importing numpy, scipy, or sklearn."
            }
        ],
        "static_rules": [
            {"type": "forbid_pattern", "pattern": r"\b(import\s+numpy|from\s+numpy|import\s+scipy|from\s+scipy|import\s+sklearn|from\s+sklearn)\b", "message": "External library detected! Pure Python implementation required (numpy/scipy/sklearn are forbidden)."}
        ]
    },
    {
        "id": "task-31-streaming-sliding-window",
        "title": "Task 31: Real-Time Streaming Sliding Window Aggregator",
        "category": "Data Engineering / Systems",
        "difficulty": "Medium",
        "time_limit_minutes": 10,
        "description_markdown": """### Problem Statement
In real-time monitoring and interview telemetry pipelines, metrics (such as candidate audio decibel levels or latency) stream continuously.

You must implement a **Sliding Window Aggregator** that efficiently tracks numeric events within a sliding time window (in seconds) without memory leaks.

### Your Task
Implement the `SlidingWindowStats` class:

1. `__init__(self, window_seconds: float)`:
   - Initialize window size.
2. `record_event(self, value: float, timestamp: float) -> None`:
   - Append a new event.
   - Automatically evict events older than `timestamp - window_seconds`.
3. `get_stats(self, current_time: float) -> Dict[str, Any]`:
   - Evict any events older than `current_time - window_seconds`.
   - Return dictionary:
     `{"count": int, "mean": float, "min": float, "max": float}`
   - If no active events remain in the window:
     Return `{"count": 0, "mean": 0.0, "min": 0.0, "max": 0.0}`
   - All float values must be rounded to 2 decimal places.

### Constraints
- Timestamps are non-decreasing floats (seconds).
- Keep memory bounded to only active window items.
""",
        "starter_code": """from typing import Dict, Any
from collections import deque

class SlidingWindowStats:
    def __init__(self, window_seconds: float):
        self.window_seconds = window_seconds
        # TODO: Initialize tracking structure (e.g. deque)
        pass

    def record_event(self, value: float, timestamp: float) -> None:
        # TODO: Record event and prune expired
        pass

    def get_stats(self, current_time: float) -> Dict[str, Any]:
        # TODO: Prune expired events and compute statistics
        pass
""",
        "sample_test_cases": [
            {
                "id": "sample-1",
                "name": "Basic Window Aggregation",
                "call": """agg = SlidingWindowStats(window_seconds=10.0)
agg.record_event(10.0, timestamp=100.0)
agg.record_event(20.0, timestamp=105.0)
return agg.get_stats(current_time=106.0)""",
                "expected": {"count": 2, "mean": 15.0, "min": 10.0, "max": 20.0},
                "explanation": "Both events (at t=100 and t=105) are within the 10-second window at t=106."
            },
            {
                "id": "sample-2",
                "name": "Eviction of Expired Events",
                "call": """agg = SlidingWindowStats(window_seconds=5.0)
agg.record_event(50.0, timestamp=10.0) # Expired at 16.0
agg.record_event(10.0, timestamp=14.0) # Active
return agg.get_stats(current_time=16.0)""",
                "expected": {"count": 1, "mean": 10.0, "min": 10.0, "max": 10.0},
                "explanation": "Event at t=10 is older than 16 - 5 = 11, so it is evicted."
            }
        ],
        "hidden_test_cases": [
            {
                "id": "hidden-1",
                "name": "Empty Window Baseline",
                "weight": 25,
                "call": """agg = SlidingWindowStats(window_seconds=5.0)
return agg.get_stats(current_time=50.0)""",
                "expected": {"count": 0, "mean": 0.0, "min": 0.0, "max": 0.0}
            },
            {
                "id": "hidden-2",
                "name": "Full Window Sliding Sequence",
                "weight": 40,
                "call": """agg = SlidingWindowStats(window_seconds=4.0)
for t, val in [(1.0, 5.0), (2.0, 10.0), (3.0, 15.0), (6.0, 20.0)]:
    agg.record_event(val, timestamp=t)
return agg.get_stats(current_time=6.0)""",
                "expected": {"count": 2, "mean": 17.5, "min": 15.0, "max": 20.0}
            },
            {
                "id": "hidden-3",
                "name": "Boundary Timestamp Eviction",
                "weight": 35,
                "call": """agg = SlidingWindowStats(window_seconds=2.0)
agg.record_event(100.0, timestamp=10.0)
agg.record_event(200.0, timestamp=12.0)
return agg.get_stats(current_time=12.0)""",
                "expected": {"count": 2, "mean": 150.0, "min": 100.0, "max": 200.0}
            }
        ],
        "static_rules": []
    }
]

# Session challenges registry (keyed by session_id or global current)
_CHALLENGES_STORE: Dict[str, List[Dict[str, Any]]] = {
    "default": DEFAULT_CHALLENGES
}


def set_active_challenges_from_jd(
    job_title: str,
    job_description: str,
    difficulty: str = "Medium",
    session_id: str = "default"
) -> List[Dict[str, Any]]:
    """Synthesizes or generates challenges tailored strictly to the JD."""
    generated = generate_challenges_from_jd(job_title, job_description, difficulty)
    _CHALLENGES_STORE[session_id] = generated
    return generated


def get_active_challenges(session_id: str = "default") -> List[Dict[str, Any]]:
    return _CHALLENGES_STORE.get(session_id, DEFAULT_CHALLENGES)


def get_public_challenges(session_id: str = "default") -> List[Dict[str, Any]]:
    """Returns list of active challenges without hidden test cases."""
    active = get_active_challenges(session_id)
    public_list = []
    for c in active:
        public_list.append({
            "id": c["id"],
            "title": c["title"],
            "category": c["category"],
            "difficulty": c["difficulty"],
            "time_limit_minutes": c["time_limit_minutes"],
            "description_markdown": c["description_markdown"],
            "starter_code": c["starter_code"],
            "sample_test_cases": c["sample_test_cases"],
        })
    return public_list


def get_challenge_by_id(challenge_id: str, session_id: str = "default") -> Optional[Dict[str, Any]]:
    active = get_active_challenges(session_id)
    for c in active:
        if c["id"] == challenge_id:
            return c
    # Fallback to defaults
    for c in DEFAULT_CHALLENGES:
        if c["id"] == challenge_id:
            return c
    return None
