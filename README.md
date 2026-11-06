# APEX setup
1. Firebase Console: create a project; enable **Authentication > Email/Password**, **Firestore**, **Hosting**.
2. Paste your web-app config into `firebase-config.js`.
3. Authentication > Users > Add user: email `admin@apex.local` (username `admin` + LOGIN_DOMAIN), strong password.
4. Firestore: create collection `admin`, document ID = that user's UID, any field (e.g. `role: "admin"`). Rules only allow this UID.
5. Deploy: `npm i -g firebase-tools && firebase login && firebase init hosting firestore` (public dir = this folder, rules = firestore.rules) then `firebase deploy`.
6. Open the site, sign in, go to Settings and fill company + bank details, then Products > Add default sizes.
