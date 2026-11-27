const transcriptElement = document.querySelector("#transcript");
const recordButton = document.querySelector("#record-button");
const recordLabel = document.querySelector("#record-button-label");
const recordState = document.querySelector("#record-state");
const liveDot = document.querySelector("#live-dot");
const waveform = document.querySelector("#waveform");
const languageSelect = document.querySelector("#language-select");
const historyList = document.querySelector("#history-list");
const emptyState = document.querySelector("#empty-state");
const toast = document.querySelector("#toast");
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition = null;
let isRecording = false;
let finalText = "";
let finishRecognitionStop = null;
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function renderLiveTranscript(interim = "") {
  transcriptElement.replaceChildren();
  const committed = document.createElement("span");
  committed.textContent = finalText;
  transcriptElement.append(committed);
  if (interim) {
    const pending = document.createElement("span");
    pending.className = "interim";
    pending.textContent = `${finalText ? " " : ""}${interim}`;
    transcriptElement.append(pending);
  }
  if (!finalText && !interim) {
    const placeholder = document.createElement("span");
    placeholder.className = "placeholder";
    placeholder.textContent = "Your transcription will appear here...";
    transcriptElement.append(placeholder);
  }
}

function setRecordingState(recording) {
  isRecording = recording;
  recordButton.classList.toggle("recording", recording);
  liveDot.classList.toggle("recording", recording);
  waveform.classList.toggle("active", recording);
  recordLabel.textContent = recording ? "Stop & save" : "Start speaking";
  recordState.textContent = recording ? "LISTENING — SPEAK NATURALLY" : "READY WHEN YOU ARE";
  document.querySelector("#hint-text").textContent = recording
    ? "Tap stop when you’re done"
    : "Click to start speaking";
}

function makeRecognition() {
  recognition = new Recognition();
  recognition.lang = languageSelect.value;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = (event) => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result.isFinal) finalText += result[0].transcript;
      else interim += result[0].transcript;
    }
    renderLiveTranscript(interim);
  };
  recognition.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      setRecordingState(false);
      showToast("Microphone access was denied. Allow it in your browser settings.");
    } else if (event.error !== "no-speech" && event.error !== "aborted") {
      showToast(`Recognition error: ${event.error}`);
    }
  };
  recognition.onend = () => {
    if (finishRecognitionStop) finishRecognitionStop();
    if (isRecording) {
      try {
        recognition.start();
      } catch {
        setRecordingState(false);
      }
    }
  };
}

async function saveTranscript(text, language) {
  const response = await fetch("/api/transcriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, language }),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  await loadHistory();
}

async function stopAndSave() {
  setRecordingState(false);
  if (recognition) {
    await new Promise((resolve) => {
      let timeout;
      const finish = () => {
        clearTimeout(timeout);
        finishRecognitionStop = null;
        resolve();
      };
      finishRecognitionStop = finish;
      timeout = setTimeout(finish, 1500);
      recognition.stop();
    });
  }
  const text = finalText.trim();
  finalText = "";
  renderLiveTranscript();
  if (!text) {
    showToast("No speech was captured. Try again.");
    return;
  }
  try {
    await saveTranscript(text, languageSelect.value);
    showToast("Transcription saved to your history.");
  } catch (error) {
    showToast(error.message);
  }
}

recordButton.addEventListener("click", async () => {
  if (isRecording) {
    await stopAndSave();
    return;
  }
  if (!Recognition) {
    document.querySelector("#browser-note").hidden = false;
    return;
  }
  finalText = "";
  renderLiveTranscript();
  makeRecognition();
  try {
    recognition.start();
    setRecordingState(true);
  } catch (error) {
    showToast(`Could not start recognition: ${error.message}`);
  }
});

languageSelect.addEventListener("change", () => {
  if (isRecording) {
    recognition.stop();
    makeRecognition();
    recognition.start();
  }
});

async function errorMessage(response) {
  try {
    const body = await response.json();
    return body.detail || "The request could not be completed.";
  } catch {
    return "The request could not be completed.";
  }
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function createHistoryItem(item) {
  const card = document.createElement("article");
  card.className = "history-item";
  const meta = document.createElement("div");
  meta.className = "history-meta";
  const language = document.createElement("span");
  language.className = "history-language";
  language.textContent = item.language.toUpperCase();
  const date = document.createElement("span");
  date.textContent = formatDate(item.created_at);
  const actions = document.createElement("div");
  actions.className = "history-actions";
  const edit = document.createElement("button");
  edit.type = "button";
  edit.textContent = "Edit";
  edit.setAttribute("aria-label", "Edit transcription");
  edit.addEventListener("click", () => editTranscript(item));
  const remove = document.createElement("button");
  remove.className = "delete-action";
  remove.type = "button";
  remove.textContent = "Delete";
  remove.setAttribute("aria-label", "Delete transcription");
  remove.addEventListener("click", () => deleteTranscript(item.id));
  actions.append(edit, remove);
  meta.append(language, date, actions);
  const text = document.createElement("div");
  text.className = "history-text";
  text.textContent = item.text;
  card.append(meta, text);
  return card;
}

async function loadHistory() {
  const response = await fetch("/api/transcriptions");
  if (!response.ok) throw new Error(await errorMessage(response));
  const items = await response.json();
  historyList.replaceChildren(...items.map(createHistoryItem));
  emptyState.hidden = items.length > 0;
  document.querySelector("#nav-count").textContent = items.length;
}

async function editTranscript(item) {
  const text = window.prompt("Edit this transcription:", item.text);
  if (text === null || text.trim() === item.text) return;
  if (!text.trim()) {
    showToast("A transcription cannot be blank.");
    return;
  }
  try {
    const response = await fetch(`/api/transcriptions/${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.trim() }),
    });
    if (!response.ok) throw new Error(await errorMessage(response));
    await loadHistory();
    showToast("Transcription updated.");
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteTranscript(id) {
  if (!window.confirm("Delete this transcription? This cannot be undone.")) return;
  try {
    const response = await fetch(`/api/transcriptions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error(await errorMessage(response));
    await loadHistory();
    showToast("Transcription deleted.");
  } catch (error) {
    showToast(error.message);
  }
}

document.querySelector("#refresh-button").addEventListener("click", () => {
  loadHistory().catch((error) => showToast(error.message));
});

document.querySelector("#audio-file").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) {
    showToast("Audio file exceeds 25 MB.");
    event.target.value = "";
    return;
  }
  const button = document.querySelector(".upload-button");
  button.textContent = "Transcribing…";
  button.setAttribute("aria-disabled", "true");
  const formData = new FormData();
  formData.append("audio", file);
  try {
    const response = await fetch("/api/transcribe", { method: "POST", body: formData });
    if (!response.ok) throw new Error(await errorMessage(response));
    await loadHistory();
    showToast("Whisper transcription saved to your history.");
  } catch (error) {
    showToast(error.message);
  } finally {
    button.innerHTML = 'Upload audio <span>↗</span>';
    button.removeAttribute("aria-disabled");
    event.target.value = "";
  }
});

loadHistory().catch((error) => showToast(error.message));
