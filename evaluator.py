"""
Post-Submission Evaluation & Grading Engine (Tasks 28, 29, 30)

Evaluates submitted code for each question after candidate finishes the interview:
- Executes hidden functional test suites
- Tests boundary conditions & edge cases
- Runs static code analysis (no blocking time.sleep, no forbidden external libraries)
- Calculates marks out of 100 for EACH question
- Generates comprehensive technical scorecard with feedback
"""

import re
from typing import Dict, Any, List
from datetime import datetime, timezone

from sandbox import execute_test_case, _loose_compare
from challenges import get_challenge_by_id, get_active_challenges, DEFAULT_CHALLENGES


def evaluate_single_challenge(
    challenge_id: str,
    candidate_code: str,
    session_id: str = "default"
) -> Dict[str, Any]:
    """
    Evaluates candidate code for a specific challenge.
    Returns scorecard with marks out of 100 and detailed breakdown.
    """
    challenge = get_challenge_by_id(challenge_id, session_id=session_id)
    if not challenge:
        return {
            "challenge_id": challenge_id,
            "title": "Unknown Challenge",
            "score": 0,
            "max_score": 100,
            "grade": "F",
            "feedback": ["Challenge definition not found."],
            "test_results": []
        }

    title = challenge["title"]
    hidden_cases = challenge.get("hidden_test_cases", [])
    static_rules = challenge.get("static_rules", [])

    # 1. Static Code Analysis Checks
    static_violations = []
    for rule in static_rules:
        pattern = rule.get("pattern")
        msg = rule.get("message", "Static rule violation")
        if pattern and re.search(pattern, candidate_code):
            static_violations.append(msg)

    # 2. Run Hidden Test Cases & Score
    total_possible_weight = sum(tc.get("weight", 20) for tc in hidden_cases)
    earned_weight = 0
    test_results = []
    feedback = []

    for tc in hidden_cases:
        tc_id = tc.get("id")
        name = tc.get("name", "Test")
        weight = tc.get("weight", 20)
        tc_type = tc.get("type", "functional")

        # Static inspection type
        if tc_type == "static_check":
            check = tc.get("check")
            passed = False
            error_msg = None

            if check == "no_time_sleep":
                passed = not bool(re.search(r"time\.sleep\(", candidate_code))
                if not passed:
                    error_msg = "Found blocking time.sleep() in code."
            elif check == "no_external_math_libs":
                passed = not bool(re.search(r"\b(import\s+numpy|from\s+numpy|import\s+scipy|from\s+scipy|import\s+sklearn|from\s+sklearn)\b", candidate_code))
                if not passed:
                    error_msg = "Imported external math library (numpy/scipy/sklearn)."
            else:
                passed = len(static_violations) == 0

            if passed:
                earned_weight += weight
                test_results.append({
                    "id": tc_id,
                    "name": name,
                    "status": "passed",
                    "weight": weight,
                    "earned": weight,
                    "message": "Passed static code inspection."
                })
            else:
                test_results.append({
                    "id": tc_id,
                    "name": name,
                    "status": "failed",
                    "weight": weight,
                    "earned": 0,
                    "message": error_msg or "Failed static rule check."
                })
            continue

        # Functional execution test case
        call = tc.get("call", "")
        expected = tc.get("expected")

        exec_res = execute_test_case(candidate_code, call, timeout_seconds=4.0)

        is_passed = False
        if exec_res["status"] == "success":
            actual = exec_res["result"]
            is_passed = _loose_compare(actual, expected)

        if is_passed:
            earned_weight += weight
            test_results.append({
                "id": tc_id,
                "name": name,
                "status": "passed",
                "weight": weight,
                "earned": weight,
                "duration_ms": exec_res["duration_ms"]
            })
        else:
            reason = exec_res.get("error") or "Output did not match expected result."
            test_results.append({
                "id": tc_id,
                "name": name,
                "status": exec_res["status"] if exec_res["status"] != "success" else "failed",
                "weight": weight,
                "earned": 0,
                "actual": exec_res.get("result"),
                "expected": expected,
                "duration_ms": exec_res["duration_ms"],
                "error": reason
            })

    # 3. Calculate Final Marks out of 100
    score = 0
    if total_possible_weight > 0:
        score = int(round((earned_weight / total_possible_weight) * 100))
    score = max(0, min(100, score))

    # Apply penalty if static violations exist outside weighted cases
    if static_violations:
        score = max(0, score - (len(static_violations) * 15))
        for v in static_violations:
            feedback.append(f"⚠️ Penalty: {v}")

    # Grade determination
    if score >= 90:
        grade = "A+"
        feedback.append("Excellent execution: Clean, non-blocking, and handles all edge cases.")
    elif score >= 80:
        grade = "A"
        feedback.append("Strong implementation: Passed core logic and major benchmarks.")
    elif score >= 65:
        grade = "B"
        feedback.append("Good effort: Core logic works, minor edge cases or concurrency optimizations missed.")
    elif score >= 50:
        grade = "C"
        feedback.append("Acceptable: Needs improvement on concurrency or boundary handling.")
    else:
        grade = "F"
        feedback.append("Did not meet requirements: Review problem statement and constraints.")

    passed_count = sum(1 for t in test_results if t["status"] == "passed")

    return {
        "challenge_id": challenge_id,
        "title": title,
        "score": score,
        "max_score": 100,
        "grade": grade,
        "passed_tests": passed_count,
        "total_tests": len(test_results),
        "test_results": test_results,
        "feedback": feedback,
        "candidate_code": candidate_code
    }


def evaluate_full_assessment(
    submissions: Dict[str, str],
    candidate_name: str = "Candidate",
    candidate_email: str = "candidate@example.com",
    session_metadata: Dict[str, Any] = None,
    session_id: str = "default"
) -> Dict[str, Any]:
    """
    Evaluates all submitted questions for the technical interview session.
    submissions: { "challenge_id": "candidate_python_code" }
    """
    session_metadata = session_metadata or {}
    evaluated_questions = []

    # Evaluate each challenge in sequence
    active_challenges = get_active_challenges(session_id)
    for challenge in active_challenges:
        cid = challenge["id"]
        code = submissions.get(cid, challenge["starter_code"])
        result = evaluate_single_challenge(cid, code, session_id=session_id)
        evaluated_questions.append(result)

    # Calculate overall marks out of 100
    if evaluated_questions:
        overall_score = int(round(sum(q["score"] for q in evaluated_questions) / len(evaluated_questions)))
    else:
        overall_score = 0

    if overall_score >= 90:
        overall_grade = "A+ (Outstanding)"
        recommendation = "Strongly Recommend for Hire"
    elif overall_score >= 80:
        overall_grade = "A (High Pass)"
        recommendation = "Recommend for Hire"
    elif overall_score >= 65:
        overall_grade = "B (Pass)"
        recommendation = "Viable Candidate / Proceed to Next Round"
    elif overall_score >= 50:
        overall_grade = "C (Marginal)"
        recommendation = "Borderline / Needs Review"
    else:
        overall_grade = "F (Did Not Pass)"
        recommendation = "Do Not Advance"

    return {
        "submission_id": f"sub-{int(datetime.now(timezone.utc).timestamp())}",
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "candidate_name": candidate_name,
        "candidate_email": candidate_email,
        "overall_score": overall_score,
        "overall_grade": overall_grade,
        "recommendation": recommendation,
        "total_questions": len(evaluated_questions),
        "questions": evaluated_questions,
        "session_proctoring": {
            "camera_monitored": session_metadata.get("camera_active", True),
            "audio_monitored": session_metadata.get("audio_active", True),
            "duration_seconds": session_metadata.get("duration_seconds", 0)
        }
    }
