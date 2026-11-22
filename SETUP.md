# Setting up your dashboard online

You do this once, in this order. Firebase's menu names change from time to time, so the names below may differ slightly.

Until you finish, the app runs in test mode and shows "Test mode — nothing is saved". To look round in test mode, sign in as `test@example.com` with the password `test-only-password`. That is a throwaway login that only exists in test mode: it protects nothing, and it stops working once Firebase is connected.

1. **Create the Firebase project.** Go to the Firebase console (console.firebase.google.com), choose **Create a project**, name it, and when it asks about **Google Analytics**, switch it off.
2. **Add a web app.** On the project's home page choose the web icon (`</>`), give the app a name, and skip Firebase Hosting. Firebase then shows a `firebaseConfig` object. Copy the whole object into `js/config.js` as `FIREBASE_CONFIG`, like this, and ask Claude to commit it (these values are public identifiers, not secrets):
   ```js
   export const FIREBASE_CONFIG = {
     apiKey: "...",
     authDomain: "...",
     projectId: "...",
     storageBucket: "...",
     messagingSenderId: "...",
     appId: "...",
   };
   ```
3. **Turn on Email/Password sign-in.** In the left menu open **Build → Authentication**, choose **Get started**, open the **Sign-in method** tab, pick **Email/Password**, switch on the first toggle (not "Email link"), and **Save**.
4. **Create your user.** In Authentication, open the **Users** tab, choose **Add user**, and enter your email and a password.
5. **Publish the rules with your ID in them.**
   - In the **Users** tab, copy your **User UID** (a long string of letters and digits).
   - In `firestore.rules`, replace `REPLACE_WITH_YOUR_UID` with that UID. Keep the quotes around it.
   - Open **Build → Firestore Database**, choose **Create database**, pick the location **europe-west2 (London)**, and start in **production mode**. The location is permanent: it can't be changed later. Then open the **Rules** tab, paste in the whole of the edited `firestore.rules`, and choose **Publish**.
   - Ask Claude to commit the same edited `firestore.rules` file, because the automatic tests read it. The rules use `rules_version = '2'` and allow only your UID; everyone else, signed in or not, is turned away.
6. **Switch off sign-up.** In Authentication open **Settings → User actions** and turn off **Enable create (sign-up)**. Nobody else can then make an account.
7. **Allow your website address.** In Authentication open **Settings → Authorized domains**, choose **Add domain**, and enter `triddell590-wq.github.io`.

8. **Switch to the new settings.** Once Claude has committed and published the settings, open the app wherever you already use it and tap **Update** when it says "New version ready". (If it doesn't appear, go to Settings and choose **Check for update**.) The "Test mode" note goes away, and you sign in with the email and password from step 4.
9. **Put it on your phone.** Open `https://triddell590-wq.github.io/home-dashboard/` in Safari, tap **Share**, then **Add to Home Screen**. Open it from the new icon and sign in once.

To check: sign in on your Mac, set your name in Settings, and open the app on your phone — the name is there.
