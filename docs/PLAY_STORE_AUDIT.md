# SquadOwl Android: Google Play Compliance Audit

Prepared 8 Oct 2026 from the Android project in this repository (`com.aastryout`, branch `bare/feat/setup`).
This is a code and configuration audit. It reports what the project declares and does today. Items marked
**Verify** could not be confirmed from the code and need a human answer before they go into Play Console.

---

## 1. Summary

| Area | Status | Note |
|---|---|---|
| Target API level | Pass | `targetSdk` 36, `compileSdk` 36, `minSdk` 24 |
| Release signing | Done in code, needs your key | Release builds use a real upload key from `android/keystore.properties` or env vars, and `bundleRelease` refuses to build without it. See `docs/ANDROID_RELEASE.md`. |
| Privacy policy | Added, needs deploy and review | Pages `/privacy` and `/terms` and links in the app and web were added 8 Oct 2026 (see 5.5) |
| Subscription payments | **High risk** | Plans are bought through Stripe in an in-app browser, not Google Play Billing |
| User generated content | **High risk** | Chat, comments and photos exist, but no report or block mechanism was found |
| Children and minors | Needs a declaration | Athletes include minors; data is entered by adults |
| Account deletion | Partial | In-app deletion exists; Play also wants a public web URL for it |
| Permissions | Pass with cleanup | Two legacy storage permissions arrive from a library and should be removed |
| Data safety form | Needs preparation | Data inventory is in section 4 |
| Network security | Pass | Cleartext traffic is off in the release manifest |
| Backups | Pass | `allowBackup="false"` |

---

## 2. App and build facts

| Item | Value | Source |
|---|---|---|
| Package name | `com.aastryout` | `android/app/build.gradle` |
| Version | `versionCode 1`, `versionName "1.0"` | `android/app/build.gradle` |
| minSdk / targetSdk / compileSdk | 24 / 36 / 36 | `android/build.gradle` |
| Framework | React Native 0.85.3, Hermes on, New Architecture on | `package.json`, `gradle.properties` |
| Shrinking | R8 and resource shrinking on for release | `build.gradle` |
| Launcher activity | `MainActivity`, exported, custom scheme `aastryout://` | manifest |
| Cleartext traffic | `false` in the merged release manifest | merged manifest |
| Push | Firebase Cloud Messaging; `google-services.json` present | `ENVIRONMENT.md`, `android/app` |

---

## 3. Permissions

Declared by the app in `AndroidManifest.xml`:

| Permission | Why it is needed | Verdict |
|---|---|---|
| `INTERNET` | Talks to the Supabase backend | Required |
| `POST_NOTIFICATIONS` | Event reminders, chat and RSVP notifications (Android 13+ runtime prompt, requested by `FCMManager`) | Justified |

Added automatically by libraries (merged release manifest):

| Permission | Source | Verdict |
|---|---|---|
| `ACCESS_NETWORK_STATE`, `WAKE_LOCK`, `com.google.android.c2dm.permission.RECEIVE` | Firebase Messaging | Normal, no disclosure needed |
| `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE` | `react-native-fs` (exports and files) | **Remove.** They do nothing on targetSdk 36 and attract review questions. Add `<uses-permission ... tools:node="remove"/>` for both. |

Not declared, good: camera, microphone, location, contacts, SMS, call log, `READ_MEDIA_*`, `MANAGE_EXTERNAL_STORAGE`,
`QUERY_ALL_PACKAGES`, advertising ID.

Photo selection (profile photo, feedback attachment) uses `react-native-image-picker`, which on current Android uses the system photo
picker and needs no storage permission.

`<queries>` entries (PDF, XLSX and CSV viewers, `https`, `geo`) are used so export "open with", Directions and Add to calendar links
can resolve apps. All are narrow and justified in the manifest comments.

**Unused dependency to confirm:** `react-native-vision-camera` is in `package.json` but no source file imports it. Remove it if it is
unused, so no camera permission or library ever reaches the release.

---

## 4. Data safety inventory (for the Data safety form)

Collected and stored in Supabase (Postgres). All traffic is HTTPS to Supabase, Stripe and Firebase.

| Data | Whose | Purpose | Shared with |
|---|---|---|---|
| Name, email, password hash | Coaches, parents | Account and sign in | Supabase (processor) |
| Phone number | Parents, players | Contact and invites | Supabase |
| Date of birth, jersey number, position | Athletes, including minors | Rosters and evaluations | Supabase |
| Medical information (free text) | Athletes, including minors | Coach safety information | Supabase |
| Photos (profile, team logo, event files) | Users | Profiles and event notes | Supabase Storage |
| Evaluation scores, notes, videos | Athletes | Core feature | Supabase |
| Chat messages, comments, RSVPs | Users | Team communication | Supabase |
| Push token | Device | Notifications | Firebase (Google) |
| Payment data | Coaches and parents | Plan and fee payments | **Stripe only. Card data never touches the app or the database.** Stripe customer and subscription ids are stored. |
| Email delivery content | Users | Invites and reminders | Resend or SendGrid (email processors) |
| AI request text | Coaches | Only when a coach runs an AI feature. **Summary and compare** send athlete name, position, evaluation scores, evaluator name and the coach's written strengths and improvement comments. **Team builder** sends each athlete's name, position, year of birth, friend-group names and ranking scores, plus the coach's instruction. **Team builder rules** sends only the instruction, the list of position labels and a player count. Contact details, medical notes, full dates of birth and payment data are never sent (checked in `generate-ai-insights`, 8 Oct 2026). | Anthropic, via a Supabase Edge Function |

Suggested form answers:
- Data collected: Yes. Personal info (name, email, phone, DOB), Health info (medical notes), Photos and videos, Messages, App activity, Device or other ids (push token), Financial info (via Stripe only).
- Data shared with third parties: processors listed above act on the developer's behalf, so they are normally declared as "service providers", not "sold" or "shared for advertising".
- Encrypted in transit: Yes. Users can request deletion: Yes (see section 6).
- No advertising, no analytics SDK and no ad id were found in the dependencies. **Verify** nothing is added at release time.

---

## 5. Policy review

### 5.1 Payments (High risk)
Subscription plans (Coach, Coach+, Club) are bought by opening a Stripe Checkout page in an in-app browser
(`upgrade.tsx`, `react-native-inappbrowser-reborn`). Google Play requires Play Billing for digital features and subscriptions that are
consumed in the app, unless an exemption applies. Registration fees and team fees paid to a club (Stripe Connect) are payments for
real world services and are generally outside Play Billing. The plan subscriptions are the exposure.

Options, in order of safety:
1. Do not sell plans inside the Android app. Show plan status only and send users to the website to subscribe, without in-app links or
   price steering that Play treats as an external offer.
2. Implement Google Play Billing for the plan tiers on Android.
3. Apply for an alternative billing or external offers program where it is available to the developer's region. **Verify** eligibility.

### 5.2 User generated content (High risk)
Team chat, event comments, feed posts and photo or file attachments are user generated. Play's UGC policy requires:
a way to report content, a way to block abusive users, moderation rules in the terms, and removal of violating content. No report
or block feature was found in `TeamChat.tsx`, `EventDiscussion.tsx` or the feed. Add: a report action on messages and comments, a
block or mute option, a contact address for abuse, and a terms clause. Chat is limited to a team's own roster and guardians, which
helps, but the review team still expects the controls.

### 5.3 Children and minors
The app stores data about minors (athletes), entered by coaches and parents. It is not designed for children and has no child
sign up path found. Recommended answers: target audience is adults (coaches, club staff, parents); the app is not designed for
children; do not opt into Designed for Families. Because medical and date of birth data about minors is stored, the privacy policy
must explain who may enter it, parental responsibility and deletion. **Verify** that players cannot self register under 13.

### 5.4 Account deletion
In-app deletion exists (Profile, "Delete Account"). Play also requires a public web page where a user can request deletion without
installing the app, and that URL goes in the Data safety form. No such page was found in the web app. Add one, for example
`/delete-account`, that explains how to delete in-app and how to request deletion by email, including what is retained.

### 5.5 Privacy policy and terms (added)
Added on 8 Oct 2026:
- Public pages `/privacy` and `/terms` on the web app (`tryouthq.ca`), readable without an account, with a "Deleting your account"
  section that gives the in-app steps and an email route that works without signing in (this is the deletion URL Play asks for:
  `https://tryouthq.ca/privacy#delete-account`).
- Links on the web sign in, sign up and Profile pages, and in the Android and iOS app on the sign in, sign up and Profile screens.
- The text covers the data in section 4, minors, processors, retention, deletion rights and contact (`support@tryouthq.ca`), plus
  UGC rules and a reporting route in the terms.

Still to do: deploy the web app so the URLs go live, have the owner or counsel review the text (retention periods, the operator
legal name, governing law and the 30 day response promises are drafted, not confirmed), and enter
`https://tryouthq.ca/privacy` in Play Console.

### 5.6 Health information
Free text medical notes are stored. This is not a regulated health app, but Play's Health apps declaration asks whether the app
handles health data. Answer that it stores user entered notes, is not a medical device and gives no diagnosis. Keep the privacy
policy specific about it.

### 5.7 Notifications and background behavior
Only `POST_NOTIFICATIONS` is declared. No foreground service, exact alarms, full screen intents or boot receivers were found, so
none of those declarations apply.

### 5.8 Deep links
`aastryout://` is a custom scheme on the exported main activity, used to return from Stripe checkout. No `https` app links are
declared, so no Digital Asset Links file is needed. If checkout is removed from Android (5.1, option 1) this filter can be dropped.

---

## 6. Release engineering

| Check | Finding | Action |
|---|---|---|
| Signing | `release` uses `signingConfigs.debug` | **Blocker.** Create an upload keystore, store it outside git, enroll in Play App Signing, set `signingConfigs.release`. |
| Version | `versionCode 1` | Increment per upload; automate in CI. |
| Bundle format | Play requires an Android App Bundle | Build with `./gradlew bundleRelease`. |
| 64-bit | Hermes and New Architecture, arm64 and x86_64 | Pass. |
| 16 KB page size | NDK 27 and RN 0.85 are compatible | **Verify** native libs from `nitro-modules` and `react-native-video` on a 16 KB emulator. |
| Obfuscation | R8 on | Upload the mapping file and test the release build; custom proguard rules may be needed for Firebase. |
| `google-services.json` | Present in the repo | Confirm it is the production Firebase project and that restricted API keys are used. |
| Server libraries in the app | `nodemailer`, `pg`, `bcryptjs`, `@sendgrid/mail`, `resend` are in the app's `package.json` | Appear unused by the client. Remove to cut size and review risk. **Verify** no server secret is bundled. |
| Secrets | Client uses only the Supabase URL and anon key | Pass. Service role and Stripe secrets live in Edge Function secrets. |

---

## 7. Action list

**Must fix before submission**
1. ~~Replace debug signing~~ Done in code (8 Oct 2026). You still create the upload key and enroll in Play App Signing; see `docs/ANDROID_RELEASE.md`.
2. ~~Publish a privacy policy URL~~ Done in code. Deploy it, review the text, and enter the URL in Play Console.
3. Decide the plan purchase approach on Android (5.1).
4. Add report and block controls for chat and comments (5.2).
5. Enter the deletion URL (`https://tryouthq.ca/privacy#delete-account`) in Play Console. A standalone `/delete-account` page is optional.
6. Remove `READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE` from the merged manifest.

**Should fix**
7. Remove `react-native-vision-camera` and the server only npm packages if unused.
8. ~~List exactly what each AI action sends to Anthropic~~ Done (section 4); the privacy policy now matches it.
9. Test on a 16 KB page size device.
10. Prepare store assets: screenshots, feature graphic, content rating questionnaire (answer for UGC, no violence, no gambling).

**Play Console answers (draft)**
- App category: Sports or Productivity. Target audience: 18 and over (adult users). Not for children.
- Ads: No. In-app purchases: depends on 5.1.
- Data safety: per section 4. Content rating: complete the IARC questionnaire with "users can interact" and "shares user generated content" set to Yes.
- Permissions declaration: none of the restricted permissions are used.

---

## 8. Evidence

All of the following were read for this audit: `android/app/src/main/AndroidManifest.xml`, `android/app/build.gradle`,
`android/build.gradle`, `android/gradle.properties`, the merged release manifest in `android/app/build`, `package.json`,
`ENVIRONMENT.md`, `stripe.md`, `src/screens/(app)/upgrade.tsx`, `src/screens/(app)/profile.tsx`, `src/lib/FCMManager.ts`,
`supabase/functions/` (function list and `generate-ai-insights`), and a repository search for privacy, terms, report and block
features. Nothing was run on a physical Android device for this report.
