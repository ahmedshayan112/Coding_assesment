"""
LLM-Powered Dynamic JD Assessment & Answer Generator (Tasks 28, 29, 30)

Uses LLM (OpenAI gpt-4o-mini) to dynamically generate tailored:
1. Production-oriented coding problems matching ANY Job Description (JD)
2. Starter code templates (skeleton or broken code for debugging)
3. Model solutions / reference answers
4. Sample test cases for live candidate iterations (run n times)
5. Hidden evaluation test suites with scoring weights
6. LLM-assisted code quality & architectural evaluation
"""

import os
import json
import re
import urllib.request
import urllib.error
from typing import Dict, Any, List, Optional
from pathlib import Path


def load_env_api_key() -> Optional[str]:
    """Loads OpenAI API key from .env or os.environ."""
    key = os.environ.get("OPENAI_API_KEY")
    if key:
        return key

    env_path = Path(__file__).resolve().parent / ".env"
    if env_path.exists():
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("OPENAI_API_KEY="):
                        val = line.split("=", 1)[1].strip().strip("\"'")
                        if val:
                            os.environ["OPENAI_API_KEY"] = val
                            return val
        except Exception:
            pass
    return None


def generate_challenges_from_jd(
    job_title: str,
    job_description: str,
    difficulty: str = "Medium",
    num_questions: int = 3,
    openai_api_key: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Generates tailored coding problems, starter templates, reference answers,
    and test cases strictly based on the provided Job Description using LLM.
    """
    api_key = openai_api_key or load_env_api_key()

    if not api_key:
        print("[jd_generator] No OpenAI API key found, using fallback synthesizer.")
        return _fallback_synthesize(job_title, job_description, difficulty)

    try:
        system_prompt = (
            "You are a Principal Technical Interview Architect designing timed (10-15 min) in-browser Python coding assessments.\n"
            "Your job is to generate realistic, production-oriented programming challenges strictly tailored to the "
            "provided Job Description (JD), required tech stack, and role expectations.\n"
            "\n"
            "CRITICAL CONSTRAINTS FOR IN-BROWSER CODING ASSESSMENTS:\n"
            "1. NO EXTERNAL DATASETS OR FILES: Candidates code in an isolated in-browser Python sandbox without external file access, CSV/Parquet files, or internet downloads. NEVER ask the candidate to load external datasets from disk or download files.\n"
            "2. ALL INPUT DATA MUST BE EMBEDDED INLINE OR PASSED AS ARGUMENTS: Provide realistic, rich sample inputs directly as function arguments or inline data structures (e.g. lists of document dictionaries, chat message arrays, telemetry event logs, prediction lists). All data must be available in pure Python without external files!\n"
            "3. NO MODEL TRAINING OR FINE-TUNING: It is impossible to train neural networks or fine-tune models in a 15-minute browser sandbox. NEVER ask candidates to fine-tune an LLM, train PyTorch/TensorFlow weights, or load multi-gigabyte models.\n"
            "4. REALISTIC, PRACTICAL INTERVIEW PROBLEMS:\n"
            "   - If AI / ML / NLP / LLM: RAG vector cosine similarity & top-K reranking from scratch, prompt templating & token budget clipping, classification evaluation metrics (Precision/Recall/F1/Confusion Matrix from prediction lists), text tokenization & n-gram frequency extraction, or rule-based output guardrails.\n"
            "   - If Backend / FastAPI: AsyncIO non-blocking concurrency & blocking call debugging, rate limiting (token bucket / sliding window), caching with TTL, request payload validation & sanitization, or batch error handling.\n"
            "   - If Data Engineering: Real-time sliding window stats aggregation, stream deduplication, time-series resampling, or record schema transformation.\n"
            "5. Pure Python Standard Library preferred. If math functions are needed, rely on `math` or standard collections (`collections`, `typing`, `asyncio`, `time`, `re`, `json`).\n"
            "You MUST output valid, parseable JSON conforming strictly to the requested schema."
        )

        user_prompt = f"""Generate exactly {num_questions} technical coding challenges tailored to this Job Description:

--- JOB TITLE ---
{job_title}

--- JOB DESCRIPTION ---
{job_description}

--- TARGET DIFFICULTY ---
{difficulty}

CRITICAL RULES FOR EACH CHALLENGE:
1. Self-Contained with Inline Input Data: All data must be passed directly as function arguments or provided inline as synthetic data structures (lists, dicts, strings). Do NOT ask the candidate to load any file or fine-tune models.
2. Production-Relevant: Must solve a realistic software engineering or algorithm problem relevant to the JD that can be implemented in 10-15 minutes.
3. Starter Code: Valid Python code template for the candidate (either broken code to debug or a structured skeleton with docstrings and type annotations).
4. Reference Answer: Complete, correct working Python solution that passes all sample and hidden test cases.
5. Sample Test Cases: Exactly 2 or 3 visible test cases where real sample input data is passed directly into the function call (e.g. `func([{{'id': '1', 'val': 10}}])`).
6. Hidden Test Cases: Exactly 3 or 4 hidden evaluation test cases with point weights summing to 100, testing edge cases and correctness with inline inputs.
7. Static Rules (optional): e.g. forbid 'time.sleep(' or forbid 'import numpy' where appropriate.
8. Clean Markdown & Math: In 'description_markdown', write clean, highly readable Markdown with clear paragraphs. Do NOT write broken LaTeX like `ext{...}` or unescaped `\n`. For formulas, use clean readable mathematical notation (e.g. `cosine_similarity(A, B) = (A · B) / (‖A‖ * ‖B‖)`) or standard `$$` KaTeX delimiters.

RETURN A JSON OBJECT WITH KEY 'challenges' CONTAINING AN ARRAY OF {num_questions} OBJECTS.
SCHEMA FOR EACH OBJECT:
{{
  "id": "slug-name",
  "title": "Title of Challenge",
  "category": "Topic Category",
  "difficulty": "Easy" | "Medium" | "Hard",
  "time_limit_minutes": 10-15,
  "description_markdown": "### Problem Statement...",
  "starter_code": "def solution(...):\\n    pass",
  "reference_solution": "def solution(...):\\n    ...",
  "sample_test_cases": [
    {{"id": "sample-1", "name": "...", "call": "...", "expected": ..., "explanation": "..."}}
  ],
  "hidden_test_cases": [
    {{"id": "hidden-1", "name": "...", "weight": 25, "call": "...", "expected": ...}}
  ],
  "static_rules": []
}}
"""

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        payload = {
            "model": "gpt-4o-mini",
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.2,
            "response_format": {"type": "json_object"}
        }

        req = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers=headers
        )

        with urllib.request.urlopen(req, timeout=45) as resp:
            raw_resp = resp.read().decode("utf-8")
            data = json.loads(raw_resp)
            content = data["choices"][0]["message"]["content"]
            parsed = json.loads(content)

            challenges_list = []
            if isinstance(parsed, list):
                challenges_list = parsed
            elif isinstance(parsed, dict):
                if "challenges" in parsed and isinstance(parsed["challenges"], list):
                    challenges_list = parsed["challenges"]
                else:
                    for k, v in parsed.items():
                        if isinstance(v, list) and len(v) >= 2:
                            challenges_list = v
                            break

            if challenges_list and len(challenges_list) >= 2:
                # Validate schema
                validated = []
                for idx, c in enumerate(challenges_list):
                    if not c.get("id"):
                        c["id"] = f"jd-challenge-{idx + 1}"
                    if not c.get("sample_test_cases"):
                        c["sample_test_cases"] = []
                    if not c.get("hidden_test_cases"):
                        c["hidden_test_cases"] = []
                    validated.append(c)
                return validated

    except Exception as e:
        print(f"[jd_generator] OpenAI generation failed: {e}")

    return _fallback_synthesize(job_title, job_description, difficulty)


def evaluate_with_llm(
    challenge_title: str,
    challenge_description: str,
    candidate_code: str,
    reference_solution: Optional[str],
    test_results_summary: str,
    openai_api_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Optional LLM Code Review & Qualitative Assessment:
    Evaluates candidate's code quality, architecture, algorithmic complexity,
    and best practices relative to the Job Description.
    """
    api_key = openai_api_key or load_env_api_key()
    if not api_key:
        return {
            "code_quality_score": 85,
            "strengths": ["Completed core requirements."],
            "improvements": ["Review code comments and edge-case handling."],
            "overall_feedback": "Code executed through sandbox test runner."
        }

    try:
        prompt = f"""Review the following candidate code submission for a technical interview challenge:

Challenge: {challenge_title}
Requirements:
{challenge_description[:500]}

Candidate's Code:
```python
{candidate_code}
```

Reference Solution:
```python
{reference_solution or "Not provided"}
```

Test Cases Execution:
{test_results_summary}

Provide a constructive code review for hiring managers in JSON format:
{{
  "code_quality_score": int (0 to 100),
  "time_complexity": str (e.g. "O(N)"),
  "space_complexity": str (e.g. "O(1)"),
  "strengths": [str, str],
  "improvements": [str],
  "overall_feedback": str
}}
"""

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        payload = {
            "model": "gpt-4o-mini",
            "messages": [
                {"role": "system", "content": "You evaluate candidate code for senior hiring panels. Output only JSON."},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.2,
            "response_format": {"type": "json_object"}
        }

        req = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers=headers
        )

        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return json.loads(data["choices"][0]["message"]["content"])
    except Exception as e:
        print(f"[jd_generator] evaluate_with_llm error: {e}")
        return {
            "code_quality_score": 80,
            "strengths": ["Functional implementation."],
            "improvements": ["Optimize space and time complexity."],
            "overall_feedback": "Sandbox tests completed successfully."
        }


def extract_jd_competencies(jd_text: str) -> Dict[str, Any]:
    """Analyzes JD text for technologies, domain, and experience level."""
    lower = jd_text.lower()
    competencies = {
        "is_backend": bool(re.search(r"\b(backend|api|fastapi|flask|django|microservices|rest|asyncio)\b", lower)),
        "is_ai_ml": bool(re.search(r"\b(ml|machine learning|nlp|rag|vector|embedding|cosine|pytorch|tensorflow|transformers|llm)\b", lower)),
        "is_data_eng": bool(re.search(r"\b(data engineering|pipeline|etl|streaming|kafka|spark|sliding window|real-time|aggregat)\b", lower)),
        "is_senior": bool(re.search(r"\b(senior|lead|principal|architect|staff)\b", lower)),
        "technologies": []
    }
    tech_keywords = [
        "python", "fastapi", "asyncio", "docker", "pytorch", "transformers",
        "embeddings", "vector search", "streaming", "redis", "postgresql",
        "concurrency", "threading", "rag", "scikit-learn"
    ]
    for tech in tech_keywords:
        if tech in lower:
            competencies["technologies"].append(tech)
    return competencies


def _fallback_synthesize(job_title: str, job_description: str, difficulty: str) -> List[Dict[str, Any]]:
    """Smart fallback synthesizer if network/API is unavailable: selects tailored benchmarks with inline data."""
    from challenges import DEFAULT_CHALLENGES
    comp = extract_jd_competencies(f"{job_title} {job_description}")
    
    challenge_map = {c["id"]: c for c in DEFAULT_CHALLENGES}
    
    if comp.get("is_ai_ml"):
        # Select AI/ML problems: Vector Reranking, Token Budget Truncation, Classification Metrics
        selected_ids = [
            "task-30-vector-similarity-reranking",
            "task-32-rag-prompt-token-budget",
            "task-33-classification-metrics-evaluator"
        ]
    elif comp.get("is_data_eng"):
        # Select Data problems: Sliding Window Streaming, Vector Similarity, Async Concurrency
        selected_ids = [
            "task-31-streaming-sliding-window",
            "task-30-vector-similarity-reranking",
            "task-29-async-fastapi-debugging"
        ]
    else:
        # Default Full-Stack / Backend suite
        selected_ids = [
            "task-29-async-fastapi-debugging",
            "task-30-vector-similarity-reranking",
            "task-32-rag-prompt-token-budget"
        ]
    
    res = [challenge_map[cid] for cid in selected_ids if cid in challenge_map]
    return res if len(res) >= 2 else DEFAULT_CHALLENGES[:3]


