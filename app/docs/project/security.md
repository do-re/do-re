# Security audit — 2026-11-27

Scope: the backend (`backend/src`), the HTTP API, the frontend (`frontend/src`, `frontend/public/sw.js`), the AWS template (`backend/template.yaml`), the development server and the dependencies. Done by Claude for Felix by reading the code, with a regression test for each fix (`backend/test/security.test.ts`, and tests marked `security_` elsewhere). Nothing is deployed, so nothing was tested against live AWS, and this is a code review, not a penetration test.

## Fixed

| # | Hole | Risk | Fix |
|---|---|---|---|
| 1 | **No limit on password guessing.** Login could be tried without end. | Account takeover by guessing. | 10 failed logins for one email within 15 minutes lock that email for 15 minutes (`429 RATE_LIMITED`). Unknown emails are locked the same way, so the lock reveals nothing. A correct login clears the count. |
| 2 | **Passwords could be one character long.** | Trivial guessing. | New passwords need at least 8 characters, checked by the server at sign-up and by the sign-up form (notes-for-felix F-10). |
| 3 | **Signing up with someone else's address.** An unverified account blocked its email for good, with a password chosen by whoever signed up first. | The real owner could not sign up; if they opened the emailed link, the account became active with the attacker's password. | Signing up again over an account that was never verified replaces its password and its link (not within a minute of the last email). Verified and suspended accounts are never replaced. |
| 4 | **Login told callers which emails have accounts**, by its answer and by how long it took. | Lists of members' emails. | The API answers an unknown email exactly like a wrong password, and spends the same password-hash time on it. |
| 5 | **Logging out did not end the session on the server.** The token kept working for up to 7 days. | A copied token outlived logout. | The client now calls `POST /auth/logout`. |
| 6 | **Any logged-in user could read any profile by ID.** | Usernames and pictures of people you were never matched with. | `GET /users/{id}` answers only for yourself and people you have a match with; otherwise `404`, as for an account that does not exist. |
| 7 | **The development server listened on every network interface**, with published demo and admin passwords. | Anyone on the same Wi-Fi could log in as the dev admin and read its data. | It now listens on `127.0.0.1` only. |
| 8 | **Push endpoints on any `*.google.com` host were accepted.** Some of those hosts run code written by anyone. | The server could be made to send requests to an attacker's endpoint. | Only Chrome's push hosts are accepted (`fcm.googleapis.com`, `jmt<number>.google.com`), with Mozilla's, Microsoft's and Apple's. |
| 9 | **No security headers on the site.** | Clickjacking; a browser guessing an uploaded picture's type; the confirmation token leaking in a `Referer` header. | A CloudFront response-headers policy: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security`, `Referrer-Policy: strict-origin-when-cross-origin`. API responses also send `nosniff`. |
| 10 | **Usernames could contain invisible and control characters.** | One user passing for another (or for "admin") on screen. | Control and formatting characters are refused. |
| 11 | **Album cover URLs from the music platform were not checked.** | A non-HTTPS or script URL reaching every client's page. | Only `https://` URLs are accepted. |
| 12 | **A malformed `%` escape in a URL caused a 500.** | Noise in the logs; an error path reachable by anyone. | It now matches no route (`404`). |
| 13 | **The email-sending permission covered every resource.** | Wider than needed if the function were misused. | Limited to this account's SES identities in the stack's region. |

## Checked and found sound

- **Passwords**: stored only as salted scrypt hashes; never logged.
- **Session and confirmation tokens**: 256 bits, stored only as SHA-256 hashes; confirmation links are single use and expire after 24 hours.
- **Authorization**: the user ID always comes from the session, never from the request. Chats, matches, reports, retracting a yes and every admin route check the caller on the server; the admin tab and link are display only.
- **Cross-site request forgery**: not applicable. The API uses a bearer token held in the tab's `sessionStorage`; there are no cookies.
- **Injection**: no SQL; DynamoDB keys are built from validated or server-generated values; every request body is validated; the app renders text through React and uses no `innerHTML`, `eval` or similar.
- **Uploads**: profile pictures are size-limited and their type is taken from the file's contents (SVG and HTML are refused); stored under unguessable names in a private bucket.
- **Open redirects**: the post-login redirect and the notification click target accept only paths inside the app.
- **Secrets**: none in the repository. The one secret (the push signing key) is read from SSM Parameter Store.
- **Logging**: errors are logged by name only, never with emails, tokens, passwords or message text.
- **Infrastructure**: both S3 buckets block public access and are read only by CloudFront; the API is throttled; Lambda permissions are scoped to the table, the picture prefix and the event topic.
- **Dependencies**: `npm audit` reports nothing for the frontend or for what ships in the backend. Six moderate advisories (`glob`, `minimatch`, denial of service) are in a development-only test library (`testcontainers`) and never reach Lambda; the offered fix is a breaking downgrade, so they were left.

## Not fixed: decisions for the team

| Risk | Why it is still there | Option |
|---|---|---|
| **Sign-up and the verification poll still reveal whether an email has an account** (`EMAIL_IN_USE`; `POST /accounts/verification-status`). OPEN-16. | The sign-up page's spec requires the "email in use" popup, and the page polls by email. | Poll with a one-time sign-up ID instead of the email, and show a neutral "check your email" for every sign-up. Changes the client. |
| **The login lock can be used to lock someone else out** for 15 minutes at a time by failing on purpose. | Inherent to per-email locking. | Lock per email and IP address, or add a CAPTCHA after a few failures. |
| **No limit on sign-ups**, beyond the API's overall throttle. Each sends one email. | Not built. | A per-IP limit in API Gateway or AWS WAF (WAF is not free). |
| **No Content-Security-Policy that restricts scripts.** | The Spotify player loads scripts and frames from several Spotify hosts; a policy written without testing it on the deployed site could silently break playback. | Add it after the first deploy, starting in report-only mode. |
| **The session token lives in `sessionStorage`**, so a script-injection bug would expose it. | No such bug was found; the alternative (cookies) needs CSRF defences and a same-site setup. | Revisit if the app starts rendering user-supplied HTML. |
| **Notification text shows the sender's name and a message preview**, which can appear on a locked screen. | Product choice (OPEN-17). | A setting to hide previews. |
| **Music data comes from two outside services** with no published terms for this use (OPEN-6). | Product choice. | — |
| **Admins see every user's email**, and an admin can make other admins. | Product choice (OPEN-18); actions are audited. | — |
| **No backups** of the table (point-in-time recovery is off). | Cost; not a confidentiality issue. | Turn on PITR before real use. |
