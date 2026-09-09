"""
Automated Test Suite for Coding Assessment & Evaluation Engine (Tasks 28, 29, 30)
"""

import unittest
from sandbox import execute_test_case, run_sample_tests
from challenges import get_challenge_by_id, get_public_challenges
from evaluator import evaluate_single_challenge, evaluate_full_assessment
from jd_generator import extract_jd_competencies, generate_challenges_from_jd


class TestExecutionSandbox(unittest.TestCase):
    def test_sync_execution(self):
        code = """
def add(a, b):
    return a + b
"""
        res = execute_test_case(code, "add(10, 25)")
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["result"], 35)

    def test_async_execution(self):
        code = """
import asyncio
async def fetch_val():
    await asyncio.sleep(0.01)
    return {"status": "ok", "val": 42}
"""
        res = execute_test_case(code, "await fetch_val()")
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["result"], {"status": "ok", "val": 42})

    def test_timeout_handling(self):
        # Code with infinite loop must timeout within 1 second
        code = """
def infinite():
    while True:
        pass
"""
        res = execute_test_case(code, "infinite()", timeout_seconds=1.0)
        self.assertEqual(res["status"], "timeout")
        self.assertIn("Timeout", res["error"])

    def test_syntax_runtime_error(self):
        code = """
def broken():
    return 1 / 0
"""
        res = execute_test_case(code, "broken()")
        self.assertEqual(res["status"], "error")
        self.assertIn("ZeroDivisionError", res["error"])


class TestJDCompetencyExtractor(unittest.TestCase):
    def test_extract_skills(self):
        jd = """
        Looking for a Senior Python / FastAPI backend engineer to build real-time RAG
        pipelines using vector embeddings, cosine similarity, and streaming data aggregators.
        """
        comp = extract_jd_competencies(jd)
        self.assertTrue(comp["is_backend"])
        self.assertTrue(comp["is_ai_ml"])
        self.assertTrue(comp["is_data_eng"])
        self.assertTrue(comp["is_senior"])
        self.assertIn("fastapi", comp["technologies"])


class TestTask29Evaluation(unittest.TestCase):
    def test_broken_code_receives_low_score(self):
        # Default broken starter code with blocking sleep
        broken_code = """
import time
async def process_candidate_request(payload):
    time.sleep(0.5)
    score = float(payload.get('score', 0))
    return {'status': 'success', 'candidate_id': payload.get('candidate_id'), 'processed_score': round(score * 1.1, 2), 'latency_flag': 'fast'}
"""
        res = evaluate_single_challenge("task-29-async-fastapi-debugging", broken_code)
        # Violates static rule (time.sleep) and concurrency benchmark
        self.assertTrue(res["score"] < 70)

    def test_fixed_async_code_receives_high_marks(self):
        # Properly fixed non-blocking async code
        fixed_code = """
import asyncio
from typing import Dict, Any

async def simulate_heavy_db_fetch(candidate_id: str) -> dict:
    await asyncio.sleep(0.01)
    return {"id": candidate_id, "active": True}

async def process_candidate_request(payload: Dict[str, Any]) -> Dict[str, Any]:
    candidate_id = payload.get("candidate_id", "unknown")
    raw_score = float(payload.get("score", 0.0))

    await simulate_heavy_db_fetch(candidate_id)
    await asyncio.sleep(0.01)

    processed = round(raw_score * 1.1, 2)
    return {
        "status": "success",
        "candidate_id": candidate_id,
        "processed_score": processed,
        "latency_flag": "fast"
    }
"""
        res = evaluate_single_challenge("task-29-async-fastapi-debugging", fixed_code)
        self.assertGreaterEqual(res["score"], 90)
        self.assertEqual(res["grade"], "A+")


class TestTask30Evaluation(unittest.TestCase):
    def test_pure_python_vector_similarity_correctness(self):
        correct_code = """
import math
from typing import List, Dict, Any

def cosine_similarity(vec_a: List[float], vec_b: List[float]) -> float:
    if len(vec_a) != len(vec_b):
        raise ValueError("Vector dimensions must match")
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return round(dot / (norm_a * norm_b), 4)

def rerank_documents(query_vec: List[float], documents: List[Dict[str, Any]], top_k: int = 3) -> List[Dict[str, Any]]:
    scored = []
    for d in documents:
        sim = cosine_similarity(query_vec, d.get("vector", []))
        item = dict(d)
        item["score"] = sim
        scored.append(item)
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:top_k]
"""
        res = evaluate_single_challenge("task-30-vector-similarity-reranking", correct_code)
        self.assertEqual(res["score"], 100)
        self.assertEqual(res["passed_tests"], res["total_tests"])
        self.assertEqual(res["grade"], "A+")


class TestFullAssessmentEvaluation(unittest.TestCase):
    def test_full_submission_scorecard(self):
        submissions = {
            "task-29-async-fastapi-debugging": """
import asyncio
async def process_candidate_request(payload):
    await asyncio.sleep(0.01)
    score = float(payload.get('score', 0))
    return {'status': 'success', 'candidate_id': payload.get('candidate_id'), 'processed_score': round(score * 1.1, 2), 'latency_flag': 'fast'}
""",
            "task-30-vector-similarity-reranking": """
import math
def cosine_similarity(vec_a, vec_b):
    if len(vec_a) != len(vec_b): raise ValueError()
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    na = math.sqrt(sum(a * a for a in vec_a))
    nb = math.sqrt(sum(b * b for b in vec_b))
    if na == 0 or nb == 0: return 0.0
    return round(dot / (na * nb), 4)

def rerank_documents(q, docs, top_k=3):
    res = [dict(d, score=cosine_similarity(q, d["vector"])) for d in docs]
    res.sort(key=lambda x: x["score"], reverse=True)
    return res[:top_k]
"""
        }

        scorecard = evaluate_full_assessment(submissions, candidate_name="Test Candidate")
        self.assertIn("submission_id", scorecard)
        self.assertGreaterEqual(scorecard["overall_score"], 30)
        self.assertGreaterEqual(len(scorecard["questions"]), 2)
        # Check marks out of 100 for each question
        for q in scorecard["questions"]:
            self.assertIn("score", q)
            self.assertEqual(q["max_score"], 100)
            self.assertTrue(0 <= q["score"] <= 100)


if __name__ == "__main__":
    unittest.main()
