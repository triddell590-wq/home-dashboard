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
10. **Turn on Met Office warnings.** The Weather tab shows Met Office warnings, which a small job on GitHub fetches every hour. It needs a key to write to your database; you make it once.
   - In the Firebase console, click the gear icon next to **Project Overview**, choose **Project settings**, open the **Service accounts** tab, and click **Generate new private key**, then **Generate key**. A small file ending in `.json` downloads to your computer.
   - Open your repository on GitHub, then **Settings → Secrets and variables → Actions → New repository secret**. For **Name** type `FIREBASE_SERVICE_ACCOUNT`. Open the downloaded file in a text editor, select everything in it, and paste it into **Secret**. Click **Add secret**.
   - Delete the downloaded file from your computer (and empty the bin). The key now lives only in GitHub.
   - To fetch the warnings straight away, open the repository's **Actions** tab, choose **Met Office warnings**, then **Run workflow**. Until it has run once, the Weather tab says "Met Office warnings unavailable". Nothing else breaks while the key is missing; the job just skips with a note.

11. **Turn on morning reminders.** At 7am London time the app can send a notification to your phone on days with something on. You do a few one-time steps; menu names on these websites drift a little, so look for the closest match.
   - **a. The public push key.** In the Firebase console, open your project, click the gear icon next to **Project Overview**, choose **Project settings**, and open the **Cloud Messaging** tab. Check that **Firebase Cloud Messaging API (V1)** says *Enabled*. Further down, under **Web configuration**, find **Web Push certificates** and click **Generate key pair**. Copy the long key it shows (it starts with `B`) and send the key to Claude, who puts it in `js/config.js` and commits it. It is public, like the other settings in that file.
   - **b. The private key.** If you did step 10, the GitHub secret `FIREBASE_SERVICE_ACCOUNT` already exists, so skip this. Otherwise follow step 10's first three bullets (generate the key file, paste it into a new repository secret with that exact name, delete the file). Never paste it into a chat.
   - **c. A GitHub token that can only start this job.**
     - On github.com, click your picture (top right) → **Settings** → at the bottom of the left menu **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
     - **Token name:** `cron-job.org reminders`. For **Expiration** pick the longest offered, and put the expiry date in your calendar so you can renew it.
     - Under **Repository access** choose **Only select repositories**, then pick `home-dashboard`.
     - Under **Permissions** → **Repository permissions**, set **Actions** to **Read and write**. Leave everything else at *No access* (GitHub adds *Metadata: Read-only* by itself).
     - Click **Generate token** and copy it straight away; GitHub shows it only once.
   - **d. The hourly timer on cron-job.org (free).**
     - Sign up at cron-job.org, then click **Create cronjob**.
     - **Title:** `Home dashboard reminders`.
     - **URL:** `https://api.github.com/repos/triddell590-wq/home-dashboard/actions/workflows/notify.yml/dispatches`
     - **Execution schedule:** choose **Custom**, set minutes to `0` and every hour, every day, and set **Time zone** to `Europe/London`.
     - Open the **Advanced** tab. **Request method:** `POST`. Under **Headers** add `Authorization` with the value `Bearer ` followed by your token, and `Accept` with the value `application/vnd.github+json`. **Request body:** `{"ref":"main"}`
     - Save, then click **Test run**. A good answer is **204 No Content**, and a "Morning reminders" run appears in the repository's **Actions** tab.
   - **e. On each device.** On the iPhone, open the dashboard from its Home Screen icon (step 9) → **Settings** → **Reminders** → **Turn on reminders on this device** → **Allow**. On the Mac, do the same in the browser you use.
   - To check: on GitHub open **Actions** → **Morning reminders** → **Run workflow**, tick **Dry run**, and run it; the log shows today's reminder. Nothing is sent before 7am or after 9pm London time, and never twice in a day.

To check: sign in on your Mac, set your name in Settings, and open the app on your phone — the name is there.
