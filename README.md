# NameChat

A GitHub Pages-friendly chat app where people create username-only accounts and start one-on-one chat threads by username.

## What it uses

- Static HTML, CSS, and JavaScript
- Firebase Anonymous Authentication for account sessions
- Firebase Realtime Database for usernames, threads, and live messages
- No email address required

## Firebase setup

1. Create a Firebase project at <https://console.firebase.google.com/>.
2. Add a Web app in Project settings.
3. Enable Authentication, then enable the Anonymous sign-in provider.
4. Create a Realtime Database. Do not create Firestore for this app.
5. Copy your Web app config into `firebase-config.js`.
6. Publish the rules from `database.rules.json` in Realtime Database Rules.

`firebase-config.js` should look like this after setup:

```js
window.NAMECHAT_FIREBASE_CONFIG = {
  apiKey: "your-api-key",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.firebaseio.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456",
};
```

Firebase web config is safe to include in a public static site. The Realtime Database rules are what protect your data.

## GitHub Pages deploy

1. Push these files to a GitHub repository.
2. Open the repository Settings.
3. Go to Pages.
4. Set the source to your branch and root folder.
5. Open the Pages URL and create your username.

Friends can open the same Pages URL, create their own usernames, and start a thread with your username.

## Local preview

Because this is a static app, you can preview it with any local static server:

```powershell
python -m http.server 5173
```

Then open <http://localhost:5173/>.
