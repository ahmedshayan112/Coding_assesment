# StaffGenie — Generic In-Browser Technical Coding Assessment & Evaluation Sandbox

A generic, production-ready technical coding interview environment tailored to any **Job Description (JD)**.

---

## Key Features

1. **Generic JD-Driven Challenge Generator (LLM Powered)**:
   - Uses OpenAI (`gpt-4o-mini`) to dynamically generate real-world coding problems, starter templates, model solutions, sample test cases, and hidden test suites tailored strictly to any Job Description.
   - Comes preloaded with real production challenges:
     - **Task 29**: *Async/FastAPI Concurrency & Blocking Call Debugging* (fixes event loop starvation, blocking `time.sleep`, improper await).
     - **Task 30**: *Vector Similarity & Cosine Reranker from Scratch* (pure Python mathematical implementation without numpy/scipy/sklearn).
     - **Task 31**: *Real-Time Streaming Sliding Window Aggregator*.

2. **Timed In-Browser Coding Sandbox (Task 28)**:
   - 40-minute countdown timer with urgency alerts.
   - Code editor with line numbers, syntax highlighting, tab indentation, and keyboard shortcuts (`Ctrl + Enter` to run).
   - In-browser compiler/runner allowing candidates to test their code **n number of times** against sample test cases before deciding to submit.

3. **Live Camera & Audio Proctoring**:
   - Captures candidate webcam video feed and displays an active proctoring preview widget.
   - Web Audio API real-time microphone visualizer animating live audio bars based on candidate speech levels.
   - Monitored session indicator (`🔴 PROCTORED`).

4. **Multi-Question Submission Flow**:
   - Candidates can navigate between questions and test their code as many times as desired.
   - "Submit & Next" saves their solution and advances to the next question.
   - Candidates can submit regardless of whether tests pass or fail and proceed.

5. **Comprehensive Post-Submission Evaluation Engine**:
   - Evaluates submitted code against hidden test suites, edge cases, boundary conditions, and static code quality rules.
   - Generates **marks out of 100 for EACH question**.
   - Generates an **Overall Score (0-100)**, Candidate Grade (A+, A, B, C, F), and Hiring Recommendation.
   - Optional AI Architectural Code Review analyzing time/space complexity and suggestions.
   - Exportable Scorecard JSON.

---

## Project Structure

```
coding_assessment/
├── challenges.py        # Active challenge registry & default challenge suites
├── jd_generator.py      # LLM-powered dynamic question & answer generator from JD
├── sandbox.py           # Subprocess execution sandbox with timeout & output capture
├── evaluator.py         # Post-submission grading engine (marks out of 100 per question)
├── server.py            # FastAPI server & API endpoints
├── test_assessment.py   # Automated unit test suite
├── static/
│   ├── index.html       # Modern dark-theme coding sandbox UI with webcam/audio
│   ├── style.css        # Premium styles matching StaffGenie design system
│   └── app.js           # Client application logic (proctoring, timer, runner, scorecard)
├── requirements.txt     # Python dependencies (fastapi, uvicorn, pydantic)
└── README.md            # Documentation
```

---

## Local Setup & Testing

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Run Automated Tests
```bash
python -m unittest test_assessment.py
```

### 3. Start Local Server
```bash
python server.py
```
Open your browser at:
```
http://127.0.0.1:8000
```

---

## API Endpoints

- `GET /api/challenges`: List active challenges (sample test cases only).
- `POST /api/challenges/generate-from-jd`: Dynamically synthesize 3-4 coding challenges from any Job Description using LLM.
- `POST /api/run`: Execute candidate code against sample test cases (run n times).
- `POST /api/submit`: Final submission across all questions, runs hidden test suites and generates marks out of 100 per question.
- `GET /api/results/{submission_id}`: Retrieve saved evaluation scorecard.
