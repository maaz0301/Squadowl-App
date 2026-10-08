# Building SquadOwl for Google Play

Google Play only accepts an Android App Bundle (`.aab`) signed with your **upload key**. The project now
reads that key from outside git, so the key and its passwords are never committed.

## One time: create the upload key

Run this once, on your own machine, and keep the file somewhere safe and backed up (a password manager
vault or encrypted drive). **If you lose the key you can ask Google to reset it, but only if you enrolled in
Play App Signing (below).**

```bash
keytool -genkeypair -v -storetype JKS -keyalg RSA -keysize 2048 -validity 10000 \
  -keystore squadowl-upload.jks -alias squadowl-upload
```

Then copy `android/keystore.properties.example` to `android/keystore.properties` and fill in the real
path and passwords. That file is ignored by git.

```properties
storeFile=/absolute/path/to/squadowl-upload.jks
storePassword=...
keyAlias=squadowl-upload
keyPassword=...
```

For CI, set these environment variables instead: `ANDROID_KEYSTORE_FILE`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

## Enroll in Play App Signing

In Play Console, create the app and accept **Play App Signing**. Google then holds the key that signs what
users install, and your upload key only proves uploads come from you. This is what makes a lost upload key
recoverable.

## Each release

1. Raise the version in `android/gradle.properties` (`APP_VERSION_CODE` must be higher than the last upload;
   `APP_VERSION_NAME` is the number users see). Or pass `-PAPP_VERSION_CODE=12 -PAPP_VERSION_NAME=1.1.0`.
2. Build the bundle:

   ```bash
   cd android && ./gradlew bundleRelease
   ```

   The file is `android/app/build/outputs/bundle/release/app-release.aab`.
3. Upload it to a Play Console track (Internal testing first).

## What the build enforces

- `bundleRelease` **refuses to build** unless an upload key is configured. That is deliberate: a bundle
  signed with the debug key is rejected by Play, and the debug key is public.
- `assembleRelease` (a local APK for trying the release build) still works without a key and is signed with
  the debug key, as before.
- Debug builds are unchanged.

## Before the first upload

- Confirm `android/app/google-services.json` is the **production** Firebase project (it is git ignored; each
  machine needs its own copy).
- Install the release build on a real Android device and check sign in, push notifications, file export, and
  photo upload. R8 shrinking is on in release, and it can break libraries that Debug builds do not exercise.
- Upload the R8 mapping file (`android/app/build/outputs/mapping/release/mapping.txt`) with each release so
  crash reports are readable.
