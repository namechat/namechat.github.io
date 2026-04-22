import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  child,
  get,
  getDatabase,
  off,
  onValue,
  push,
  ref,
  runTransaction,
  serverTimestamp,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

const CONFIG_KEY = "namechat.firebaseConfig";

const setupView = document.querySelector("#setupView");
const accountView = document.querySelector("#accountView");
const chatView = document.querySelector("#chatView");
const configForm = document.querySelector("#configForm");
const firebaseConfig = document.querySelector("#firebaseConfig");
const usernameForm = document.querySelector("#usernameForm");
const usernameInput = document.querySelector("#usernameInput");
const currentUsername = document.querySelector("#currentUsername");
const threadForm = document.querySelector("#threadForm");
const friendUsername = document.querySelector("#friendUsername");
const threadList = document.querySelector("#threadList");
const conversationTitle = document.querySelector("#conversationTitle");
const messages = document.querySelector("#messages");
const messageForm = document.querySelector("#messageForm");
const messageInput = document.querySelector("#messageInput");
const sendButton = document.querySelector("#sendButton");
const signOutButton = document.querySelector("#signOutButton");
const toast = document.querySelector("#toast");

let app;
let auth;
let db;
let me = null;
let activeThread = null;
let threadListenerRef = null;
let messagesListenerRef = null;
let toastTimer = null;

configForm.addEventListener("submit", (event) => {
  event.preventDefault();

  try {
    const config = normalizeFirebaseConfig(parseFirebaseConfig(firebaseConfig.value));
    requireConfigKeys(config);
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    boot(config);
  } catch (error) {
    showToast(error.message || "That Firebase config could not be read.");
  }
});

usernameForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const username = normalizeUsername(usernameInput.value);
  if (!username) {
    showToast("Use 3 to 24 letters, numbers, underscores, or dots.");
    return;
  }

  setBusy(usernameForm, true);
  try {
    await claimUsername(username);
    await loadProfile(auth.currentUser.uid);
    showChat();
    listenForThreads();
  } catch (error) {
    showToast(error.message || "Could not create that username.");
  } finally {
    setBusy(usernameForm, false);
  }
});

threadForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const username = normalizeUsername(friendUsername.value);
  if (!username) {
    showToast("Enter your friend's username.");
    return;
  }
  if (username === me.username) {
    showToast("That is your own username.");
    return;
  }

  setBusy(threadForm, true);
  try {
    const friend = await findUserByUsername(username);
    if (!friend) {
      showToast(`No user named ${username} yet.`);
      return;
    }
    const thread = await createOrGetThread(friend);
    friendUsername.value = "";
    openThread(thread);
  } catch (error) {
    showToast(error.message || "Could not start that chat.");
  } finally {
    setBusy(threadForm, false);
  }
});

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !activeThread) return;

  messageInput.value = "";
  sendButton.disabled = true;

  try {
    const messageRef = push(ref(db, `messages/${activeThread.id}`));
    const message = {
      createdAt: serverTimestamp(),
      senderId: me.uid,
      senderUsername: me.username,
      text,
    };

    await set(messageRef, message);
    await update(ref(db, `threads/${activeThread.id}`), {
      lastMessage: text,
      updatedAt: serverTimestamp(),
    });
    await update(ref(db), {
      [`userThreads/${me.uid}/${activeThread.id}/lastMessage`]: text,
      [`userThreads/${me.uid}/${activeThread.id}/updatedAt`]: serverTimestamp(),
      [`userThreads/${getFriendId(activeThread)}/${activeThread.id}/lastMessage`]: text,
      [`userThreads/${getFriendId(activeThread)}/${activeThread.id}/updatedAt`]: serverTimestamp(),
    });
  } catch (error) {
    messageInput.value = text;
    showToast(error.message || "Message could not be sent.");
  } finally {
    sendButton.disabled = !messageInput.value.trim();
  }
});

messageInput.addEventListener("input", () => {
  sendButton.disabled = !messageInput.value.trim() || !activeThread;
});

signOutButton.addEventListener("click", async () => {
  await signOut(auth);
  window.location.reload();
});

bootFromStorage();

function bootFromStorage() {
  if (window.NAMECHAT_FIREBASE_CONFIG) {
    boot(normalizeFirebaseConfig(window.NAMECHAT_FIREBASE_CONFIG));
    return;
  }

  const savedConfig = localStorage.getItem(CONFIG_KEY);
  if (!savedConfig) {
    showSetup();
    return;
  }

  try {
    boot(normalizeFirebaseConfig(JSON.parse(savedConfig)));
  } catch (error) {
    localStorage.removeItem(CONFIG_KEY);
    showSetup();
    showToast("Saved Firebase config was invalid. Paste it again.");
  }
}

function boot(config) {
  app = initializeApp(config);
  auth = getAuth(app);
  db = getDatabase(app);

  onAuthStateChanged(auth, async (user) => {
    try {
      if (!user) {
        await signInAnonymously(auth);
        return;
      }

      const hasProfile = await loadProfile(user.uid);
      if (hasProfile) {
        showChat();
        listenForThreads();
      } else {
        showAccount();
      }
    } catch (error) {
      showToast(error.message || "Could not connect to Firebase.");
    }
  });
}

function showSetup() {
  setupView.classList.remove("hidden");
  accountView.classList.add("hidden");
  chatView.classList.add("hidden");
}

function showAccount() {
  setupView.classList.add("hidden");
  accountView.classList.remove("hidden");
  chatView.classList.add("hidden");
  usernameInput.focus();
}

function showChat() {
  setupView.classList.add("hidden");
  accountView.classList.add("hidden");
  chatView.classList.remove("hidden");
  currentUsername.textContent = me.username;
}

async function loadProfile(uid) {
  const profile = await get(ref(db, `users/${uid}`));
  if (!profile.exists()) return false;

  me = { uid, ...profile.val() };
  return true;
}

async function claimUsername(username) {
  const user = auth.currentUser;
  if (!user) throw new Error("You are not signed in yet.");

  const usernameRef = ref(db, `usernames/${username}`);
  const result = await runTransaction(usernameRef, (current) => {
    if (current && current.uid !== user.uid) return;
    return {
      uid: user.uid,
      username,
      createdAt: current?.createdAt || serverTimestamp(),
    };
  });

  if (!result.committed) {
    throw new Error("That username is already taken.");
  }

  await set(ref(db, `users/${user.uid}`), {
    uid: user.uid,
    username,
    createdAt: serverTimestamp(),
  });
}

async function findUserByUsername(username) {
  const usernameSnap = await get(ref(db, `usernames/${username}`));
  if (!usernameSnap.exists()) return null;

  const uid = usernameSnap.val().uid;
  const userSnap = await get(ref(db, `users/${uid}`));
  if (!userSnap.exists()) return null;

  return { uid, ...userSnap.val() };
}

async function createOrGetThread(friend) {
  const members = [me.uid, friend.uid].sort();
  const id = members.join("_");
  const threadRef = ref(db, `threads/${id}`);
  const existing = await get(threadRef);

  if (!existing.exists()) {
    const thread = {
      id,
      members,
      memberMap: {
        [me.uid]: true,
        [friend.uid]: true,
      },
      usernames: {
        [me.uid]: me.username,
        [friend.uid]: friend.username,
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessage: "",
    };
    await set(threadRef, thread);
    await update(ref(db), {
      [`userThreads/${me.uid}/${id}`]: userThreadSummary(thread, friend.uid),
      [`userThreads/${friend.uid}/${id}`]: userThreadSummary(thread, me.uid),
    });
  }

  const threadSnap = await get(threadRef);
  return { id, ...threadSnap.val() };
}

function listenForThreads() {
  if (threadListenerRef) off(threadListenerRef);

  threadListenerRef = ref(db, `userThreads/${me.uid}`);
  onValue(
    threadListenerRef,
    (snapshot) => {
      const threads = Object.entries(snapshot.val() || {})
        .map(([id, thread]) => ({ id, ...thread }))
        .sort((a, b) => timestampMillis(b.updatedAt) - timestampMillis(a.updatedAt))
        .slice(0, 50);

      renderThreads(threads);

      if (activeThread) {
        const updated = threads.find((thread) => thread.id === activeThread.id);
        if (updated) activeThread = updated;
      }
    },
    (error) => showToast(error.message || "Could not load threads."),
  );
}

function renderThreads(threads) {
  threadList.innerHTML = "";

  if (!threads.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No chats yet.";
    threadList.append(empty);
    return;
  }

  for (const thread of threads) {
    const friendId = getFriendId(thread);
    const name = thread.usernames?.[friendId] || "Friend";
    const button = document.createElement("button");
    button.className = `thread-button ${activeThread?.id === thread.id ? "active" : ""}`;
    button.type = "button";
    button.innerHTML = `
      <strong>${escapeHtml(name)}</strong>
      <span>${escapeHtml(thread.lastMessage || "New thread")}</span>
    `;
    button.addEventListener("click", () => openThread(thread));
    threadList.append(button);
  }
}

function openThread(thread) {
  activeThread = thread;
  const friendId = getFriendId(thread);
  conversationTitle.textContent = thread.usernames?.[friendId] || "Friend";
  messageInput.disabled = false;
  sendButton.disabled = !messageInput.value.trim();
  messageInput.focus();

  if (messagesListenerRef) off(messagesListenerRef);

  messagesListenerRef = ref(db, `messages/${thread.id}`);
  onValue(
    messagesListenerRef,
    (snapshot) => {
      const items = Object.entries(snapshot.val() || {})
        .map(([id, message]) => ({ id, ...message }))
        .sort((a, b) => timestampMillis(a.createdAt) - timestampMillis(b.createdAt))
        .slice(-200);
      renderMessages(items);
    },
    (error) => showToast(error.message || "Could not load messages."),
  );
}

function renderMessages(items) {
  messages.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No messages yet. Say hi.";
    messages.append(empty);
    return;
  }

  for (const item of items) {
    const bubble = document.createElement("article");
    bubble.className = `message ${item.senderId === me.uid ? "mine" : "theirs"}`;

    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.textContent = item.senderUsername || "Unknown";

    const text = document.createElement("div");
    text.className = "message-text";
    text.textContent = item.text;

    bubble.append(meta, text);
    messages.append(bubble);
  }

  messages.scrollTop = messages.scrollHeight;
}

function requireConfigKeys(config) {
  const required = ["apiKey", "authDomain", "projectId", "appId", "databaseURL"];
  const missing = required.filter((key) => !config[key]);
  if (missing.length) {
    throw new Error(`Missing Firebase config value: ${missing.join(", ")}`);
  }
}

function normalizeFirebaseConfig(config) {
  if (config.databaseURL) return config;
  return {
    ...config,
    databaseURL: `https://${config.projectId}-default-rtdb.firebaseio.com`,
  };
}

function parseFirebaseConfig(value) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Paste your Firebase config first.");

  try {
    return JSON.parse(trimmed);
  } catch {
    const objectMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!objectMatch) throw new Error("Could not find a Firebase config object.");

    const asJson = objectMatch[0]
      .replace(/([{,]\s*)([a-zA-Z_$][\w$]*)(\s*:)/g, '$1"$2"$3')
      .replace(/,\s*}/g, "}");

    return JSON.parse(asJson);
  }
}

function normalizeUsername(value) {
  const username = value.trim().toLowerCase();
  return /^[a-z0-9._]{3,24}$/.test(username) ? username : "";
}

function setBusy(form, busy) {
  for (const element of form.elements) {
    element.disabled = busy;
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 4200);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[character];
  });
}

function timestampMillis(timestamp) {
  return Number(timestamp) || 0;
}

function getFriendId(thread) {
  return thread.friendId || thread.members.find((uid) => uid !== me.uid);
}

function userThreadSummary(thread, friendId) {
  return {
    id: thread.id,
    friendId,
    members: thread.members,
    usernames: thread.usernames,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastMessage: "",
  };
}
