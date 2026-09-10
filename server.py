"""
Candidate Coding Assessment Server (Tasks 28, 29, 30)

FastAPI Application providing:
- Dynamic JD-based Challenge Generator (using LLM / gpt-4o-mini)
- In-Browser Compiler & Sample Test Runner (candidate runs n times)
- Final Technical Evaluation Engine (scores out of 100 per question + LLM review)
- Proctored Web Sandbox UI Serving (Webcam & Microphone capture)
"""

import os
import json
from pathlib import Path
from typing import Dict, Any, Optional, List
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from challenges import (
    get_public_challenges,
    get_challenge_by_id,
    get_active_challenges,
    set_active_challenges_from_jd,
    DEFAULT_CHALLENGES
)
from sandbox import run_sample_tests
from evaluator import evaluate_full_assessment
from jd_generator import evaluate_with_llm

app = FastAPI(
    title="StaffGenie Technical Coding Sandbox",
    description="Generic JD-driven coding assessment with live camera/audio proctoring and automated evaluation",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
SUBMISSIONS_DIR = BASE_DIR / "submissions"
SUBMISSIONS_DIR.mkdir(exist_ok=True)

# In-memory store for fast results lookup
STORED_RESULTS: Dict[str, Dict[str, Any]] = {}


class GenerateJDRequest(BaseModel):
    job_title: str
    job_description: str
    difficulty: Optional[str] = "Medium"
    num_questions: Optional[int] = 3
    session_id: Optional[str] = "default"


class RunCodeRequest(BaseModel):
    challenge_id: str
    code: str
    session_id: Optional[str] = "default"
    challenge_index: Optional[int] = None
    challenge_title: Optional[str] = None


class SubmitAssessmentRequest(BaseModel):
    candidate_name: str = "Candidate"
    candidate_email: str = "candidate@example.com"
    candidate_id: Optional[str] = None
    task_id: Optional[str] = None
    submissions: Dict[str, str]  # { challenge_id: code }
    session_metadata: Optional[Dict[str, Any]] = None
    session_id: Optional[str] = "default"


@app.post("/api/challenges/generate-from-jd")
def generate_from_job_description(req: GenerateJDRequest):
    """
    Generates 3-4 custom coding challenges strictly tailored to the provided Job Description using LLM.
    Updates the active assessment challenges for the session.
    """
    if not req.job_description.strip():
        raise HTTPException(status_code=400, detail="Job description cannot be empty")

    challenges = set_active_challenges_from_jd(
        job_title=req.job_title,
        job_description=req.job_description,
        difficulty=req.difficulty or "Medium",
        session_id=req.session_id or "default"
    )

    public_list = get_public_challenges(session_id=req.session_id or "default")
    return {
        "success": True,
        "job_title": req.job_title,
        "total_generated": len(challenges),
        "challenges": public_list
    }


@app.get("/api/challenges")
def list_challenges(session_id: str = "default"):
    """Returns the list of challenges (without hidden test cases)."""
    return {
        "success": True,
        "session_id": session_id,
        "total": len(get_active_challenges(session_id)),
        "total_time_limit_minutes": 40,
        "challenges": get_public_challenges(session_id)
    }


@app.get("/api/challenges/{challenge_id}")
def get_challenge(challenge_id: str, session_id: str = "default"):
    """Returns single challenge detail."""
    challenge = get_challenge_by_id(challenge_id, session_id=session_id)
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")
    return {
        "success": True,
        "challenge": {
            "id": challenge["id"],
            "title": challenge["title"],
            "category": challenge["category"],
            "difficulty": challenge["difficulty"],
            "time_limit_minutes": challenge["time_limit_minutes"],
            "description_markdown": challenge["description_markdown"],
            "starter_code": challenge["starter_code"],
            "sample_test_cases": challenge["sample_test_cases"],
        }
    }


@app.post("/api/run")
def run_code_against_sample_tests(req: RunCodeRequest):
    """
    Executes candidate code against visible sample test cases.
    Candidates can run this N number of times to verify their logic.
    """
    challenge = get_challenge_by_id(
        req.challenge_id,
        session_id=req.session_id or "default",
        challenge_index=req.challenge_index,
        challenge_title=req.challenge_title
    )
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")

    sample_cases = challenge.get("sample_test_cases", [])
    results = run_sample_tests(req.code, sample_cases)

    return {
        "success": True,
        "challenge_id": req.challenge_id,
        "execution": results
    }


@app.post("/api/submit")
def submit_final_assessment(req: SubmitAssessmentRequest):
    """
    Final Technical Submission:
    Evaluates candidate's final submitted code across all questions against
    hidden test suites and produces marks out of 100 for EACH question.
    Also runs LLM architectural review for senior feedback.
    """
    session_id = req.session_id or "default"
    meta = req.session_metadata or {}
    scorecard = evaluate_full_assessment(
        submissions=req.submissions,
        candidate_name=req.candidate_name,
        candidate_email=req.candidate_email,
        session_metadata=meta,
        session_id=session_id
    )
    scorecard["session_id"] = session_id
    scorecard["session_metadata"] = meta
    if req.candidate_id:
        scorecard["candidate_id"] = req.candidate_id

    # Enhance scorecard with LLM review for questions with code
    active_challenges = get_active_challenges(session_id)
    challenge_map = {c["id"]: c for c in active_challenges}

    for q in scorecard.get("questions", []):
        cid = q.get("challenge_id")
        ch = challenge_map.get(cid)
        if ch:
            cand_code = q.get("candidate_code", "")
            summary = f"Passed {q.get('passed_tests')}/{q.get('total_tests')} hidden tests."
            try:
                llm_review = evaluate_with_llm(
                    challenge_title=ch.get("title", ""),
                    challenge_description=ch.get("description_markdown", ""),
                    candidate_code=cand_code,
                    reference_solution=ch.get("reference_solution"),
                    test_results_summary=summary
                )
                q["llm_review"] = llm_review
            except Exception:
                pass

    sub_id = scorecard["submission_id"]
    STORED_RESULTS[sub_id] = scorecard

    # Persist scorecard JSON
    try:
        sub_file = SUBMISSIONS_DIR / f"{sub_id}.json"
        with open(sub_file, "w", encoding="utf-8") as f:
            json.dump(scorecard, f, indent=2)
    except Exception as e:
        print(f"Warning: Failed to persist submission file: {e}")

    # Synchronize scorecard directly to MongoDB Recruitment database
    try:
        import pymongo
        from bson import ObjectId
        from datetime import datetime, timezone
        
        mongo_uri = os.environ.get(
            "MONGODB_URI",
            "mongodb+srv://char3d_userA:NS.AI2026@cluster0.vgyhy5m.mongodb.net/Recruitment?retryWrites=true&w=majority"
        )
        db_name = os.environ.get("MONGODB_DB", "Recruitment")
        client = pymongo.MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
        db = client[db_name]
        candidates = db["candidates"]
        
        query = {}
        if req.candidate_id and ObjectId.is_valid(req.candidate_id):
            query["_id"] = ObjectId(req.candidate_id)
        elif session_id and session_id != "default":
            query["codingToken"] = session_id
        elif req.candidate_email and req.candidate_email != "candidate@example.com":
            query["email"] = req.candidate_email

        if query:
            score = scorecard.get("overall_score", 0)
            is_violation = bool(meta.get("terminated_due_to_violation"))
            
            existing_candidate = candidates.find_one(query)
            interview_score = existing_candidate.get("interviewScore") if existing_candidate else None
            final_score = score
            if interview_score is not None:
                final_score = int(round((interview_score * 0.5) + (score * 0.5)))

            update_fields: Dict[str, Any] = {
                "codingStatus": "completed",
                "codingCompleted": True,
                "codingScore": score,
                "codingScorecard": scorecard,
                "codingCompletedAt": datetime.now(timezone.utc),
                "finalScore": final_score,
                "codingViolationDetected": is_violation,
                "codingViolationReason": meta.get("violation_reason", "Session switch detected") if is_violation else ""
            }
            if meta.get("coding_video_url"):
                update_fields["codingVideoUrl"] = meta.get("coding_video_url")

            update_op = {"$set": update_fields}
            if "email" in query and "_id" not in query and "codingToken" not in query:
                res = candidates.update_many(query, update_op)
            else:
                res = candidates.update_one(query, update_op)
            print(f"[MongoDB Sync] Updated candidate {query}: modified={res.modified_count}, score={score}, violation={is_violation}")
    except Exception as e:
        print(f"[MongoDB Sync] Warning: Could not sync to MongoDB directly: {e}")

    return {
        "success": True,
        "submission_id": sub_id,
        "scorecard": scorecard
    }


@app.get("/api/results/{submission_id}")
def get_assessment_result(submission_id: str):
    """Retrieves an evaluated assessment scorecard."""
    if submission_id in STORED_RESULTS:
        return {"success": True, "scorecard": STORED_RESULTS[submission_id]}

    sub_file = SUBMISSIONS_DIR / f"{submission_id}.json"
    if sub_file.exists():
        with open(sub_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            return {"success": True, "scorecard": data}

    raise HTTPException(status_code=404, detail="Submission scorecard not found")


@app.get("/api/results/by-token/{token}")
def get_assessment_result_by_token(token: str):
    """Retrieves latest evaluated assessment scorecard by coding token / session id."""
    # Check in-memory STORED_RESULTS in reverse order (newest first)
    for sub_id in reversed(list(STORED_RESULTS.keys())):
        sc = STORED_RESULTS[sub_id]
        if sc.get("session_id") == token or sc.get("session_metadata", {}).get("token") == token:
            return {"success": True, "scorecard": sc}

    # Check submissions directory sorted by modified time descending (newest first!)
    if SUBMISSIONS_DIR.exists():
        files = sorted(SUBMISSIONS_DIR.glob("*.json"), key=os.path.getmtime, reverse=True)
        for file in files:
            try:
                with open(file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if data.get("session_id") == token or data.get("session_metadata", {}).get("token") == token:
                        return {"success": True, "scorecard": data}
            except Exception:
                continue

    # Fallback check directly in MongoDB Recruitment database
    try:
        import pymongo
        mongo_uri = os.environ.get(
            "MONGODB_URI",
            "mongodb+srv://char3d_userA:NS.AI2026@cluster0.vgyhy5m.mongodb.net/Recruitment?retryWrites=true&w=majority"
        )
        db_name = os.environ.get("MONGODB_DB", "Recruitment")
        client = pymongo.MongoClient(mongo_uri, serverSelectionTimeoutMS=4000)
        db = client[db_name]
        candidate = db["candidates"].find_one({"codingToken": token})
        if candidate and candidate.get("codingScorecard"):
            return {"success": True, "scorecard": candidate["codingScorecard"]}
    except Exception:
        pass

    raise HTTPException(status_code=404, detail="Scorecard not found for token")


@app.get("/api/results/by-email/{email}")
def get_assessment_result_by_email(email: str):
    """Retrieves latest evaluated assessment scorecard by candidate email."""
    target_email = email.strip().lower()
    # Check in-memory STORED_RESULTS in reverse order (newest first)
    for sub_id in reversed(list(STORED_RESULTS.keys())):
        sc = STORED_RESULTS[sub_id]
        if sc.get("candidate_email", "").strip().lower() == target_email:
            return {"success": True, "scorecard": sc}

    # Check submissions directory sorted by modified time descending (newest first!)
    if SUBMISSIONS_DIR.exists():
        files = sorted(SUBMISSIONS_DIR.glob("*.json"), key=os.path.getmtime, reverse=True)
        for file in files:
            try:
                with open(file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if data.get("candidate_email", "").strip().lower() == target_email:
                        return {"success": True, "scorecard": data}
            except Exception:
                continue

    # Fallback check directly in MongoDB
    try:
        import pymongo
        mongo_uri = os.environ.get(
            "MONGODB_URI",
            "mongodb+srv://char3d_userA:NS.AI2026@cluster0.vgyhy5m.mongodb.net/Recruitment?retryWrites=true&w=majority"
        )
        db_name = os.environ.get("MONGODB_DB", "Recruitment")
        client = pymongo.MongoClient(mongo_uri, serverSelectionTimeoutMS=4000)
        db = client[db_name]
        candidate = db["candidates"].find_one({"email": target_email})
        if candidate and candidate.get("codingScorecard"):
            return {"success": True, "scorecard": candidate["codingScorecard"]}
    except Exception:
        pass

    raise HTTPException(status_code=404, detail="Scorecard not found for email")


@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "coding-assessment-sandbox", "version": "2.0.0"}


# Mount static assets
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    @app.get("/")
    async def serve_index():
        index_file = STATIC_DIR / "index.html"
        if index_file.exists():
            with open(index_file, "r", encoding="utf-8") as f:
                return HTMLResponse(content=f.read())
        return HTMLResponse("<h1>StaffGenie Coding Sandbox Server Active</h1>")


if __name__ == "__main__":
    import uvicorn
    print("Starting Coding Assessment Sandbox on http://127.0.0.1:8000 ...")
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=True)
