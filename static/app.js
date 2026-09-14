/**
 * StaffGenie Technical Coding Assessment — Client Application
 * Features:
 * - Mandatory pre-interview Camera & Microphone verification gate
 * - Live webcam & real-time audio waveform proctoring during assessment
 * - Full KaTeX mathematical formula rendering & robust Markdown formatting
 * - Anti-session switch & tab-change enforcement (anti-cheat telemetry)
 * - 40-minute countdown timer locked to the active session
 * - Code editor with line numbers and shortcuts
 * - Live in-browser execution runner against sample test suites
 * - Final submission & evaluation scorecard sync
 */

// Application State
const state = {
  challenges: [],
  currentIndex: 0,
  userCode: {}, // { challengeId: code }
  remainingSeconds: 40 * 60,
  timerInterval: null,
  isAssessmentStarted: false,
  isSubmitted: false,
  cameraActive: false,
  micActive: false,
  mediaStream: null,
  mediaRecorder: null,
  recordedChunks: [],
  uploadedVideoUrl: null,
  audioContext: null,
  analyser: null,
  animFrameId: null,
  sessionSwitches: 0,
  maxSwitches: 1,
  lastScorecard: null
};

// Base API path for coding assessment backend (FastAPI)
// When served behind Nginx reverse proxy at /coding/, prefix API calls with /coding/api
const CODING_API_BASE = (function() {
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/coding")) {
    return "/coding/api";
  }
  return "/api";
})();

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
  scorecardModal: document.getElementById("scorecardModal"),
  scorecardBody: document.getElementById("scorecardBody"),
  closeModalBtn: document.getElementById("closeModalBtn"),
  roleBadge: document.getElementById("roleBadge"),
  candidateInfoBadge: document.getElementById("candidateInfoBadge"),

  // Hardware Verification Elements
  hardwareModal: document.getElementById("hardwareModal"),
  hardwareVideo: document.getElementById("hardwareVideo"),
  videoStatusOverlay: document.getElementById("videoStatusOverlay"),
  camStatusRow: document.getElementById("camStatusRow"),
  camBadge: document.getElementById("camBadge"),
  micStatusRow: document.getElementById("micStatusRow"),
  micBadge: document.getElementById("micBadge"),
  micLevelFill: document.getElementById("micLevelFill"),
  micDbLevel: document.getElementById("micDbLevel"),
  enableHardwareBtn: document.getElementById("enableHardwareBtn"),
  startAssessmentBtn: document.getElementById("startAssessmentBtn"),

  // Floating Proctoring Widget
  proctorWidget: document.getElementById("proctorWidget"),
  proctorVideo: document.getElementById("proctorVideo"),

  // Anti-Cheat & Hardware Alert Modals
  switchWarningModal: document.getElementById("switchWarningModal"),
  violationCountBadge: document.getElementById("violationCountBadge"),
  returnToSessionBtn: document.getElementById("returnToSessionBtn"),
  hardwareLostModal: document.getElementById("hardwareLostModal"),
  reconnectHardwareBtn: document.getElementById("reconnectHardwareBtn")
};

// URL Query Parameter Context
const urlParams = new URLSearchParams(window.location.search);
const assessmentToken = urlParams.get("token") || "";
const assessmentCandidateId = urlParams.get("candidateId") || "";
const assessmentTaskId = urlParams.get("taskId") || "";
const assessmentCandidateName = urlParams.get("name") || "";
const assessmentCandidateEmail = urlParams.get("email") || "";
const assessmentCandidateRole = urlParams.get("role") || "";

// Initialize Application
async function init() {
  if (assessmentCandidateRole && dom.roleBadge) {
    dom.roleBadge.textContent = assessmentCandidateRole;
  }
  if (assessmentCandidateName && dom.candidateInfoBadge) {
    dom.candidateInfoBadge.textContent = `👤 ${assessmentCandidateName}`;
    dom.candidateInfoBadge.style.display = "inline-block";
  }

  // Lock session token in sessionStorage to prevent tampering or switching
  if (assessmentToken) {
    const existingToken = sessionStorage.getItem("staffgenie_locked_token");
    if (!existingToken || existingToken !== assessmentToken) {
      sessionStorage.setItem("staffgenie_locked_token", assessmentToken);
      state.sessionSwitches = 0;
      state.isSubmitted = false;
    }
  }

  setupEventListeners();
  setupEditor();
  setupAntiSessionSwitch();
  initHardwareGate();
  await loadChallenges();
}

/* ============================================================
   1. Pre-Assessment Camera & Audio Verification Gate
   ============================================================ */
function initHardwareGate() {
  // Ensure the hardware modal is visible
  if (dom.hardwareModal) {
    dom.hardwareModal.style.display = "flex";
  }
  // Disable the code editor until the interview is explicitly started
  if (dom.codeEditor) {
    dom.codeEditor.disabled = true;
  }

  if (dom.enableHardwareBtn) {
    dom.enableHardwareBtn.onclick = requestHardwarePermissions;
  }

  if (dom.startAssessmentBtn) {
    dom.startAssessmentBtn.onclick = startAssessmentSession;
  }

  if (dom.reconnectHardwareBtn) {
    dom.reconnectHardwareBtn.onclick = async () => {
      dom.hardwareLostModal.classList.add("hidden");
      await requestHardwarePermissions();
    };
  }

  // Auto-detect and warn if accessed over insecure HTTP or raw IP address
  checkSecureContext();
}

function updateHardwareBanner(type, htmlContent) {
  let banner = document.getElementById("proctoringNoticeBanner");
  if (!banner) {
    banner = document.querySelector(".proctoring-notice-banner");
  }
  if (!banner) return;

  banner.innerHTML = htmlContent;
  banner.className = "proctoring-notice-banner";
  if (type === "error") {
    banner.classList.add("banner-error");
  } else if (type === "success") {
    banner.classList.add("banner-success");
  } else if (type === "info") {
    banner.classList.add("banner-info");
  }
}

function checkSecureContext() {
  const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  
  // If user opens raw IP or insecure HTTP, automatically redirect to canonical HTTPS domain
  if (!isLocalhost && (window.location.protocol === "http:" || window.location.hostname === "16.16.162.122")) {
    const targetUrl = `https://hire.neuralsurge.ai${window.location.pathname}${window.location.search}`;
    console.warn("Insecure context or raw IP detected. Redirecting to HTTPS domain:", targetUrl);
    updateHardwareBanner(
      "info",
      `🔒 <strong>Redirecting to Secure Connection...</strong><br>Webcams require HTTPS. Opening <a href="${targetUrl}" style="color: #2563eb; text-decoration: underline;">hire.neuralsurge.ai</a>`
    );
    setTimeout(() => {
      window.location.href = targetUrl;
    }, 600);
    return false;
  }
  return true;
}

async function requestHardwarePermissions() {
  // Check secure context first
  const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  if (!isLocalhost && (window.location.protocol === "http:" || window.location.hostname === "16.16.162.122")) {
    const targetUrl = `https://hire.neuralsurge.ai${window.location.pathname}${window.location.search}`;
    window.location.href = targetUrl;
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const msg = "Web browser does not expose camera/mic APIs. Please open this link in Google Chrome, Microsoft Edge, or Safari.";
    console.error(msg);
    updateHardwareBanner(
      "error",
      `❌ <strong>Browser Unsupported:</strong> Your browser does not support camera/mic capture in this window. Please open the link in <strong>Google Chrome</strong> or <strong>Safari</strong> on HTTPS.`
    );
    alert(msg);
    return;
  }

  try {
    if (dom.enableHardwareBtn) {
      dom.enableHardwareBtn.disabled = true;
      dom.enableHardwareBtn.innerHTML = `<span>⏳</span> Requesting Devices...`;
    }
    updateHardwareBanner("info", "⏳ <strong>Action Required:</strong> Please tap <strong>'Allow'</strong> on your browser prompt to enable Camera and Microphone.");

    let stream = null;

    // Strategy 1: Mobile and desktop friendly ideal constraints
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true
        }
      });
    } catch (tier1Err) {
      console.warn("Tier 1 getUserMedia failed, trying boolean constraints fallback...", tier1Err);
      // Strategy 2: Simple boolean constraints for older devices and mobile browsers
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        });
      } catch (tier2Err) {
        console.warn("Tier 2 combined getUserMedia failed, attempting separate requests...", tier2Err);
        // Strategy 3: Request Video & Audio separately in case one sensor has strict permissions
        let vStream = null;
        let aStream = null;
        try {
          vStream = await navigator.mediaDevices.getUserMedia({ video: true });
        } catch (vErr) {
          console.error("Separate Video request failed:", vErr);
        }
        try {
          aStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (aErr) {
          console.error("Separate Audio request failed:", aErr);
        }

        if (vStream && aStream) {
          stream = new MediaStream([
            ...vStream.getVideoTracks(),
            ...aStream.getAudioTracks()
          ]);
        } else if (vStream && !aStream) {
          const err = new Error("MICROPHONE_DENIED");
          err.name = "NotAllowedError";
          throw err;
        } else if (!vStream && aStream) {
          const err = new Error("CAMERA_DENIED");
          err.name = "NotAllowedError";
          throw err;
        } else {
          throw tier2Err;
        }
      }
    }

    state.mediaStream = stream;

    // 1. Verify Video Track
    const videoTracks = stream.getVideoTracks();
    if (videoTracks.length > 0 && videoTracks[0].readyState === "live") {
      state.cameraActive = true;
      if (dom.hardwareVideo) {
        dom.hardwareVideo.srcObject = stream;
        dom.hardwareVideo.setAttribute("playsinline", "true");
        dom.hardwareVideo.setAttribute("webkit-playsinline", "true");
        dom.hardwareVideo.muted = true;
        try {
          const playPromise = dom.hardwareVideo.play();
          if (playPromise !== undefined) {
            playPromise.catch(e => console.warn("Video playback autoplay notice:", e));
          }
        } catch (e) {
          console.warn("Error playing video preview:", e);
        }
      }
      if (dom.videoStatusOverlay) dom.videoStatusOverlay.classList.add("active");
      if (dom.camBadge) {
        dom.camBadge.textContent = "Ready ✓";
        dom.camBadge.className = "device-state-badge state-ready";
      }
      if (dom.camStatusRow) dom.camStatusRow.classList.add("verified");

      // Monitor camera track ending
      videoTracks[0].onended = () => {
        state.cameraActive = false;
        handleHardwareLost("Camera disconnected");
      };
    }

    // 2. Verify Audio Track & Initialize Web Audio Equalizer
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length > 0 && audioTracks[0].readyState === "live") {
      state.micActive = true;
      if (dom.micBadge) {
        dom.micBadge.textContent = "Ready ✓";
        dom.micBadge.className = "device-state-badge state-ready";
      }
      if (dom.micStatusRow) dom.micStatusRow.classList.add("verified");

      initAudioMeter(stream);

      audioTracks[0].onended = () => {
        state.micActive = false;
        handleHardwareLost("Microphone disconnected");
      };
    }

    // 3. Unlock Start Assessment button if both are verified and policy acknowledged
    if (state.cameraActive && state.micActive) {
      if (dom.enableHardwareBtn) {
        dom.enableHardwareBtn.disabled = false;
        dom.enableHardwareBtn.innerHTML = `<span>✓</span> Devices Connected`;
      }
      updateHardwareBanner(
        "success",
        "✅ <strong>Camera & Microphone Connected!</strong> Please acknowledge the session policy below to begin."
      );
      checkCanStartAssessment();
    }
  } catch (err) {
    console.error("Hardware permission denied or error:", err);
    if (dom.enableHardwareBtn) {
      dom.enableHardwareBtn.disabled = false;
      dom.enableHardwareBtn.innerHTML = `<span>🔄</span> Try Again`;
    }

    let errorDetail = "Camera & Microphone access is mandatory.";
    if (err.message === "CAMERA_DENIED" || (err.name === "NotAllowedError" && !state.cameraActive && state.micActive)) {
      if (dom.camBadge) {
        dom.camBadge.textContent = "Denied ✗";
        dom.camBadge.className = "device-state-badge state-denied";
      }
      errorDetail = "❌ <strong>Camera Access Blocked:</strong> Click the camera/lock icon in your browser URL bar, set Camera to <strong>'Allow'</strong>, then click 'Try Again'.";
    } else if (err.message === "MICROPHONE_DENIED" || (err.name === "NotAllowedError" && state.cameraActive && !state.micActive)) {
      if (dom.micBadge) {
        dom.micBadge.textContent = "Denied ✗";
        dom.micBadge.className = "device-state-badge state-denied";
      }
      errorDetail = "❌ <strong>Microphone Access Blocked:</strong> Click the microphone/lock icon in your browser URL bar, set Microphone to <strong>'Allow'</strong>, then click 'Try Again'.";
    } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
      errorDetail = "⚠️ <strong>Device in Use:</strong> Your webcam or mic is being used by another program (e.g. Zoom, Teams, Google Meet, or another browser tab). Please close other apps and click 'Try Again'.";
    } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
      errorDetail = "⚠️ <strong>Hardware Not Found:</strong> No webcam or microphone was detected on this device. Please connect a webcam/mic and click 'Try Again'.";
    } else {
      if (dom.camBadge) {
        dom.camBadge.textContent = "Denied ✗";
        dom.camBadge.className = "device-state-badge state-denied";
      }
      if (dom.micBadge) {
        dom.micBadge.textContent = "Denied ✗";
        dom.micBadge.className = "device-state-badge state-denied";
      }
      errorDetail = "❌ <strong>Permission Blocked:</strong> Tap the lock icon 🔒 next to the web address, allow Camera & Microphone permissions, and click 'Try Again'.";
    }

    updateHardwareBanner("error", errorDetail);
  }
}

function initAudioMeter(stream) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    if (!state.audioContext) {
      state.audioContext = new AudioContext();
    }
    if (state.audioContext.state === "suspended") {
      state.audioContext.resume();
    }

    const source = state.audioContext.createMediaStreamSource(stream);
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 64;
    source.connect(state.analyser);

    const dataArray = new Uint8Array(state.analyser.frequencyBinCount);

    function updateAudioLevel() {
      if (!state.analyser) return;
      state.analyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const avg = sum / dataArray.length;
      const pct = Math.min(100, Math.round((avg / 128) * 100));

      if (dom.micLevelFill) dom.micLevelFill.style.width = `${pct}%`;
      if (dom.micDbLevel) dom.micDbLevel.textContent = `${pct}%`;

      // Animate floating proctor widget audio bars if active
      if (state.isAssessmentStarted) {
        const bars = document.querySelectorAll(".audio-bars .bar");
        bars.forEach((b, i) => {
          const val = dataArray[i * 2] || 0;
          const h = Math.max(3, Math.min(12, (val / 255) * 12));
          b.style.height = `${h}px`;
        });
      }

      state.animFrameId = requestAnimationFrame(updateAudioLevel);
    }

    updateAudioLevel();
  } catch (e) {
    console.warn("Could not start Web Audio meter:", e);
  }
}

function checkCanStartAssessment() {
  const checkbox = document.getElementById("sessionAgreementCheck");
  const isAgreed = checkbox ? checkbox.checked : false;
  if (dom.startAssessmentBtn) {
    if (state.cameraActive && state.micActive && isAgreed) {
      dom.startAssessmentBtn.disabled = false;
      dom.startAssessmentBtn.innerHTML = `<span>🚀</span> Start Assessment`;
    } else {
      dom.startAssessmentBtn.disabled = true;
      if (!isAgreed && state.cameraActive && state.micActive) {
        dom.startAssessmentBtn.innerHTML = `<span>✍️</span> Acknowledge Policy`;
      } else {
        dom.startAssessmentBtn.innerHTML = `<span>🔒</span> Start Assessment`;
      }
    }
  }
}

window.onAgreementToggled = function() {
  checkCanStartAssessment();
};

function startAssessmentSession() {
  const checkbox = document.getElementById("sessionAgreementCheck");
  if (checkbox && !checkbox.checked) {
    const box = document.getElementById("sessionDisclaimerBox");
    if (box) {
      box.classList.remove("shake-highlight");
      void box.offsetWidth;
      box.classList.add("shake-highlight");
    }
    alert("Please acknowledge and agree: changing the session or switching tabs during the interview is strictly prohibited.");
    return;
  }

  if (!state.cameraActive || !state.micActive || !state.mediaStream) {
    alert("Camera and Microphone must both be active before you can start the interview.");
    return;
  }

  // Hide the onboarding modal
  if (dom.hardwareModal) {
    dom.hardwareModal.style.display = "none";
  }

  state.isAssessmentStarted = true;

  // Unlock Code Editor
  if (dom.codeEditor) {
    dom.codeEditor.disabled = false;
    dom.codeEditor.focus();
  }

  // Display floating proctoring widget
  if (dom.proctorWidget) {
    dom.proctorWidget.style.display = "block";
    if (dom.proctorVideo) {
      dom.proctorVideo.srcObject = state.mediaStream;
    }
  }

  // Request fullscreen to lock candidate in focus
  if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  }

  // Start recording the candidate's live session stream
  startRecordingCodingSession();

  // Start 40-minute countdown timer
  startTimer();
}

function handleHardwareLost(reason) {
  if (!state.isAssessmentStarted || state.isSubmitted) return;
  console.warn("Hardware stream interrupted:", reason);
  if (dom.hardwareLostModal) {
    dom.hardwareLostModal.classList.remove("hidden");
  }
}

/* ============================================================
   2. Proctoring Video Recording
   ============================================================ */
function startRecordingCodingSession() {
  try {
    if (!state.mediaStream) {
      console.warn("[Recording] No active mediaStream found to record");
      return;
    }
    state.recordedChunks = [];

    let options = {};
    if (typeof MediaRecorder !== "undefined") {
      const candidateTypes = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm;codecs=h264,opus",
        "video/webm",
        "video/mp4"
      ];
      for (const t of candidateTypes) {
        if (MediaRecorder.isTypeSupported(t)) {
          options = { mimeType: t };
          break;
        }
      }
      state.mediaRecorder = new MediaRecorder(state.mediaStream, options);

      state.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          state.recordedChunks.push(event.data);
        }
      };

      // Collect chunks every 3 seconds for safe progressive buffering
      state.mediaRecorder.start(3000);
      console.log("[Recording] Live proctoring session recording started with options:", options);
    }
  } catch (err) {
    console.warn("[Recording] MediaRecorder failed to start:", err);
  }
}

async function stopAndUploadCodingVideo() {
  if (state.uploadedVideoUrl) return state.uploadedVideoUrl;
  if (!state.mediaRecorder || state.mediaRecorder.state === "inactive") {
    if (state.recordedChunks && state.recordedChunks.length > 0) {
      return await uploadRecordedBlob();
    }
    return null;
  }

  return new Promise((resolve) => {
    state.mediaRecorder.onstop = async () => {
      try {
        const url = await uploadRecordedBlob();
        resolve(url);
      } catch (e) {
        console.error("[Recording] Error during upload:", e);
        resolve(null);
      }
    };
    try {
      state.mediaRecorder.stop();
    } catch (e) {
      console.warn("[Recording] Error stopping mediaRecorder:", e);
      resolve(null);
    }
  });
}

async function uploadRecordedBlob() {
  if (!state.recordedChunks || state.recordedChunks.length === 0) {
    console.warn("[Recording] No chunks captured to upload");
    return null;
  }

  const mime = (state.mediaRecorder && state.mediaRecorder.mimeType) || "video/webm";
  const blob = new Blob(state.recordedChunks, { type: mime });
  console.log(`[Recording] Preparing blob upload: ${(blob.size / (1024 * 1024)).toFixed(2)} MB`);

  const nextApiBase = (typeof window !== "undefined" && window.location.origin && !window.location.origin.includes(":8000"))
    ? window.location.origin
    : "http://localhost:3000";

  try {
    const presignRes = await fetch(`${nextApiBase}/api/coding-assessment/upload-video`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: assessmentToken,
        candidateId: assessmentCandidateId,
        email: assessmentCandidateEmail
      })
    });

    if (!presignRes.ok) {
      console.error("[Recording] Presign endpoint returned status:", presignRes.status);
      return null;
    }

    const { uploadUrl, videoUrl } = await presignRes.json();
    if (!uploadUrl) {
      console.error("[Recording] No uploadUrl returned");
      return null;
    }

    console.log("[Recording] Uploading binary stream to S3...");
    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": mime.split(";")[0] || "video/webm"
      },
      body: blob
    });

    if (!putRes.ok) {
      console.error("[Recording] S3 PUT failed with status:", putRes.status);
      return null;
    }

    console.log("[Recording] Successfully uploaded video to S3:", videoUrl);
    state.uploadedVideoUrl = videoUrl;

    // Ensure MongoDB candidate record has codingVideoUrl
    try {
      await fetch(`${nextApiBase}/api/coding-assessment/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: assessmentCandidateId,
          candidateEmail: assessmentCandidateEmail,
          token: assessmentToken,
          codingVideoUrl: videoUrl
        })
      });
    } catch (syncErr) {
      console.warn("[Recording] Sync videoUrl to Mongo note:", syncErr);
    }

    return videoUrl;
  } catch (uploadErr) {
    console.error("[Recording] Video upload error:", uploadErr);
    return null;
  }
}

/* ============================================================
   3. Anti-Session Switch & Strict Proctoring Enforcement
   ============================================================ */
let lastViolationTimestamp = 0;

function setupAntiSessionSwitch() {
  // 1. Detect Tab Switching or Minimizing
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.isAssessmentStarted && !state.isSubmitted) {
      handleSessionViolation("Proctoring Violation: Session Switch!");
    }
  });

  // 2. Detect Window Defocus / App Switch
  window.addEventListener("blur", () => {
    if (state.isAssessmentStarted && !state.isSubmitted) {
      setTimeout(() => {
        if (!document.hasFocus() && state.isAssessmentStarted && !state.isSubmitted) {
          handleSessionViolation("Proctoring Violation: Session Switch!");
        }
      }, 300);
    }
  });

  // 3. Prevent accidental navigation or page refresh
  window.addEventListener("beforeunload", (e) => {
    if (state.isAssessmentStarted && !state.isSubmitted) {
      e.preventDefault();
      e.returnValue = "Your assessment session is currently active and locked. Leaving now will forfeit your submission.";
      return e.returnValue;
    }
  });

  // 4. Disable Context Menu & Developer Tools Shortcuts
  document.addEventListener("contextmenu", (e) => {
    if (state.isAssessmentStarted && !state.isSubmitted) {
      e.preventDefault();
    }
  });

  document.addEventListener("keydown", (e) => {
    // Block F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U
    if (
      e.key === "F12" ||
      (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "J" || e.key === "C")) ||
      (e.ctrlKey && (e.key === "u" || e.key === "U"))
    ) {
      if (state.isAssessmentStarted && !state.isSubmitted) {
        e.preventDefault();
        handleSessionViolation("Proctoring Violation: Attempted Developer Tools");
      }
    }
  });
}

function handleSessionViolation(reason) {
  if (!state.isAssessmentStarted || state.isSubmitted) return;

  const now = Date.now();
  // Cooldown to avoid rapid double-counting (must be at least 2.5s apart)
  if (now - lastViolationTimestamp < 2500) {
    return;
  }
  lastViolationTimestamp = now;

  state.sessionSwitches++;
  console.warn(`[Proctoring Alert] Session violation detected: ${reason}`);

  // Play warning beep
  playWarningBeep();

  // STRICT ENFORCEMENT: Any violation immediately closes and submits the interview!
  terminateInterviewOnViolation(reason);
}

async function terminateInterviewOnViolation(reason) {
  console.warn("[Proctoring Integrity] Assessment automatically closed & submitted due to violation:", reason);
  state.isAssessmentStarted = false;
  state.isSubmitted = true;

  // Stop timer immediately
  clearInterval(state.timerInterval);

  // Capture current editor code
  if (state.challenges[state.currentIndex] && dom.codeEditor) {
    state.userCode[state.challenges[state.currentIndex].id] = dom.codeEditor.value;
  }

  // Permanently lock code editor & buttons
  if (dom.codeEditor) {
    dom.codeEditor.disabled = true;
    dom.codeEditor.readOnly = true;
  }
  if (dom.runCodeBtn) dom.runCodeBtn.disabled = true;
  if (dom.submitNextBtn) dom.submitNextBtn.disabled = true;
  if (dom.finishAssessmentBtn) {
    dom.finishAssessmentBtn.disabled = true;
    dom.finishAssessmentBtn.textContent = "Disqualified / Submitted";
  }

  // Hide floating proctor widget
  if (dom.proctorWidget) dom.proctorWidget.style.display = "none";

  // Show dedicated violation detected modal to candidate
  if (dom.switchWarningModal) {
    dom.switchWarningModal.classList.remove("hidden");
  }

  // Stop and upload recorded coding session video in background
  let videoUrl = null;
  try {
    videoUrl = await stopAndUploadCodingVideo();
  } catch (vErr) {
    console.error("[Recording] Error uploading video on violation:", vErr);
  }

  // Stop camera & mic streams
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach(t => t.stop());
  }

  // Automatically submit current candidate code and flag violation
  await submitAssessmentData({
    violationDetected: true,
    violationReason: reason,
    codingVideoUrl: videoUrl || state.uploadedVideoUrl
  });
}

function playWarningBeep() {
  try {
    const ctx = state.audioContext || new (window.AudioContext || window.webkitAudioContext)();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.setValueAtTime(320, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {}
}

/* ============================================================
   3. Load Challenges & Question Management
   ============================================================ */
async function loadChallenges() {
  try {
    const sessionParam = encodeURIComponent(assessmentToken || "default");
    const res = await fetch(`${CODING_API_BASE}/challenges?session_id=${sessionParam}`);
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
    if (dom.problemTitle) {
      dom.problemTitle.textContent = "Error loading challenges from server.";
    }
  }
}

function renderQuestionTabs() {
  if (!dom.questionTabs) return;
  dom.questionTabs.innerHTML = "";
  state.challenges.forEach((c, idx) => {
    const btn = document.createElement("button");
    btn.className = `q-nav-tab ${idx === state.currentIndex ? "active" : ""}`;
    btn.innerHTML = `Task ${idx + 1} <span style="font-size: 10px; opacity: 0.7;">${(c.category || "AI").split('/')[0]}</span>`;
    btn.onclick = () => switchChallenge(idx);
    dom.questionTabs.appendChild(btn);
  });
}

function switchChallenge(index) {
  if (state.challenges[state.currentIndex]) {
    const currentId = state.challenges[state.currentIndex].id;
    if (dom.codeEditor) {
      state.userCode[currentId] = dom.codeEditor.value;
    }
  }

  state.currentIndex = index;
  renderQuestionTabs();
  loadChallenge(index);
}

function loadChallenge(index) {
  const challenge = state.challenges[index];
  if (!challenge) return;

  if (dom.problemTitle) {
    const rawTitle = challenge.title || "Coding Challenge";
    const cleanTitle = rawTitle.replace(/^(?:Task|Challenge|Question|Q)\s*\d+\s*:\s*/i, "");
    dom.problemTitle.textContent = `Task ${index + 1}: ${cleanTitle}`;
  }

  const diffClass = challenge.difficulty === "Easy" ? "tag-diff-easy" : (challenge.difficulty === "Hard" ? "tag-diff-hard" : "tag-diff-med");
  if (dom.problemTags) {
    dom.problemTags.innerHTML = `
      <span class="tag-badge ${diffClass}">${challenge.difficulty}</span>
      <span class="tag-badge">⏳ ${challenge.time_limit_minutes || 15} Mins</span>
      <span class="tag-badge">🏷️ ${challenge.category || "AI/ML"}</span>
    `;
  }

  // Format Description with KaTeX Math & Markdown
  let descHtml = formatMarkdown(challenge.description_markdown);
  if (challenge.sample_test_cases && challenge.sample_test_cases.length > 0) {
    descHtml += `
      <div style="margin-top: 24px; padding: 14px 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h4 style="font-size: 12.5px; font-weight: 700; color: #142175; text-transform: uppercase; margin-bottom: 6px;">
          📥 Input Dataset / Test Arguments
        </h4>
        <p style="font-size: 12px; color: #475569; margin-bottom: 8px;">
          The dataset is supplied directly as function arguments by the test runner when you click <strong>"Run Code"</strong>:
        </p>
        ${challenge.sample_test_cases.map((tc, idx) => `
          <div style="margin-bottom: 8px; font-family: var(--font-mono); font-size: 11.5px; background: #ffffff; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 6px; color: #0b1c30;">
            <span style="color: #2563eb; font-weight: 600;">Sample #${idx + 1}: ${escapeHtml(tc.name || "Test Case")}</span>
            <div style="margin-top: 4px; color: #334155;"><code>${escapeHtml(tc.call || "")}</code></div>
          </div>
        `).join("")}
      </div>
    `;
  }

  if (dom.problemMarkdown) {
    dom.problemMarkdown.innerHTML = descHtml;
    // Trigger KaTeX Auto-Render on the newly inserted content
    if (window.renderMathInElement) {
      try {
        window.renderMathInElement(dom.problemMarkdown, {
          delimiters: [
            { left: "$$", right: "$$", display: true },
            { left: "\\[", right: "\\]", display: true },
            { left: "$", right: "$", display: false },
            { left: "\\(", right: "\\)", display: false }
          ],
          throwOnError: false
        });
      } catch (e) {
        console.warn("KaTeX render error:", e);
      }
    }
  }

  // Load starter/saved code into editor
  const savedCode = state.userCode[challenge.id] || challenge.starter_code;
  if (dom.codeEditor) {
    dom.codeEditor.value = savedCode;
    updateLineNumbers();
  }

  // Render Sample Test Cases in Tab 2
  renderSampleTestsTab(challenge.sample_test_cases || []);
  resetExecutionPanel();
}

function renderSampleTestsTab(testCases) {
  if (!dom.sampleTestsList) return;
  if (testCases.length === 0) {
    dom.sampleTestsList.innerHTML = `<p style="color: #64748b; font-size: 13px;">No public sample test cases for this challenge.</p>`;
    return;
  }

  dom.sampleTestsList.innerHTML = testCases.map((tc, idx) => `
    <div class="sample-test-card">
      <div class="test-card-header">
        <span class="test-title">Sample Test Case #${idx + 1}: ${escapeHtml(tc.name)}</span>
      </div>
      <div class="test-card-body">
        <div class="test-row">
          <span class="test-label">Function Call:</span>
          <pre><code>${escapeHtml(tc.call)}</code></pre>
        </div>
        <div class="test-row">
          <span class="test-label">Expected Return:</span>
          <pre><code>${escapeHtml(JSON.stringify(tc.expected, null, 2))}</code></pre>
        </div>
        ${tc.explanation ? `
          <div class="test-row">
            <span class="test-label">Explanation:</span>
            <p style="font-size: 12px; color: #64748b; margin-top: 4px;">${escapeHtml(tc.explanation)}</p>
          </div>
        ` : ""}
      </div>
    </div>
  `).join("");
}

/* ============================================================
   4. Markdown & Mathematical Formula Rendering (KaTeX)
   ============================================================ */
function formatMarkdown(md) {
  if (!md) return "";

  // 1. Unescape escaped literal \n or \\n strings
  let text = String(md).replace(/\\n/g, "\n");

  // 2. Clean up common AI generation typos (e.g. \text{cosine ext{ similarity}})
  text = text.replace(/\\text\{cosine\s+ext\{\s*similarity\}\}/gi, "\\text{cosine similarity}");
  text = text.replace(/ext\{\s*similarity\}/gi, "\\text{similarity}");
  text = text.replace(/ext\{([^}]+)\}/gi, "\\text{$1}");

  // 3. Process Math Formulas (KaTeX / Mathjax delimiters)
  // Block Math: \[ ... \] or $$ ... $$
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (match, math) => {
    return renderMathBlock(math);
  });
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (match, math) => {
    return renderMathBlock(math);
  });

  // Inline Math: \( ... \) or $...$
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, (match, math) => {
    return renderMathInline(math);
  });
  text = text.replace(/\$([^\$\n]+?)\$/g, (match, math) => {
    return renderMathInline(math);
  });

  // 4. Standard Markdown Typography
  text = text.replace(/^### (.*)$/gm, '<h3>$1</h3>');
  text = text.replace(/^## (.*)$/gm, '<h2>$1</h2>');
  text = text.replace(/^# (.*)$/gm, '<h1>$1</h1>');
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/```python([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  text = text.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Lists
  text = text.replace(/^\s*[-*]\s+(.*)$/gm, '<li>$1</li>');
  text = text.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

  // Paragraphs
  const paragraphs = text.split(/\n\s*\n/);
  text = paragraphs.map(p => {
    p = p.trim();
    if (!p) return "";
    if (
      p.startsWith('<h') ||
      p.startsWith('<pre') ||
      p.startsWith('<ul') ||
      p.startsWith('<div class="math-block"')
    ) {
      return p;
    }
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');

  return text;
}

function renderMathBlock(math) {
  math = math.trim();
  if (window.katex) {
    try {
      return `<div class="math-block">${window.katex.renderToString(math, { displayMode: true, throwOnError: false })}</div>`;
    } catch (e) {
      console.warn("KaTeX block render error:", e);
    }
  }
  const fallback = cleanMathText(math);
  return `<div class="math-block"><code>${escapeHtml(fallback)}</code></div>`;
}

function renderMathInline(math) {
  math = math.trim();
  if (window.katex) {
    try {
      return `<span class="math-inline">${window.katex.renderToString(math, { displayMode: false, throwOnError: false })}</span>`;
    } catch (e) {
      console.warn("KaTeX inline render error:", e);
    }
  }
  const fallback = cleanMathText(math);
  return `<span class="math-inline"><code>${escapeHtml(fallback)}</code></span>`;
}

function cleanMathText(str) {
  return str
    .replace(/\\text\{([^}]+)\}/g, '$1')
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1) / ($2)')
    .replace(/\\cdot/g, '·')
    .replace(/\\times/g, '×')
    .replace(/\\|\\|/g, '‖')
    .replace(/\\/g, '');
}

/* ============================================================
   5. Editor Setup & Line Numbers
   ============================================================ */
function setupEditor() {
  if (!dom.codeEditor) return;
  dom.codeEditor.addEventListener("input", () => {
    updateLineNumbers();
    if (state.challenges[state.currentIndex]) {
      state.userCode[state.challenges[state.currentIndex].id] = dom.codeEditor.value;
    }
  });

  dom.codeEditor.addEventListener("keydown", (e) => {
    // Ctrl+Enter or Cmd+Enter to Run Code
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      runSampleCode();
    }
    // Tab key indentation
    if (e.key === "Tab") {
      e.preventDefault();
      const start = dom.codeEditor.selectionStart;
      const end = dom.codeEditor.selectionEnd;
      dom.codeEditor.value = dom.codeEditor.value.substring(0, start) + "    " + dom.codeEditor.value.substring(end);
      dom.codeEditor.selectionStart = dom.codeEditor.selectionEnd = start + 4;
      updateLineNumbers();
    }
  });

  dom.codeEditor.addEventListener("scroll", () => {
    if (dom.lineNumbers) {
      dom.lineNumbers.scrollTop = dom.codeEditor.scrollTop;
    }
  });
}

function updateLineNumbers() {
  if (!dom.codeEditor || !dom.lineNumbers) return;
  const lines = dom.codeEditor.value.split("\n").length;
  dom.lineNumbers.innerHTML = Array.from({ length: lines }, (_, i) => i + 1).join("<br>");
}

/* ============================================================
   6. Code Execution (Run Sample Tests N Times)
   ============================================================ */
async function runSampleCode() {
  const challenge = state.challenges[state.currentIndex];
  if (!challenge || !dom.codeEditor) return;

  const code = dom.codeEditor.value;
  dom.runCodeBtn.disabled = true;
  dom.runCodeBtn.innerHTML = `<span class="btn-icon">⏳</span> Running...`;

  switchConsoleTab("results");
  dom.testResultsList.innerHTML = `<div class="loading-spinner-box"><p>Executing code in secure sandbox against sample test cases...</p></div>`;

  try {
    const res = await fetch(`${CODING_API_BASE}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challenge_id: challenge.id,
        code: code,
        session_id: assessmentToken || "default",
        challenge_index: state.currentIndex,
        challenge_title: challenge.title || ""
      })
    });

    const data = await res.json();
    dom.runCodeBtn.disabled = false;
    dom.runCodeBtn.innerHTML = `<span class="btn-icon">▶</span> Run Code`;

    if (!data.success) {
      dom.testResultsList.innerHTML = `<p style="color: #e11d48; padding: 16px;">Execution failed: ${escapeHtml(data.detail || "Unknown error")}</p>`;
      return;
    }

    renderExecutionResults(data.execution);
  } catch (err) {
    dom.runCodeBtn.disabled = false;
    dom.runCodeBtn.innerHTML = `<span class="btn-icon">▶</span> Run Code`;
    dom.testResultsList.innerHTML = `<p style="color: #e11d48; padding: 16px;">Failed to reach execution runner: ${escapeHtml(err.message)}</p>`;
  }
}

function renderExecutionResults(execution) {
  if (!execution) return;
  const results = execution.results || execution.test_results || [];
  const passed_count = execution.passed_count ?? 0;
  const total_count = execution.total_count ?? results.length;
  const stdout = execution.stdout || "";

  if (dom.samplePassBadge) {
    dom.samplePassBadge.textContent = `${passed_count}/${total_count} Passed`;
    dom.samplePassBadge.className = `badge-results ${passed_count === total_count ? "pass" : "fail"}`;
  }

  if (dom.stdoutBox) {
    dom.stdoutBox.textContent = stdout ? stdout.trim() : "No print output (stdout is empty).";
  }

  if (dom.testResultsList) {
    dom.testResultsList.innerHTML = results.map(r => `
    <div class="test-result-card ${r.status}">
      <div class="result-header">
        <span class="status-tag ${r.status}">
          ${r.status === "passed" ? "✓ PASSED" : (r.status === "failed" ? "✗ FAILED" : "⚠️ ERROR")}
        </span>
        <span class="test-name">${escapeHtml(r.name)}</span>
        <span class="duration-tag">${r.duration_ms} ms</span>
      </div>

      <div class="result-details">
        <div class="detail-row">
          <span class="detail-label">Function Call:</span>
          <code>${escapeHtml(r.call)}</code>
        </div>
        <div class="detail-row">
          <span class="detail-label">Expected Return:</span>
          <code>${escapeHtml(JSON.stringify(r.expected))}</code>
        </div>
        <div class="detail-row">
          <span class="detail-label">Your Output:</span>
          <code>${escapeHtml(JSON.stringify(r.actual))}</code>
        </div>
        ${r.error ? `
          <div class="detail-row error">
            <span class="detail-label">Traceback:</span>
            <pre>${escapeHtml(r.error)}</pre>
          </div>
        ` : ""}
      </div>
    </div>
  `).join("");
  }
}

function resetExecutionPanel() {
  if (dom.samplePassBadge) {
    dom.samplePassBadge.textContent = "0/0 Passed";
    dom.samplePassBadge.className = "badge-results";
  }
  if (dom.stdoutBox) {
    dom.stdoutBox.textContent = "No console output yet.";
  }
  if (dom.testResultsList) {
    dom.testResultsList.innerHTML = `
      <div class="console-placeholder">
        Click <strong>"Run Code"</strong> to test your solution against visible sample test cases. You can run as many times as needed before submitting.
      </div>
    `;
  }
}

function submitAndNext() {
  if (state.challenges[state.currentIndex] && dom.codeEditor) {
    state.userCode[state.challenges[state.currentIndex].id] = dom.codeEditor.value;
  }

  if (state.currentIndex < state.challenges.length - 1) {
    switchChallenge(state.currentIndex + 1);
  } else {
    finishAssessment();
  }
}

/* ============================================================
   7. Final Submission & Sync
   ============================================================ */
async function finishAssessment() {
  if (state.isSubmitted) return;

  if (state.challenges[state.currentIndex] && dom.codeEditor) {
    state.userCode[state.challenges[state.currentIndex].id] = dom.codeEditor.value;
  }

  const confirmed = confirm("Are you ready to finalize and submit your technical assessment? Your code will be evaluated across all challenges.");
  if (!confirmed) return;

  clearInterval(state.timerInterval);
  state.isAssessmentStarted = false;
  state.isSubmitted = true;

  // Lock the workspace
  if (dom.codeEditor) {
    dom.codeEditor.disabled = true;
    dom.codeEditor.readOnly = true;
  }
  if (dom.runCodeBtn) dom.runCodeBtn.disabled = true;
  if (dom.submitNextBtn) dom.submitNextBtn.disabled = true;
  if (dom.finishAssessmentBtn) {
    dom.finishAssessmentBtn.disabled = true;
    dom.finishAssessmentBtn.textContent = "Submitted";
  }
  if (dom.proctorWidget) dom.proctorWidget.style.display = "none";

  openScorecardModal();

  // Stop and upload video
  let videoUrl = null;
  try {
    videoUrl = await stopAndUploadCodingVideo();
  } catch (vidErr) {
    console.error("[Recording] Error stopping and uploading video:", vidErr);
  }

  // Stop media tracks
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach(t => t.stop());
  }

  await submitAssessmentData({
    violationDetected: false,
    codingVideoUrl: videoUrl || state.uploadedVideoUrl
  });
}

async function submitAssessmentData({ violationDetected = false, violationReason = "", codingVideoUrl = null } = {}) {
  const nextApiBase = (typeof window !== "undefined" && window.location.origin && !window.location.origin.includes(":8000"))
    ? window.location.origin
    : "http://localhost:3000";

  try {
    const res = await fetch(`${CODING_API_BASE}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidate_name: assessmentCandidateName || "Technical Candidate",
        candidate_email: assessmentCandidateEmail || "candidate@interview.ai",
        candidate_id: assessmentCandidateId || undefined,
        task_id: assessmentTaskId || undefined,
        session_id: assessmentToken || "default",
        submissions: state.userCode,
        session_metadata: {
          token: assessmentToken,
          candidate_id: assessmentCandidateId,
          camera_monitored: state.cameraActive,
          audio_monitored: state.micActive,
          tab_switches: state.sessionSwitches,
          duration_seconds: (40 * 60) - state.remainingSeconds,
          terminated_due_to_violation: violationDetected,
          violation_reason: violationReason,
          coding_video_url: codingVideoUrl || state.uploadedVideoUrl || undefined
        }
      })
    });

    const data = await res.json();
    const finalScore = (data.success && data.scorecard) ? (data.scorecard.overall_score || 0) : 0;
    if (data.scorecard) {
      state.lastScorecard = data.scorecard;
    }

    // Automatically sync scorecard and violation details to StaffGenie Next.js candidate record
    if (assessmentCandidateId || assessmentToken || assessmentCandidateEmail) {
      try {
        await fetch(`${nextApiBase}/api/coding-assessment/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidateId: assessmentCandidateId,
            candidateEmail: assessmentCandidateEmail,
            token: assessmentToken,
            overallScore: finalScore,
            scorecard: data.scorecard,
            violationDetected: violationDetected,
            violationReason: violationReason,
            codingVideoUrl: codingVideoUrl || state.uploadedVideoUrl || undefined
          })
        });
        console.log("[StaffGenie Sync] Scorecard & violation status synchronized to StaffGenie candidate record.");
      } catch (syncErr) {
        console.warn("[StaffGenie Sync] Could not sync scorecard to StaffGenie:", syncErr);
      }
    }

    if (!violationDetected && data.success && data.scorecard) {
      renderScorecard(data.scorecard);
    }
  } catch (err) {
    console.error("Submission failed:", err);
    if (!violationDetected && dom.scorecardBody) {
      dom.scorecardBody.innerHTML = `<p style="color: #e11d48;">Failed to submit assessment: ${escapeHtml(err.message)}</p>`;
    }
  }
}

function openScorecardModal() {
  if (dom.scorecardModal) dom.scorecardModal.classList.remove("hidden");
  if (dom.scorecardBody) {
    dom.scorecardBody.innerHTML = `
      <div style="text-align: center; padding: 40px 20px;">
        <div style="font-size: 38px; margin-bottom: 14px;">⏳</div>
        <h3 style="color: #0b1c30; font-size: 17px; font-weight: 700; margin-bottom: 8px;">Submitting Technical Solutions...</h3>
        <p style="color: #64748b; font-size: 13px;">Please wait while your answers are securely transmitted to the recruitment team.</p>
      </div>
    `;
  }
}

function renderScorecard(scorecard) {
  if (dom.scorecardBody) {
    dom.scorecardBody.innerHTML = `
      <div style="text-align: center; padding: 24px 16px 16px;">
        <div style="width: 56px; height: 56px; background: #ecfdf5; border: 2px solid #a7f3d0; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 26px; color: #059669;">✓</div>
        <h3 style="color: #0b1c30; font-size: 19px; font-weight: 800; margin-bottom: 8px;">Assessment Completed & Submitted!</h3>
        <p style="color: #475569; font-size: 13.5px; line-height: 1.6; max-width: 460px; margin: 0 auto 18px;">
          Thank you for completing the technical coding assessment. Your solutions have been securely delivered directly to the recruitment team for evaluation.
        </p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 18px; text-align: left; max-width: 460px; margin: 0 auto 18px;">
          <div style="font-size: 11.5px; font-weight: 700; color: #142175; text-transform: uppercase; margin-bottom: 4px;">Proctoring Telemetry Verified</div>
          <p style="font-size: 12.5px; color: #475569; line-height: 1.5; margin: 0;">
            • Continuous Camera & Microphone Stream: <strong>Active</strong><br>
            • Monitored Session Tab Switches: <strong>${state.sessionSwitches}</strong><br>
            • Time Elapsed: <strong>${Math.round(((40 * 60) - state.remainingSeconds) / 60)} minutes</strong>
          </p>
        </div>
        <p style="color: #94a3b8; font-size: 12px; margin-top: 10px;">You may now safely close this browser window.</p>
      </div>
    `;
  }

  // Lock the workspace
  if (dom.codeEditor) dom.codeEditor.readOnly = true;
  if (dom.runCodeBtn) dom.runCodeBtn.disabled = true;
  if (dom.submitNextBtn) dom.submitNextBtn.disabled = true;
  if (dom.finishAssessmentBtn) {
    dom.finishAssessmentBtn.disabled = true;
    dom.finishAssessmentBtn.textContent = "Submitted";
  }

  // Stop media tracks
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach(t => t.stop());
  }
}

/* ============================================================
   8. Countdown Timer
   ============================================================ */
function startTimer() {
  clearInterval(state.timerInterval);
  state.timerInterval = setInterval(() => {
    state.remainingSeconds--;
    if (state.remainingSeconds <= 0) {
      clearInterval(state.timerInterval);
      if (dom.countdownTimer) dom.countdownTimer.textContent = "00:00";
      finishAssessment();
      return;
    }

    const mins = Math.floor(state.remainingSeconds / 60);
    const secs = state.remainingSeconds % 60;
    if (dom.countdownTimer) {
      dom.countdownTimer.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      if (state.remainingSeconds < 5 * 60) {
        dom.countdownTimer.classList.add("urgent");
      }
    }
  }, 1000);
}

/* ============================================================
   9. General Event Listeners
   ============================================================ */
function setupEventListeners() {
  if (dom.runCodeBtn) dom.runCodeBtn.onclick = runSampleCode;
  if (dom.submitNextBtn) dom.submitNextBtn.onclick = submitAndNext;
  if (dom.finishAssessmentBtn) dom.finishAssessmentBtn.onclick = finishAssessment;
  if (dom.resetCodeBtn) {
    dom.resetCodeBtn.onclick = () => {
      const ch = state.challenges[state.currentIndex];
      if (ch && confirm("Reset code back to original starter template?")) {
        dom.codeEditor.value = ch.starter_code;
        state.userCode[ch.id] = ch.starter_code;
        updateLineNumbers();
      }
    };
  }

  // Left Pane Tabs
  document.querySelectorAll(".pane-tab").forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll(".pane-tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(tc => tc.classList.remove("active"));
      tab.classList.add("active");
      const target = tab.dataset.tab;
      if (target === "description") document.getElementById("tabDescription").classList.add("active");
      if (target === "sampleTests") document.getElementById("tabSampleTests").classList.add("active");
    };
  });

  // Console Tabs
  document.querySelectorAll(".console-tab").forEach(tab => {
    tab.onclick = () => switchConsoleTab(tab.dataset.view);
  });

  if (dom.closeModalBtn) {
    dom.closeModalBtn.onclick = () => dom.scorecardModal.classList.add("hidden");
  }
}

function switchConsoleTab(view) {
  document.querySelectorAll(".console-tab").forEach(t => {
    t.classList.toggle("active", t.dataset.view === view);
  });
  document.querySelectorAll(".console-view").forEach(v => v.classList.remove("active"));
  if (view === "results") document.getElementById("viewResults").classList.add("active");
  if (view === "logs") document.getElementById("viewLogs").classList.add("active");
}

function escapeHtml(str) {
  if (typeof str !== "string") str = String(str ?? "");
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Expose critical hardware handlers globally for inline HTML button triggers
window.requestHardwarePermissions = requestHardwarePermissions;
window.startAssessmentSession = startAssessmentSession;

// Ensure initialization runs reliably regardless of script loading timing
if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

