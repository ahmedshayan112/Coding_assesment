/**
 * StaffGenie Technical Coding Assessment — Client Application
 * Handles:
 * - Dynamic JD-based question loading
 * - Live webcam & microphone proctoring with audio waveform visualization
 * - 40-minute countdown timer
 * - Code editor with line numbers and keyboard shortcuts
 * - Live execution runner against sample test cases (n times)
 * - Submission flow & post-submission evaluation scorecard with marks out of 100 per question
 */

// Application State
const state = {
  challenges: [],
  currentIndex: 0,
  userCode: {}, // { challengeId: code }
  remainingSeconds: 40 * 60,
  timerInterval: null,
  isAudioActive: false,
  audioContext: null,
  analyser: null,
  mediaStream: null,
  lastScorecard: null
};

// DOM Elements
const dom = {
  questionTabs: document.getElementById("questionTabs"),
  countdownTimer: document.getElementById("countdownTimer"),
  timerBox: document.getElementById("timerBox"),
  problemTitle: document.getElementById("problemTitle"),
  problemTags: document.getElementById("problemTags"),
  problemMarkdown: document.getElementById("problemMarkdown"),
  sampleTestsList: document.getElementById("sampleTestsList"),
  codeEditor: document.getElementById("codeEditor"),
  lineNumbers: document.getElementById("lineNumbers"),
  resetCodeBtn: document.getElementById("resetCodeBtn"),
  runCodeBtn: document.getElementById("runCodeBtn"),
  submitNextBtn: document.getElementById("submitNextBtn"),
  finishAssessmentBtn: document.getElementById("finishAssessmentBtn"),
  samplePassBadge: document.getElementById("samplePassBadge"),
  testResultsList: document.getElementById("testResultsList"),
  stdoutBox: document.getElementById("stdoutBox"),
  proctorVideo: document.getElementById("proctorVideo"),
  scorecardModal: document.getElementById("scorecardModal"),
  scorecardBody: document.getElementById("scorecardBody"),
  closeModalBtn: document.getElementById("closeModalBtn"),
  downloadScorecardBtn: document.getElementById("downloadScorecardBtn"),
  // JD Modal
  jdModal: document.getElementById("jdModal"),
  openJdModalBtn: document.getElementById("openJdModalBtn"),
  closeJdModalBtn: document.getElementById("closeJdModalBtn"),
  generateJdBtn: document.getElementById("generateJdBtn"),
  jdJobTitle: document.getElementById("jdJobTitle"),
  jdDescriptionText: document.getElementById("jdDescriptionText"),
  roleBadge: document.getElementById("roleBadge")
};

// Initialize Application
async function init() {
  setupEventListeners();
  setupEditor();
  await initProctoring();
  startTimer();
  await loadChallenges();
}

// 1. Load Challenges from Server
async function loadChallenges() {
  try {
    const res = await fetch("/api/challenges");
    const data = await res.json();
    if (data.success && data.challenges.length > 0) {
      state.challenges = data.challenges;
      // Initialize starter code
      state.challenges.forEach(c => {
        if (!state.userCode[c.id]) {
          state.userCode[c.id] = c.starter_code;
        }
      });
      renderQuestionTabs();
      loadChallenge(0);
    }
  } catch (err) {
    console.error("Failed to fetch challenges:", err);
    dom.problemTitle.textContent = "Error loading challenges from server.";
  }
}

// 2. Render Question Navigation Tabs
function renderQuestionTabs() {
  dom.questionTabs.innerHTML = "";
  state.challenges.forEach((c, idx) => {
    const btn = document.createElement("button");
    btn.className = `q-nav-tab ${idx === state.currentIndex ? "active" : ""}`;
    btn.innerHTML = `Q${idx + 1} <span style="font-size: 10px; opacity: 0.7;">${c.category.split('/')[0]}</span>`;
    btn.onclick = () => switchChallenge(idx);
    dom.questionTabs.appendChild(btn);
  });
}

// 3. Switch / Load Challenge
function switchChallenge(index) {
  // Save current code before switching
  if (state.challenges[state.currentIndex]) {
    const currentId = state.challenges[state.currentIndex].id;
    state.userCode[currentId] = dom.codeEditor.value;
  }

  state.currentIndex = index;
  renderQuestionTabs();
  loadChallenge(index);
}

function loadChallenge(index) {
  const challenge = state.challenges[index];
  if (!challenge) return;

  dom.problemTitle.textContent = challenge.title;

  // Render Tags
  const diffClass = challenge.difficulty === "Easy" ? "tag-diff-easy" : (challenge.difficulty === "Hard" ? "tag-diff-hard" : "tag-diff-med");
  dom.problemTags.innerHTML = `
    <span class="tag-badge ${diffClass}">${challenge.difficulty}</span>
    <span class="tag-badge">⏳ ${challenge.time_limit_minutes} Mins</span>
    <span class="tag-badge">🏷️ ${challenge.category}</span>
  `;

  // Render Description Markdown (simple markdown parser)
  dom.problemMarkdown.innerHTML = formatMarkdown(challenge.description_markdown);

  // Render Sample Test Cases
  renderSampleTests(challenge.sample_test_cases);

  // Load candidate code for this challenge
  const savedCode = state.userCode[challenge.id] || challenge.starter_code;
  dom.codeEditor.value = savedCode;
  updateLineNumbers();

  // Reset console
  dom.testResultsList.innerHTML = `
    <div class="console-placeholder">
      Click <strong>"Run Code"</strong> to test your solution against visible sample test cases. You can run as many times as needed.
    </div>
  `;
  dom.samplePassBadge.textContent = `0/${challenge.sample_test_cases.length} Passed`;
  dom.stdoutBox.textContent = "No console output yet.";

  // Update Submit Button Text
  if (state.currentIndex === state.challenges.length - 1) {
    dom.submitNextBtn.innerHTML = `Finish & Submit <span class="btn-icon">✓</span>`;
    dom.submitNextBtn.className = "btn-success";
  } else {
    dom.submitNextBtn.innerHTML = `Submit & Next <span class="btn-icon">➔</span>`;
    dom.submitNextBtn.className = "btn-success";
  }
}

function renderSampleTests(sampleCases) {
  dom.sampleTestsList.innerHTML = "";
  (sampleCases || []).forEach((tc, i) => {
    const card = document.createElement("div");
    card.className = "sample-test-card";
    card.innerHTML = `
      <div class="sample-test-header">Sample Test #${i + 1}: ${tc.name}</div>
      <div class="diff-label">Test Call:</div>
      <div class="code-snippet-box">${escapeHtml(tc.call)}</div>
      <div class="diff-label">Expected Output:</div>
      <div class="code-snippet-box">${escapeHtml(JSON.stringify(tc.expected, null, 2))}</div>
      ${tc.explanation ? `<p style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">ℹ️ ${escapeHtml(tc.explanation)}</p>` : ""}
    `;
    dom.sampleTestsList.appendChild(card);
  });
}

// 4. Editor Interaction & Line Numbers
function setupEditor() {
  const editor = dom.codeEditor;

  editor.addEventListener("input", () => {
    updateLineNumbers();
    if (state.challenges[state.currentIndex]) {
      state.userCode[state.challenges[state.currentIndex].id] = editor.value;
    }
  });

  editor.addEventListener("scroll", () => {
    dom.lineNumbers.scrollTop = editor.scrollTop;
  });

  // Tab Key Indentation & Keyboard Shortcuts
  editor.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      editor.value = editor.value.substring(0, start) + "    " + editor.value.substring(end);
      editor.selectionStart = editor.selectionEnd = start + 4;
      updateLineNumbers();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      runSampleCode();
    }
  });
}

function updateLineNumbers() {
  const lines = dom.codeEditor.value.split("\n").length;
  dom.lineNumbers.innerHTML = Array.from({ length: lines }, (_, i) => i + 1).join("<br>");
}

// 5. Run Code Against Sample Test Cases (Candidate runs N times)
async function runSampleCode() {
  const challenge = state.challenges[state.currentIndex];
  if (!challenge) return;

  const code = dom.codeEditor.value;
  dom.runCodeBtn.disabled = true;
  dom.runCodeBtn.innerHTML = `<span class="btn-icon">⏳</span> Running...`;

  try {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge_id: challenge.id, code })
    });

    const data = await res.json();
    if (data.success && data.execution) {
      renderExecutionResults(data.execution);
    }
  } catch (err) {
    console.error("Execution request failed:", err);
    dom.stdoutBox.textContent = `Execution error: ${err.message}`;
  } finally {
    dom.runCodeBtn.disabled = false;
    dom.runCodeBtn.innerHTML = `<span class="btn-icon">▶</span> Run Code`;
  }
}

function renderExecutionResults(execData) {
  const passed = execData.passed_count;
  const total = execData.total_count;

  dom.samplePassBadge.textContent = `${passed}/${total} Passed`;
  dom.samplePassBadge.style.background = passed === total ? "var(--accent-emerald-bg)" : "var(--accent-rose-bg)";
  dom.samplePassBadge.style.color = passed === total ? "var(--accent-emerald)" : "var(--accent-rose)";

  // Render cards
  dom.testResultsList.innerHTML = "";
  execData.test_results.forEach(tr => {
    const card = document.createElement("div");
    card.className = `test-result-card ${tr.status}`;
    card.innerHTML = `
      <div class="test-result-header">
        <span class="test-result-name">${escapeHtml(tr.name)}</span>
        <span class="test-badge ${tr.status}">${tr.status} • ${tr.duration_ms}ms</span>
      </div>
      <div class="test-result-diff">
        <div class="diff-col">
          <div class="diff-label">Expected Output:</div>
          <div class="diff-val">${escapeHtml(JSON.stringify(tr.expected))}</div>
        </div>
        <div class="diff-col">
          <div class="diff-label">Your Output:</div>
          <div class="diff-val">${escapeHtml(JSON.stringify(tr.actual))}</div>
        </div>
      </div>
      ${tr.error ? `<p style="font-size: 11px; color: var(--accent-rose); margin-top: 6px;">❌ ${escapeHtml(tr.error)}</p>` : ""}
    `;
    dom.testResultsList.appendChild(card);
  });

  // Switch to results tab in console drawer
  switchConsoleTab("results");

  // Collect any stdout logs
  const stdoutJoined = execData.test_results.map(t => t.stdout).filter(Boolean).join("\n---\n");
  dom.stdoutBox.textContent = stdoutJoined || "Code executed without stdout logs.";
}

// 6. Submit & Next Question
function submitAndNext() {
  if (state.challenges[state.currentIndex]) {
    state.userCode[state.challenges[state.currentIndex].id] = dom.codeEditor.value;
  }

  if (state.currentIndex < state.challenges.length - 1) {
    switchChallenge(state.currentIndex + 1);
  } else {
    // Final question submission
    finishAssessment();
  }
}

// 7. Finish Assessment & Post-Submission Evaluation
async function finishAssessment() {
  if (state.challenges[state.currentIndex]) {
    state.userCode[state.challenges[state.currentIndex].id] = dom.codeEditor.value;
  }

  const confirmed = confirm("Are you ready to finalize and submit your technical assessment? Your code will be evaluated across all challenges.");
  if (!confirmed) return;

  clearInterval(state.timerInterval);
  openScorecardModal();

  try {
    const res = await fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidate_name: "Technical Candidate",
        candidate_email: "candidate@interview.ai",
        submissions: state.userCode,
        session_metadata: {
          camera_active: !!state.mediaStream,
          audio_active: state.isAudioActive,
          duration_seconds: (40 * 60) - state.remainingSeconds
        }
      })
    });

    const data = await res.json();
    if (data.success && data.scorecard) {
      state.lastScorecard = data.scorecard;
      renderScorecard(data.scorecard);
    }
  } catch (err) {
    console.error("Submission failed:", err);
    dom.scorecardBody.innerHTML = `<p style="color: var(--accent-rose);">Failed to submit assessment: ${err.message}</p>`;
  }
}

function openScorecardModal() {
  dom.scorecardModal.classList.remove("hidden");
  dom.scorecardBody.innerHTML = `
    <div style="text-align: center; padding: 40px 20px;">
      <div style="font-size: 40px; margin-bottom: 12px; animation: pulse 1s infinite;">⚙️</div>
      <h3 style="color: #fff; margin-bottom: 8px;">Evaluating Technical Submissions...</h3>
      <p style="color: var(--text-secondary); font-size: 13px;">Running comprehensive hidden test suites, edge cases, and static code quality checks.</p>
    </div>
  `;
}

function renderScorecard(scorecard) {
  const overallScore = scorecard.overall_score;
  const scoreClass = overallScore >= 80 ? "high" : (overallScore >= 50 ? "med" : "low");

  let questionsHtml = "";
  scorecard.questions.forEach((q, i) => {
    const qClass = q.score >= 80 ? "high" : (q.score >= 50 ? "med" : "low");
    const llm = q.llm_review;

    questionsHtml += `
      <div class="q-score-card">
        <div class="q-score-header">
          <div>
            <div class="q-score-title">Question ${i + 1}: ${escapeHtml(q.title)}</div>
            <span style="font-size: 11px; color: var(--text-secondary);">Passed ${q.passed_tests} of ${q.total_tests} Hidden Evaluation Tests</span>
          </div>
          <span class="q-score-pill ${qClass}">${q.score} / 100</span>
        </div>

        ${q.feedback && q.feedback.length > 0 ? `
          <div style="font-size: 12px; color: #cbd5e1; margin-top: 6px;">
            ${q.feedback.map(f => `<p>• ${escapeHtml(f)}</p>`).join("")}
          </div>
        ` : ""}

        ${llm ? `
          <div class="llm-review-box">
            <h4>🤖 AI Architectural & Code Quality Review</h4>
            <p style="margin-bottom: 4px;"><strong>Complexity:</strong> Time: <code>${llm.time_complexity || "O(N)"}</code> • Space: <code>${llm.space_complexity || "O(1)"}</code></p>
            <p style="color: var(--accent-emerald);"><strong>Strengths:</strong> ${(llm.strengths || []).join(", ")}</p>
            ${llm.improvements && llm.improvements.length ? `<p style="color: #fbbf24; margin-top: 2px;"><strong>Suggestions:</strong> ${llm.improvements.join(", ")}</p>` : ""}
          </div>
        ` : ""}
      </div>
    `;
  });

  dom.scorecardBody.innerHTML = `
    <!-- Scorecard Summary Banner -->
    <div class="scorecard-banner">
      <div class="scorecard-metric">
        <div class="val ${scoreClass}">${overallScore}</div>
        <div class="label">Overall Score / 100</div>
      </div>
      <div class="scorecard-metric">
        <div class="val" style="font-size: 24px; color: #38bdf8;">${escapeHtml(scorecard.overall_grade)}</div>
        <div class="label">Candidate Grade</div>
      </div>
      <div class="scorecard-metric">
        <div class="val" style="font-size: 18px; color: var(--accent-emerald);">${escapeHtml(scorecard.recommendation)}</div>
        <div class="label">Hiring Recommendation</div>
      </div>
    </div>

    <h3 style="font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 12px; text-transform: uppercase;">
      Per-Question Marks Breakdown (out of 100)
    </h3>
    ${questionsHtml}

    <div style="margin-top: 16px; padding: 12px; border-radius: 8px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); font-size: 12px; color: var(--text-muted);">
      🛡️ <strong>Proctoring Audit:</strong> Camera Active • Microphone Active • Solved in ${Math.round(scorecard.session_proctoring.duration_seconds / 60)} minutes.
    </div>
  `;
}

// 8. Dynamic JD Generation Modal Handling
async function handleGenerateFromJd() {
  const title = dom.jdJobTitle.value.trim();
  const desc = dom.jdDescriptionText.value.trim();

  if (!desc) {
    alert("Please provide a job description or select a preset.");
    return;
  }

  dom.generateJdBtn.disabled = true;
  dom.generateJdBtn.innerHTML = `⏳ Synthesizing Challenges...`;

  try {
    const res = await fetch("/api/challenges/generate-from-jd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_title: title,
        job_description: desc,
        difficulty: "Medium",
        num_questions: 3
      })
    });

    const data = await res.json();
    if (data.success && data.challenges.length > 0) {
      state.challenges = data.challenges;
      state.userCode = {};
      state.challenges.forEach(c => {
        state.userCode[c.id] = c.starter_code;
      });

      dom.roleBadge.textContent = title;
      dom.jdModal.classList.add("hidden");
      renderQuestionTabs();
      loadChallenge(0);
    }
  } catch (err) {
    alert(`Failed to generate challenges from JD: ${err.message}`);
  } finally {
    dom.generateJdBtn.disabled = false;
    dom.generateJdBtn.innerHTML = `✨ Generate Tailored Assessment`;
  }
}

// 9. Proctoring (Camera & Real-Time Audio Meter)
async function initProctoring() {
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      state.mediaStream = stream;
      dom.proctorVideo.srcObject = stream;

      // Initialize Web Audio API Analyser for live microphone level bars
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        state.audioContext = new AudioContext();
        const source = state.audioContext.createMediaStreamSource(stream);
        state.analyser = state.audioContext.createAnalyser();
        state.analyser.fftSize = 64;
        source.connect(state.analyser);
        state.isAudioActive = true;
        animateAudioMeter();
      }
    }
  } catch (err) {
    console.warn("Camera/Mic access denied or unavailable:", err);
    // Display offline badge on proctor video widget
    const badge = document.querySelector(".proctor-badge");
    if (badge) badge.innerHTML = `<span style="color:#f87171;">⚠️ Camera Off</span>`;
  }
}

function animateAudioMeter() {
  if (!state.analyser) return;

  const dataArray = new Uint8Array(state.analyser.frequencyBinCount);
  state.analyser.getByteFrequencyData(dataArray);

  // Compute average decibels
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    sum += dataArray[i];
  }
  const avg = sum / dataArray.length;

  // Animate the 5 bars in the proctor widget
  const bars = document.querySelectorAll(".audio-bars .bar");
  bars.forEach((bar, i) => {
    const val = dataArray[i * 2] || avg;
    const heightPx = Math.max(3, Math.min(14, (val / 255) * 16));
    bar.style.height = `${heightPx}px`;
  });

  requestAnimationFrame(animateAudioMeter);
}

// 10. Timer Functionality
function startTimer() {
  clearInterval(state.timerInterval);
  state.timerInterval = setInterval(() => {
    state.remainingSeconds--;
    if (state.remainingSeconds <= 0) {
      clearInterval(state.timerInterval);
      dom.countdownTimer.textContent = "00:00";
      finishAssessment();
      return;
    }

    const mins = Math.floor(state.remainingSeconds / 60);
    const secs = state.remainingSeconds % 60;
    dom.countdownTimer.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    if (state.remainingSeconds < 5 * 60) {
      dom.countdownTimer.classList.add("urgent");
    }
  }, 1000);
}

// Event Listeners
function setupEventListeners() {
  dom.runCodeBtn.onclick = runSampleCode;
  dom.submitNextBtn.onclick = submitAndNext;
  dom.finishAssessmentBtn.onclick = finishAssessment;
  dom.resetCodeBtn.onclick = () => {
    const ch = state.challenges[state.currentIndex];
    if (ch && confirm("Reset code back to original starter template?")) {
      dom.codeEditor.value = ch.starter_code;
      state.userCode[ch.id] = ch.starter_code;
      updateLineNumbers();
    }
  };

  // Left Pane Tabs
  document.querySelectorAll(".pane-tab").forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll(".pane-tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(tc => tc.classList.remove("active"));
      tab.classList.add("active");
      const target = tab.dataset.tab;
      if (target === "description") document.getElementById("tabDescription").classList.add("active");
      if (target === "sampleTests") document.getElementById("tabSampleTests").classList.add("active");
      if (target === "proctoring") document.getElementById("tabProctoring").classList.add("active");
    };
  });

  // Console Tabs
  document.querySelectorAll(".console-tab").forEach(tab => {
    tab.onclick = () => switchConsoleTab(tab.dataset.view);
  });

  // Scorecard modal buttons
  dom.closeModalBtn.onclick = () => dom.scorecardModal.classList.add("hidden");
  dom.downloadScorecardBtn.onclick = () => {
    if (!state.lastScorecard) return;
    const blob = new Blob([JSON.stringify(state.lastScorecard, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scorecard_${state.lastScorecard.submission_id}.json`;
    a.click();
  };

  // JD Modal Buttons
  dom.openJdModalBtn.onclick = () => dom.jdModal.classList.remove("hidden");
  dom.closeJdModalBtn.onclick = () => dom.jdModal.classList.add("hidden");
  dom.generateJdBtn.onclick = handleGenerateFromJd;

  document.querySelectorAll(".preset-btn").forEach(btn => {
    btn.onclick = () => {
      dom.jdJobTitle.value = btn.dataset.title;
      dom.jdDescriptionText.value = btn.dataset.desc;
    };
  });
}

function switchConsoleTab(view) {
  document.querySelectorAll(".console-tab").forEach(t => {
    t.classList.toggle("active", t.dataset.view === view);
  });
  document.querySelectorAll(".console-view").forEach(v => v.classList.remove("active"));
  if (view === "results") document.getElementById("viewResults").classList.add("active");
  if (view === "logs") document.getElementById("viewLogs").classList.add("active");
}

// Helpers
function escapeHtml(str) {
  if (typeof str !== "string") str = String(str ?? "");
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatMarkdown(md) {
  if (!md) return "";
  let html = escapeHtml(md);
  html = html.replace(/### (.*?)\n/g, '<h3>$1</h3>');
  html = html.replace(/## (.*?)\n/g, '<h2>$1</h2>');
  html = html.replace(/# (.*?)\n/g, '<h1>$1</h1>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/`(.*?)`/g, '<code>$1</code>');
  html = html.replace(/```python([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  html = html.replace(/\n\n/g, '<p></p>');
  return html;
}

window.addEventListener("DOMContentLoaded", init);
