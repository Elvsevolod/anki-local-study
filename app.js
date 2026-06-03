const CDN_SQL_WASM = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/";
const FIELD_SEP = "\u001f";
const PROGRESS_KEY = "anki-local-progress-v2";
const COLLECTION_DB = "anki-local-store";
const COLLECTION_STORE = "collections";
const COLLECTION_INDEX_KEY = "_index";

function openCollectionDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(COLLECTION_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(COLLECTION_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadFilesIndex() {
  try {
    const db = await openCollectionDb();
    const tx = db.transaction(COLLECTION_STORE, "readonly");
    const req = tx.objectStore(COLLECTION_STORE).get(COLLECTION_INDEX_KEY);
    const raw = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = reject;
    });
    db.close();
    return raw || { files: [], activeId: null };
  } catch {
    return { files: [], activeId: null };
  }
}

async function saveFilesIndex(index) {
  try {
    const db = await openCollectionDb();
    const tx = db.transaction(COLLECTION_STORE, "readwrite");
    tx.objectStore(COLLECTION_STORE).put(index, COLLECTION_INDEX_KEY);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });
    db.close();
  } catch (err) {
    console.warn("Не удалось сохранить индекс:", err);
  }
}

async function storeCollectionFile(file, fileId) {
  try {
    const db = await openCollectionDb();
    const tx = db.transaction(COLLECTION_STORE, "readwrite");
    tx.objectStore(COLLECTION_STORE).put(file, fileId);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });
    db.close();
  } catch (err) {
    console.warn("Не удалось сохранить файл в IndexedDB:", err);
  }
}

async function loadCollectionFile(fileId) {
  try {
    const db = await openCollectionDb();
    const tx = db.transaction(COLLECTION_STORE, "readonly");
    const req = tx.objectStore(COLLECTION_STORE).get(fileId);
    const file = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = reject;
    });
    db.close();
    return file || null;
  } catch {
    return null;
  }
}

async function deleteCollectionFile(fileId) {
  try {
    const db = await openCollectionDb();
    const tx = db.transaction(COLLECTION_STORE, "readwrite");
    tx.objectStore(COLLECTION_STORE).delete(fileId);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });
    db.close();
  } catch (err) {
    console.warn("Не удалось удалить файл из IndexedDB:", err);
  }
}

const els = {
  pickFileBtn: document.getElementById("pickFileBtn"),
  resetAllBtn: document.getElementById("resetAllBtn"),
  fileInput: document.getElementById("fileInput"),
  pasteBtn: document.getElementById("pasteBtn"),
  collectionName: document.getElementById("collectionName"),
  collectionMeta: document.getElementById("collectionMeta"),
  deckList: document.getElementById("deckList"),
  activeDeckLabel: document.getElementById("activeDeckLabel"),
  screenTitle: document.getElementById("screenTitle"),
  dueCount: document.getElementById("dueCount"),
  newCount: document.getElementById("newCount"),
  doneCount: document.getElementById("doneCount"),
  emptyState: document.getElementById("emptyState"),
  finishedState: document.getElementById("finishedState"),
  flashcard: document.getElementById("flashcard"),
  cardPosition: document.getElementById("cardPosition"),
  questionFace: document.getElementById("questionFace"),
  answerFace: document.getElementById("answerFace"),
  showAnswerBtn: document.getElementById("showAnswerBtn"),
  ratingRow: document.getElementById("ratingRow"),
  shuffleBtn: document.getElementById("shuffleBtn"),
  restartBtn: document.getElementById("restartBtn"),
  progressBar: document.getElementById("progressBar"),
  sessionText: document.getElementById("sessionText"),
  cardType: document.getElementById("cardType"),
  cardDeck: document.getElementById("cardDeck"),
  cardTags: document.getElementById("cardTags"),
  toast: document.getElementById("toast"),
  dropOverlay: document.getElementById("dropOverlay"),
  filesList: document.getElementById("filesList"),
  filesSection: document.getElementById("filesSection"),
  sidebar: document.getElementById("sidebar"),
  sidebarToggle: document.getElementById("sidebarToggle"),
  sidebarClose: document.getElementById("sidebarClose"),
  sidebarOverlay: document.getElementById("sidebarOverlay"),
};

const initialProgress = loadProgress();

const state = {
  collection: null,
  activeFileId: null,
  activeDeckId: "all",
  queue: [],
  queueOriginalLength: 0,
  currentIndex: 0,
  answerVisible: false,
  progress: initialProgress,
  filesIndex: { files: [], activeId: null },
  studiedToday: 0,
};

let sqlReady;
let toastTimer;

els.pickFileBtn.addEventListener("click", () => els.fileInput.click());
els.resetAllBtn.addEventListener("click", resetAll);
els.fileInput.addEventListener("change", handleFileSelect);
els.showAnswerBtn.addEventListener("click", showAnswer);
els.shuffleBtn.addEventListener("click", shuffleQueue);
els.restartBtn.addEventListener("click", () => {
  buildQueue({ includeAll: true });
  render();
});

els.ratingRow.addEventListener("click", (event) => {
  const button = event.target.closest("[data-rating]");
  if (!button) return;
  rateCurrent(button.dataset.rating);
});

els.pasteBtn.addEventListener("click", pasteFromClipboard);

document.addEventListener("paste", (event) => {
  const file = getFileFromPasteEvent(event);
  if (file) {
    event.preventDefault();
    importFile(file);
  }
});

let dragCounter = 0;

document.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragCounter++;
  if (dragCounter === 1) {
    els.dropOverlay.classList.remove("hidden");
    refreshIcons();
  }
});

document.addEventListener("dragleave", (event) => {
  event.preventDefault();
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    els.dropOverlay.classList.add("hidden");
  }
});

document.addEventListener("dragover", (event) => {
  event.preventDefault();
});

document.addEventListener("drop", (event) => {
  event.preventDefault();
  dragCounter = 0;
  els.dropOverlay.classList.add("hidden");

  const file = getFileFromDropEvent(event);
  if (file) {
    importFile(file);
  }
});

/* --- Sidebar toggle --- */

function openSidebar() {
  els.sidebar.classList.add("open");
  els.sidebarOverlay.classList.remove("hidden");
  refreshIcons();
}

function closeSidebar() {
  els.sidebar.classList.remove("open");
  els.sidebarOverlay.classList.add("hidden");
}

function toggleSidebar() {
  if (els.sidebar.classList.contains("open")) {
    closeSidebar();
  } else {
    openSidebar();
  }
}

els.sidebarToggle.addEventListener("click", toggleSidebar);
els.sidebarClose.addEventListener("click", closeSidebar);
els.sidebarOverlay.addEventListener("click", closeSidebar);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && els.sidebar.classList.contains("open")) {
    closeSidebar();
  }
});

function maybeCloseSidebar() {
  const isMobile = window.matchMedia("(max-width: 980px)").matches;
  if (isMobile) closeSidebar();
}

fixIosFileAccept();

(async function init() {
  const index = await loadFilesIndex();
  state.filesIndex = index;

  const activeId = index.activeId;
  if (activeId) {
    const file = await loadCollectionFile(activeId);
    if (file) {
      try {
        await importFile(file, { silent: true, skipStore: true, fileId: activeId });
      } catch (err) {
        console.warn("Не удалось восстановить коллекцию:", err);
      }
    } else {
      index.activeId = null;
      index.files = index.files.filter((f) => f.id !== activeId);
      saveFilesIndex(index);
      state.filesIndex = index;
    }
  }
  render();
  refreshIcons();
})();

async function handleFileSelect(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  await importFile(file);
  els.fileInput.value = "";
}

async function importFile(file, { silent = false, skipStore = false, fileId = null } = {}) {
  if (!silent) setLoading(true, "Импортирую...");
  try {
    const nextCollection = await importApkg(file);
    revokeMediaUrls(state.collection);
    state.collection = nextCollection;
    state.activeDeckId = "all";

    const id = fileId || `file_${Date.now()}`;
    state.activeFileId = id;

    if (!skipStore) {
      await storeCollectionFile(file, id);

      const name = file.name.replace(/\.apkg$/i, "") || "Колода";
      const index = state.filesIndex;
      const existing = index.files.find((f) => f.id === id);
      if (existing) {
        existing.name = name;
        existing.cardCount = nextCollection.cards.length;
        existing.openedAt = Date.now();
      } else {
        index.files.push({ id, name, cardCount: nextCollection.cards.length, openedAt: Date.now() });
      }
      index.activeId = id;
      saveFilesIndex(index);
    }

    state.studiedToday = getTodayCount();
    buildQueue();
    if (!silent) {
      showToast(
        `Загружено: ${pluralRu(state.collection.cards.length, ["карточка", "карточки", "карточек"])}`,
      );
    }
    maybeCloseSidebar();
    render();
  } catch (error) {
    console.error(error);
    if (!silent) showToast(error.message || "Не удалось прочитать пакет Anki");
  } finally {
    if (!silent) setLoading(false);
  }
}

async function importApkg(file) {
  if (!window.JSZip || !window.initSqlJs) {
    throw new Error("Библиотеки для чтения .apkg еще загружаются. Попробуйте снова.");
  }

  const zip = await JSZip.loadAsync(file);
  const collectionEntry =
    zip.file("collection.anki21b") ||
    zip.file("collection.anki2b") ||
    zip.file("collection.anki21") ||
    zip.file("collection.anki2");

  if (!collectionEntry) {
    throw new Error("Внутри .apkg не найден collection.anki2.");
  }

  const dbBytes = await readApkgBytes(collectionEntry);
  const SQL = await getSql();
  const db = new SQL.Database(dbBytes);

  const col = firstRow(
    db,
    "select id, crt, mod, decks, models from col limit 1",
  );
  if (!col) {
    throw new Error("Коллекция Anki пустая или повреждена.");
  }

  const decks = parseJsonMap(col.decks);
  const models = parseJsonMap(col.models);
  const mediaUrls = await buildMediaUrls(zip);
  const notes = readNotes(db, models, mediaUrls);
  const cards = readCards(db, notes, decks, models);

  db.close();

  if (!cards.length) {
    throw new Error("В пакете нет карточек для обучения.");
  }

  return {
    key: `${file.name}:${file.size}:${file.lastModified}`,
    name: file.name.replace(/\.apkg$/i, ""),
    createdAt: col.crt,
    decks,
    models,
    notes,
    cards,
    mediaUrls,
  };
}

function getSql() {
  if (!sqlReady) {
    sqlReady = initSqlJs({
      locateFile: (file) => `${CDN_SQL_WASM}${file}`,
    });
  }
  return sqlReady;
}

function parseJsonMap(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function readNotes(db, models, mediaUrls) {
  const rows = allRows(db, "select id, guid, mid, flds, sfld, tags from notes");
  const notes = new Map();

  rows.forEach((row) => {
    const model = models[String(row.mid)];
    const rawFields = String(row.flds || "").split(FIELD_SEP);
    const fieldNames = getFieldNames(model, rawFields.length);
    const fields = {};

    fieldNames.forEach((name, index) => {
      fields[name] = rewriteMedia(rawFields[index] || "", mediaUrls);
    });

    notes.set(Number(row.id), {
      id: Number(row.id),
      guid: row.guid,
      mid: String(row.mid),
      model,
      modelName: model?.name || "Карточка",
      fieldNames,
      fields,
      sortField: rewriteMedia(row.sfld || "", mediaUrls),
      tags: normalizeTags(row.tags),
    });
  });

  return notes;
}

function readCards(db, notes, decks, models) {
  const rows = allRows(
    db,
    "select id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses from cards order by due asc",
  );

  return rows
    .map((row) => {
      const note = notes.get(Number(row.nid));
      if (!note) return null;

      const deck = decks[String(row.did)] || { id: row.did, name: "Без колоды" };
      const template = getTemplate(note.model || models[note.mid], row.ord);

      return {
        id: Number(row.id),
        nid: Number(row.nid),
        deckId: String(row.did),
        deckName: cleanDeckName(deck.name),
        ord: Number(row.ord || 0),
        type: Number(row.type || 0),
        queue: Number(row.queue || 0),
        due: Number(row.due || 0),
        interval: Number(row.ivl || 0),
        factor: Number(row.factor || 2500),
        reps: Number(row.reps || 0),
        lapses: Number(row.lapses || 0),
        templateName: template?.name || `Карточка ${Number(row.ord || 0) + 1}`,
        qfmt: template?.qfmt || "{{Front}}",
        afmt: template?.afmt || "{{FrontSide}}<hr id=answer>{{Back}}",
        note,
      };
    })
    .filter(Boolean);
}

async function buildMediaUrls(zip) {
  const mediaEntry = zip.file("media");
  if (!mediaEntry) return new Map();

  let mediaMap = {};
  try {
    const mediaBytes = await readApkgBytes(mediaEntry);
    mediaMap = parseMediaMap(mediaBytes);
  } catch {
    return new Map();
  }

  const urls = new Map();
  const jobs = mediaMap.map(async ([zipName, fileName]) => {
    const mediaFile = zip.file(zipName);
    if (!mediaFile || !fileName) return;
    const mediaBytes = await readApkgBytes(mediaFile);
    const blob = new Blob([mediaBytes], { type: getMimeType(fileName) });
    urls.set(fileName, URL.createObjectURL(blob));
  });

  await Promise.all(jobs);
  return urls;
}

function parseMediaMap(bytes) {
  const text = new TextDecoder().decode(bytes);
  try {
    return Object.entries(JSON.parse(text));
  } catch {
    return parseBinaryMediaMap(bytes);
  }
}

function parseBinaryMediaMap(bytes) {
  const entries = [];
  let offset = 0;

  while (offset < bytes.length) {
    const outerKey = readVarint(bytes, offset);
    offset = outerKey.offset;
    if ((outerKey.value & 7) !== 2) break;

    const length = readVarint(bytes, offset);
    offset = length.offset;
    const end = offset + length.value;
    const name = readMediaMessageName(bytes.subarray(offset, end));
    if (name) entries.push([String(entries.length), name]);
    offset = end;
  }

  return entries;
}

function readMediaMessageName(bytes) {
  let offset = 0;

  while (offset < bytes.length) {
    const key = readVarint(bytes, offset);
    offset = key.offset;
    const field = key.value >> 3;
    const wireType = key.value & 7;

    if (wireType === 2) {
      const length = readVarint(bytes, offset);
      offset = length.offset;
      const value = bytes.subarray(offset, offset + length.value);
      offset += length.value;
      if (field === 1) return new TextDecoder().decode(value);
    } else if (wireType === 0) {
      offset = readVarint(bytes, offset).offset;
    } else {
      break;
    }
  }

  return "";
}

function readVarint(bytes, offset) {
  let value = 0;
  let shift = 0;

  while (offset < bytes.length) {
    const byte = bytes[offset];
    offset += 1;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }

  return { value, offset };
}

function getMimeType(filename) {
  const ext = String(filename).split(".").pop()?.toLowerCase();
  const mimeTypes = {
    apng: "image/apng",
    avif: "image/avif",
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    oga: "audio/ogg",
    ogg: "audio/ogg",
    opus: "audio/ogg",
    png: "image/png",
    svg: "image/svg+xml",
    wav: "audio/wav",
    webm: "video/webm",
    webp: "image/webp",
  };

  return mimeTypes[ext] || "application/octet-stream";
}

async function readApkgBytes(entry) {
  const bytes = await entry.async("uint8array");
  if (!isZstd(bytes)) return bytes;

  if (!window.fzstd?.decompress) {
    throw new Error("Этот .apkg использует Zstandard, но zstd-декодер не загрузился.");
  }

  return window.fzstd.decompress(bytes);
}

function isZstd(bytes) {
  return (
    bytes?.length >= 4 &&
    bytes[0] === 0x28 &&
    bytes[1] === 0xb5 &&
    bytes[2] === 0x2f &&
    bytes[3] === 0xfd
  );
}

function rewriteMedia(html, mediaUrls) {
  let output = String(html || "");
  mediaUrls.forEach((url, filename) => {
    const escaped = escapeRegExp(filename);
    output = output.replace(
      new RegExp(`((?:src|href)=["'])${escaped}(["'])`, "g"),
      `$1${url}$2`,
    );
  });
  return output;
}

function buildQueue(options = {}) {
  if (!state.collection) {
    state.queue = [];
    state.queueOriginalLength = 0;
    state.currentIndex = 0;
    return;
  }

  const now = Date.now();
  const cards = state.collection.cards.filter((card) => {
    if (state.activeDeckId !== "all" && card.deckId !== state.activeDeckId) {
      return false;
    }
    const progress = getCardProgress(card.id);
    return options.includeAll || !progress || progress.dueAt <= now;
  });

  state.queue = cards
    .sort((a, b) => {
      const ap = getCardProgress(a.id);
      const bp = getCardProgress(b.id);
      return (ap?.dueAt || 0) - (bp?.dueAt || 0);
    })
    .slice(0, 100);
  state.queueOriginalLength = state.queue.length;
  state.currentIndex = 0;
  state.answerVisible = false;
}

async function switchToFile(fileId) {
  if (fileId === state.activeFileId && state.collection) return;
  saveProgress();

  revokeMediaUrls(state.collection);
  state.collection = null;
  state.queue = [];
  state.queueOriginalLength = 0;
  state.currentIndex = 0;
  state.answerVisible = false;
  state.activeFileId = null;

  const file = await loadCollectionFile(fileId);
  if (!file) {
    removeFileFromIndex(fileId);
    render();
    return;
  }

  try {
    state.filesIndex.activeId = fileId;
    saveFilesIndex(state.filesIndex);
    await importFile(file, { silent: true, skipStore: true, fileId });
  } catch (err) {
    console.warn("Не удалось переключиться на файл:", err);
    removeFileFromIndex(fileId);
  }
}

async function removeFileFromUI(fileId, event) {
  event.stopPropagation();
  const confirmed = window.confirm(
    "Удалить файл и его прогресс из списка?"
  );
  if (!confirmed) return;

  removeFileFromIndex(fileId);
}

async function removeFileFromIndex(fileId) {
  await deleteCollectionFile(fileId);
  const index = state.filesIndex;
  index.files = index.files.filter((f) => f.id !== fileId);

  if (index.activeId === fileId) {
    revokeMediaUrls(state.collection);
    state.collection = null;
    state.activeFileId = null;
    state.queue = [];
    state.queueOriginalLength = 0;
    state.currentIndex = 0;
    state.answerVisible = false;

    // Remove progress for this file
    const progress = state.progress;
    delete progress.byFile[fileId];
    saveProgress();

    // Switch to another file if available
    const next = index.files[index.files.length - 1];
    if (next) {
      index.activeId = next.id;
      saveFilesIndex(index);
      state.filesIndex = index;
      const file = await loadCollectionFile(next.id);
      if (file) {
        try {
          await importFile(file, { silent: true, skipStore: true, fileId: next.id });
        } catch (err) {
          console.warn("Не удалось переключиться:", err);
        }
      }
      return;
    }
    index.activeId = null;
  }

  saveFilesIndex(index);
  state.studiedToday = getTodayCount();
  render();
}

function renderFilesList() {
  els.filesList.innerHTML = "";
  const files = state.filesIndex.files || [];

  if (files.length <= 1) {
    els.filesSection.classList.add("hidden");
    return;
  }

  els.filesSection.classList.remove("hidden");

  files
    .sort((a, b) => b.openedAt - a.openedAt)
    .forEach((file) => {
      const item = document.createElement("div");
      item.className = `file-item ${file.id === state.activeFileId ? "active" : ""}`;
      item.innerHTML = `
        <span class="file-item-name">${escapeHtml(file.name)}</span>
        <span class="file-item-count">${file.cardCount || 0}</span>
        <button class="file-item-remove" type="button" title="Удалить">
          <i data-lucide="x"></i>
        </button>
      `;

      item.addEventListener("click", () => switchToFile(file.id));
      item
        .querySelector(".file-item-remove")
        .addEventListener("click", (e) => removeFileFromUI(file.id, e));

      els.filesList.append(item);
    });
}

function render() {
  renderCollection();
  renderFilesList();
  renderDecks();
  renderStats();
  renderStudy();
  refreshIcons();
}

function resetAll() {
  const fileId = state.activeFileId;
  if (!fileId || !state.collection) {
    showToast("Нет загруженной колоды");
    return;
  }

  const confirmed = window.confirm(
    "Сбросить прогресс текущей колоды и начать заново?",
  );
  if (!confirmed) return;

  // Reset progress for this file only
  state.progress.byFile[fileId] = { cards: {}, days: {} };
  saveProgress();
  state.studiedToday = 0;
  buildQueue({ includeAll: true });
  showToast("Прогресс сброшен");
  render();
}

function revokeMediaUrls(collection) {
  collection?.mediaUrls?.forEach((url) => URL.revokeObjectURL(url));
}

function renderCollection() {
  if (!state.collection) {
    els.collectionName.textContent = "Файл не загружен";
    els.collectionMeta.textContent = "Выберите пакет Anki";
    els.activeDeckLabel.textContent = "Все колоды";
    els.screenTitle.textContent = "Учебная сессия";
    return;
  }

  els.collectionName.textContent = state.collection.name;
  els.collectionMeta.textContent = pluralRu(state.collection.cards.length, [
    "карточка",
    "карточки",
    "карточек",
  ]);
  const activeDeck = getActiveDeckName();
  els.activeDeckLabel.textContent = activeDeck;
  els.screenTitle.textContent = "Учебная сессия";
}

function renderDecks() {
  els.deckList.innerHTML = "";
  if (!state.collection) return;

  const deckCounts = getDeckCounts();
  const buttons = [
    {
      id: "all",
      name: "Все колоды",
      count: state.collection.cards.length,
    },
    ...Object.entries(state.collection.decks)
      .map(([id, deck]) => ({
        id,
        name: cleanDeckName(deck.name || "Без колоды"),
        count: deckCounts.get(id) || 0,
      }))
      .filter((deck) => deck.count > 0)
      .sort((a, b) => a.name.localeCompare(b.name, "ru")),
  ];

  buttons.forEach((deck) => {
    const button = document.createElement("button");
    button.className = `deck-btn ${deck.id === state.activeDeckId ? "active" : ""}`;
    button.type = "button";
    button.innerHTML = `
      <span class="deck-name">${escapeHtml(deck.name)}</span>
      <span class="deck-count">${deck.count}</span>
    `;
    button.addEventListener("click", () => {
      state.activeDeckId = deck.id;
      buildQueue();
      maybeCloseSidebar();
      render();
    });
    els.deckList.append(button);
  });
}

function renderStats() {
  const cards = getFilteredCards();
  const now = Date.now();
  let due = 0;
  let fresh = 0;

  cards.forEach((card) => {
    const progress = getCardProgress(card.id);
    if (!progress) {
      fresh += 1;
    } else if (progress.dueAt <= now) {
      due += 1;
    }
  });

  els.dueCount.textContent = due;
  els.newCount.textContent = fresh;
  els.doneCount.textContent = state.studiedToday;
}

function renderStudy() {
  const hasCollection = Boolean(state.collection);
  const current = state.queue[state.currentIndex];

  els.emptyState.classList.toggle("hidden", hasCollection);
  els.flashcard.classList.toggle("hidden", !current);
  els.finishedState.classList.toggle("hidden", !hasCollection || Boolean(current));

  if (!hasCollection) {
    els.sessionText.textContent = "Нет активной сессии";
    els.progressBar.style.width = "0%";
    clearCardDetails();
    return;
  }

  if (!current) {
    els.sessionText.textContent = "Сессия завершена";
    els.progressBar.style.width = "100%";
    clearCardDetails();
    return;
  }

  const questionHtml = renderCardSide(current, "question");
  const answerHtml = renderCardSide(current, "answer", questionHtml);
  els.questionFace.innerHTML = questionHtml;
  els.answerFace.innerHTML = answerHtml;
  els.answerFace.classList.toggle("hidden", !state.answerVisible);
  els.showAnswerBtn.classList.toggle("hidden", state.answerVisible);
  els.ratingRow.classList.toggle("hidden", !state.answerVisible);
  els.cardPosition.textContent = `${state.currentIndex + 1} / ${state.queue.length}`;

  const done = state.currentIndex;
  const total = Math.max(state.queueOriginalLength, state.queue.length, 1);
  els.progressBar.style.width = `${Math.min(100, Math.round((done / total) * 100))}%`;
  const left = Math.max(state.queue.length - state.currentIndex, 0);
  els.sessionText.textContent = `${pluralRu(left, [
    "карточка",
    "карточки",
    "карточек",
  ])} в очереди`;

  els.cardType.textContent = `${current.note.modelName} / ${current.templateName}`;
  els.cardDeck.textContent = current.deckName;
  els.cardTags.textContent = current.note.tags || "-";
}

function renderCardSide(card, side, frontSide = "") {
  const template = side === "question" ? card.qfmt : card.afmt;
  return renderTemplate(template, card, side, frontSide);
}

function renderTemplate(template, card, side, frontSide) {
  const note = card.note;
  let html = String(template || "");

  html = html.replace(/\{\{FrontSide\}\}/g, frontSide || "");
  html = applyConditionals(html, note.fields);

  html = html.replace(/\{\{cloze(?::[^}:]+)*:([^}]+)\}\}/g, (_match, fieldName) => {
    const raw = note.fields[fieldName.trim()] || "";
    return renderCloze(raw, card.ord, side);
  });

  html = html.replace(/\{\{type:([^}]+)\}\}/g, (_match, fieldName) => {
    return note.fields[fieldName.trim()] || "";
  });

  html = html.replace(/\{\{([^{}]+)\}\}/g, (_match, rawToken) => {
    const token = rawToken.trim();
    if (!token || token.startsWith("tts ")) return "";
    if (token === "Tags") return escapeHtml(note.tags || "");
    if (token === "Deck") return escapeHtml(card.deckName);
    if (token === "Card") return escapeHtml(card.templateName);

    const fieldName = token.includes(":") ? token.split(":").pop().trim() : token;
    return note.fields[fieldName] || "";
  });

  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\[sound:([^\]]+)\]/g, "");
}

function applyConditionals(template, fields) {
  let output = template;
  for (let i = 0; i < 4; i += 1) {
    output = output.replace(
      /\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
      (_match, field, content) => (fields[field.trim()] ? content : ""),
    );
    output = output.replace(
      /\{\{\^([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
      (_match, field, content) => (fields[field.trim()] ? "" : content),
    );
  }
  return output;
}

function renderCloze(rawHtml, activeOrd, side) {
  const activeNumber = activeOrd + 1;
  return String(rawHtml).replace(
    /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g,
    (_match, number, text, hint) => {
      const isActive = Number(number) === activeNumber;
      if (side === "question" && isActive) {
        return `<span class="cloze">${hint || "..."}</span>`;
      }
      if (side === "answer" && isActive) {
        return `<span class="cloze-answer">${text}</span>`;
      }
      return text;
    },
  );
}

function showAnswer() {
  if (!state.queue[state.currentIndex]) return;
  state.answerVisible = true;
  renderStudy();
  refreshIcons();
}

function rateCurrent(rating) {
  const card = state.queue[state.currentIndex];
  if (!card) return;

  const previous = getCardProgress(card.id);
  const baseInterval = previous?.intervalDays || Math.max(0, card.interval);
  const next = scheduleForRating(rating, baseInterval, previous);

  const fp = getFileProgress();
  fp.cards[String(card.id)] = {
    dueAt: next.dueAt,
    intervalDays: next.intervalDays,
    reps: (previous?.reps || card.reps || 0) + 1,
    lastRating: rating,
    updatedAt: Date.now(),
  };
  saveProgress();
  bumpTodayCount();

  if (rating === "again") {
    state.queue.push(card);
  }

  state.currentIndex += 1;
  state.answerVisible = false;
  render();
}

function scheduleForRating(rating, intervalDays, previous) {
  const now = Date.now();
  const fresh = !previous;
  const oneDay = 24 * 60 * 60 * 1000;
  const tenMinutes = 10 * 60 * 1000;
  let days;

  if (rating === "again") {
    return { dueAt: now + tenMinutes, intervalDays: 0 };
  }
  if (rating === "hard") {
    days = fresh ? 1 : Math.max(1, Math.round(intervalDays * 1.25));
  } else if (rating === "easy") {
    days = fresh ? 4 : Math.max(4, Math.round(intervalDays * 3.2));
  } else {
    days = fresh ? 1 : Math.max(2, Math.round(intervalDays * 2.3));
  }

  return { dueAt: now + days * oneDay, intervalDays: days };
}

function shuffleQueue() {
  for (let i = state.queue.length - 1; i > state.currentIndex; i -= 1) {
    const j = state.currentIndex + Math.floor(Math.random() * (i - state.currentIndex + 1));
    [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
  }
  renderStudy();
}

function getFilteredCards() {
  if (!state.collection) return [];
  return state.collection.cards.filter(
    (card) => state.activeDeckId === "all" || card.deckId === state.activeDeckId,
  );
}

function getDeckCounts() {
  const counts = new Map();
  state.collection.cards.forEach((card) => {
    counts.set(card.deckId, (counts.get(card.deckId) || 0) + 1);
  });
  return counts;
}

function getActiveDeckName() {
  if (!state.collection || state.activeDeckId === "all") return "Все колоды";
  return cleanDeckName(state.collection.decks[state.activeDeckId]?.name || "Колода");
}

function getFileProgress() {
  if (!state.activeFileId) return { cards: {}, days: {} };
  if (!state.progress.byFile[state.activeFileId]) {
    state.progress.byFile[state.activeFileId] = { cards: {}, days: {} };
  }
  return state.progress.byFile[state.activeFileId];
}

function getCardProgress(cardId) {
  return getFileProgress().cards[String(cardId)];
}

function loadProgress() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
    return {
      byFile: parsed.byFile || {},
    };
  } catch {
    return { byFile: {} };
  }
}

function saveProgress() {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(state.progress));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getTodayCount() {
  return getFileProgress().days[todayKey()] || 0;
}

function bumpTodayCount() {
  const key = todayKey();
  const fp = getFileProgress();
  fp.days[key] = (fp.days[key] || 0) + 1;
  state.studiedToday = fp.days[key];
}

function clearCardDetails() {
  els.cardType.textContent = "-";
  els.cardDeck.textContent = "-";
  els.cardTags.textContent = "-";
}

function setLoading(isLoading, label = "Загрузить .apkg") {
  els.pickFileBtn.disabled = isLoading;
  els.pickFileBtn.querySelector("span").textContent = label;
}

function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 3600);
}

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function firstRow(db, sql) {
  return allRows(db, sql)[0];
}

function allRows(db, sql) {
  const result = db.exec(sql)[0];
  if (!result) return [];
  return result.values.map((row) =>
    Object.fromEntries(result.columns.map((column, index) => [column, row[index]])),
  );
}

function getFieldNames(model, fallbackCount) {
  if (!model?.flds?.length) {
    return Array.from({ length: Math.max(fallbackCount, 2) }, (_item, index) =>
      index === 0 ? "Front" : index === 1 ? "Back" : `Field ${index + 1}`,
    );
  }

  return [...model.flds]
    .sort((a, b) => Number(a.ord || 0) - Number(b.ord || 0))
    .map((field) => field.name);
}

function getTemplate(model, ord) {
  if (!model?.tmpls?.length) return null;
  return [...model.tmpls].sort((a, b) => Number(a.ord || 0) - Number(b.ord || 0))[ord];
}

function cleanDeckName(name) {
  return String(name || "Колода").replace(/::/g, " / ");
}

function normalizeTags(tags) {
  return String(tags || "").trim().replace(/\s+/g, " ");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pluralRu(count, forms) {
  const value = Math.abs(Number(count));
  const lastTwo = value % 100;
  const last = value % 10;

  if (lastTwo >= 11 && lastTwo <= 14) return `${count} ${forms[2]}`;
  if (last === 1) return `${count} ${forms[0]}`;
  if (last >= 2 && last <= 4) return `${count} ${forms[1]}`;
  return `${count} ${forms[2]}`;
}

async function pasteFromClipboard() {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (type === "application/zip" || type === "application/octet-stream" || type === "" || type.startsWith("image/")) {
          const blob = await item.getType(type);
          const file = new File([blob], "clipboard.apkg", { type: blob.type });
          await importFile(file);
          return;
        }
      }
    }
    showToast("В буфере обмена нет файла .apkg");
  } catch {
    showToast("Не удалось прочитать буфер. Попробуйте Ctrl+V или выберите файл.");
  }
}

function getFileFromPasteEvent(event) {
  const items = event.clipboardData?.items;
  if (!items) return null;
  for (const item of items) {
    if (item.kind === "file") {
      return item.getAsFile();
    }
  }
  return null;
}

function getFileFromDropEvent(event) {
  const files = event.dataTransfer?.files;
  if (!files || !files.length) return null;
  return files[0];
}

function fixIosFileAccept() {
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIOS) {
    els.fileInput.removeAttribute("accept");
  }
}
