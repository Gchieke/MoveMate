# MoveMate — App Store & Google Play Listing

Bundle ID (both stores): `co.movemateapp.app`
Privacy policy URL: https://movemate-dfqj.onrender.com/privacy.html
Support URL: https://movemate-dfqj.onrender.com

## Apple App Store

- **Name:** MoveMate — Neighbor Moving Help (30 chars max — this is 30)
- **Subtitle:** Neighbors help neighbors move (30 chars max)
- **Category:** Lifestyle (primary), Social Networking (secondary)
- **Keywords:** moving,neighbors,move help,community,volunteer,moving day,neighborhood
- **Description:**

Moving day is better with neighbors. MoveMate lets you post a move-in or move-out
request to your neighborhood in seconds — date, what you need help with, and where.
Neighbors get an instant alert and can volunteer for the roles you need: lifting,
driving, packing, or just lending an extra pair of hands.

- Post move-in / move-out requests in under a minute
- Instant email alerts to your whole neighborhood
- Optional SMS alerts for urgent same-day moves
- Volunteer for specific roles on each move
- Private: exact addresses stay inside your neighborhood

Whether you're new on the block or saying goodbye to it, MoveMate turns moving
day into a block party.

- **Review notes for Apple:** The app requires creating a free account (email + password).
  Provide a demo account for the reviewer: create one before submitting and put the
  credentials in App Store Connect → App Review Information. No in-app purchases.
  Minimum age 13+.

## Google Play

- **Title:** MoveMate — Neighbor Moving Help
- **Short description (80 chars):** Post move requests, alert your neighborhood, get help on moving day.
- **Full description:** (same as App Store description above)
- **Category:** Lifestyle
- **Tags:** moving, neighbors, community, volunteer
- **Content rating:** Everyone (complete the IARC questionnaire in Play Console)

## Screenshots needed (both stores)

Capture on real devices or simulators at these sizes:
- iPhone 6.7" (1290×2796): 3–10 screenshots — feed, post-a-move form, move detail with volunteer roles, alerts settings
- iPhone 6.5" (1242×2688): same set (App Store requires both if supporting those sizes)
- Android phone (1080×1920 min): 2–8 screenshots
- Android 7" tablet / 10" tablet: optional but recommended

Tip: join the demo neighborhood, post a realistic sample move ("Moving in — Sat 10am, need 2 lifters + a truck"),
and screenshot the feed, the new-move alert email, and the volunteer view.

## Feature graphic (Google Play, required)

1024×500 PNG — MoveMate logo + tagline "Neighbors helping neighbors move" on the brand gradient (#4f46e5 → #7c3aed).

---

# George's launch checklist

## 1. Developer accounts (you do this — I can't enroll for you)
- [ ] **Apple Developer Program** — $99/year, enroll at developer.apple.com with your Apple ID.
  Individual enrollment needs identity verification (usually 1–2 days).
- [ ] **Google Play Console** — $25 one-time at play.google.com/console. Identity verification required.

## 2. Signing (one-time setup, then CI handles every build)
- [ ] Android: generate an upload keystore (command is in build-android.yml header),
  add the 4 `ANDROID_*` secrets to the GitHub repo. Next push to main → signed AAB artifact.
- [ ] iOS: in Apple Developer → Certificates, Identifiers & Profiles: create an App ID for
  `co.movemateapp.app`, a Distribution certificate, and an App Store provisioning profile.
  Add the 4 `APPLE_*` secrets to the GitHub repo. Next push to main → signed IPA artifact.

## 3. Store listings
- [ ] App Store Connect (appstoreconnect.apple.com): create the app, paste the listing above,
  upload screenshots + app icon (1024×1024, already generated in ios/App/App/Assets.xcassets).
- [ ] Play Console: create the app, complete the listing, content rating questionnaire,
  data safety form (declare: email, name, phone number if SMS opted in — collected, not shared),
  upload AAB to the **internal testing** track first.

## 4. Test & submit
- [ ] iOS: upload IPA → TestFlight → test on your phone → submit for review (1–3 days typical).
- [ ] Android: internal testing → promote to production → review (usually a few days for new developers).
- [ ] Keep the demo reviewer account active until both reviews pass.

## 5. After approval
- Point the privacy policy + support URLs at https://movemateapp.co once the site is on the domain.
- Every push to main rebuilds both apps — bump version in android/app/build.gradle
  (`versionCode`/`versionName`) and ios/App/App.xcodeproj for each store release.
