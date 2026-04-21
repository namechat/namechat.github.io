import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const CONFIG_KEY = "threadly.firebaseConfig";

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
let unsubscribeThreads = null;
let unsubscribeMessages = null;
let toastTimer = null;

configForm.addEventListener("submit", (event) => {
  event.preventDefault();

  try {
    const config = JSON.parse(firebaseConfig.value.trim());
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
    await addDoc(collection(db, "threads", activeThread.id, "messages"), {
      createdAt: serverTimestamp(),
      senderId: me.uid,
      senderUsername: me.username,
      text,
    });
    await setDoc(
      doc(db, "threads", activeThread.id),
      {
        lastMessage: text,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
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
  if (window.THREADLY_FIREBASE_CONFIG) {
    boot(window.THREADLY_FIREBASE_CONFIG);
    return;
  }

  const savedConfig = localStorage.getItem(CONFIG_KEY);
  if (!savedConfig) {
    showSetup();
    return;
  }

  try {
    boot(JSON.parse(savedConfig));
  } catch (error) {
    localStorage.removeItem(CONFIG_KEY);
    showSetup();
    showToast("Saved Firebase config was invalid. Paste it again.");
  }
}

function boot(config) {
  app = initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);

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
  const profile = await getDoc(doc(db, "users", uid));
  if (!profile.exists()) return false;

  me = { uid, ...profile.data() };
  return true;
}

async function claimUsername(username) {
  const user = auth.currentUser;
  if (!user) throw new Error("You are not signed in yet.");

  const usernameRef = doc(db, "usernames", username);
  const userRef = doc(db, "users", user.uid);

  await runTransaction(db, async (transaction) => {
    const claimed = await transaction.get(usernameRef);
    if (claimed.exists() && claimed.data().uid !== user.uid) {
      throw new Error("That username is already taken.");
    }

    transaction.set(usernameRef, {
      uid: user.uid,
      username,
      createdAt: serverTimestamp(),
    });
    transaction.set(userRef, {
      uid: user.uid,
      username,
      usernameLower: username,
      createdAt: serverTimestamp(),
    });
  });
}

async function findUserByUsername(username) {
  const usernameSnap = await getDoc(doc(db, "usernames", username));
  if (!usernameSnap.exists()) return null;

  const userSnap = await getDoc(doc(db, "users", usernameSnap.data().uid));
  if (!userSnap.exists()) return null;

  return { uid: userSnap.id, ...userSnap.data() };
}

async function createOrGetThread(friend) {
  const members = [me.uid, friend.uid].sort();
  const id = members.join("_");
  const threadRef = doc(db, "threads", id);
  const now = serverTimestamp();

  await setDoc(
    threadRef,
    {
      id,
      members,
      usernames: {
        [me.uid]: me.username,
        [friend.uid]: friend.username,
      },
      updatedAt: now,
      createdAt: now,
      lastMessage: "",
    },
    { merge: true },
  );

  const threadSnap = await getDoc(threadRef);
  return { id, ...threadSnap.data() };
}

function listenForThreads() {
  unsubscribeThreads?.();

  const threadsQuery = query(
    collection(db, "threads"),
    where("members", "array-contains", me.uid),
    limit(50),
  );

  unsubscribeThreads = onSnapshot(
    threadsQuery,
    (snapshot) => {
      const threads = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .sort((a, b) => timestampMillis(b.updatedAt) - timestampMillis(a.updatedAt));
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
    const friendId = thread.members.find((uid) => uid !== me.uid);
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
  const friendId = thread.members.find((uid) => uid !== me.uid);
  conversationTitle.textContent = thread.usernames?.[friendId] || "Friend";
  messageInput.disabled = false;
  sendButton.disabled = !messageInput.value.trim();
  messageInput.focus();

  for (const button of threadList.querySelectorAll(".thread-button")) {
    button.classList.remove("active");
  }

  unsubscribeMessages?.();
  const messagesQuery = query(
    collection(db, "threads", thread.id, "messages"),
    orderBy("createdAt", "asc"),
    limit(200),
  );

  unsubscribeMessages = onSnapshot(
    messagesQuery,
    (snapshot) => renderMessages(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
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
  const required = ["apiKey", "authDomain", "projectId", "appId"];
  const missing = required.filter((key) => !config[key]);
  if (missing.length) {
    throw new Error(`Missing Firebase config value: ${missing.join(", ")}`);
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
  if (!timestamp) return 0;
  if (typeof timestamp.toMillis === "function") return timestamp.toMillis();
  return Number(timestamp) || 0;
}
