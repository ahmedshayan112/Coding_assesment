import urllib.request
import json

BASE_URL = "http://127.0.0.1:8000"

def test_run_code():
    code = """import math
def cosine_similarity(a, b):
    dot = sum(x*y for x,y in zip(a,b))
    na = math.sqrt(sum(x*x for x in a))
    nb = math.sqrt(sum(x*x for x in b))
    return round(dot / (na * nb), 4) if na and nb else 0.0

def rerank_documents(q, docs, top_k=3):
    res = [dict(d, score=cosine_similarity(q, d["vector"])) for d in docs]
    res.sort(key=lambda x: x["score"], reverse=True)
    return res[:top_k]
"""
    req_body = json.dumps({
        "challenge_id": "task-30-vector-similarity-reranking",
        "code": code
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{BASE_URL}/api/run",
        data=req_body,
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        print("[TEST 1: Run Code N Times]")
        print("  Status:", data["success"])
        print("  All sample tests passed:", data["execution"]["all_passed"])
        print(f"  Passed: {data['execution']['passed_count']}/{data['execution']['total_count']}")
        print(f"  Duration: {data['execution']['total_duration_ms']}ms")

def test_submit_and_evaluation():
    submissions = {
        "task-29-async-fastapi-debugging": """import asyncio
async def process_candidate_request(payload):
    await asyncio.sleep(0.01)
    score = float(payload.get('score', 0))
    return {'status': 'success', 'candidate_id': payload.get('candidate_id'), 'processed_score': round(score * 1.1, 2), 'latency_flag': 'fast'}
""",
        "task-30-vector-similarity-reranking": """import math
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

    req_body = json.dumps({
        "candidate_name": "Sarah Connor",
        "candidate_email": "sarah@ai-candidate.com",
        "submissions": submissions,
        "session_metadata": {
            "camera_active": True,
            "audio_active": True,
            "duration_seconds": 1200
        }
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{BASE_URL}/api/submit",
        data=req_body,
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        scorecard = data["scorecard"]
        print("\n[TEST 2: Final Submission & Evaluation]")
        print("  Overall Score:", f"{scorecard['overall_score']}/100")
        print("  Overall Grade:", scorecard["overall_grade"])
        print("  Recommendation:", scorecard["recommendation"])
        print("  Per-Question Marks Breakdown:")
        for q in scorecard["questions"]:
            print(f"    - {q['title']}: {q['score']}/100 (Grade: {q['grade']}, Tests Passed: {q['passed_tests']}/{q['total_tests']})")

if __name__ == "__main__":
    test_run_code()
    test_submit_and_evaluation()
