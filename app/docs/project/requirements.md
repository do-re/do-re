# Project Requirements (traceability matrix)

**Sources:** requirement text is verbatim from `requirements.md` in the team repo (do-re/do-re, main). The verification category is from Appendix A of the team's Milestone 3 plan (Google Doc). The component column is `[DERIVED]` from the golden architecture and `architecture-stubs-v2.java`.

**Why this file matters:** the course grades Release partly on the **proportion of these requirements met** (course C-REQ-3). Every implementation change should name the IDs it satisfies (commit message, test name, `Satisfies:` line in Javadoc).

**Verification categories** (details in `testing.md`):
- **V** = Visual inspection (no code tests).
- **BB** = Black-box (manual, through the UI).
- **WB** = White-box (automated tests Claude writes, developers review; coverage targets apply).

IDs are stable. If a requirement is reworded, keep its ID. If one is removed, mark it `REMOVED`; don't renumber. ⚠ marks a requirement with an open conflict (see `open-issues.md`).

**✎ = proposed wording after the team decisions of 2026-11-11** (tags dropped, swipe/like behaviour, chat colours). The original text is kept in the note. Copy the ✎ wording into the repo's `requirements.md` so the graded list matches what is built (the course allows revising requirements before the final sprint).

## 1. Login / Account Creation

| ID | Requirement | Verify | Component(s) |
|---|---|---|---|
| R-ACC-01 | Users should be able to log in to a pre-existing account by inputting the correct login credentials on the login screen. | BB | LoginView, AccountController, AccountModel |
| R-ACC-02 | Users without a pre-existing account should be able to create a new account using the **Create a New Account** page. | BB | LoginView (link), CreateAccountView, AccountController |
| R-ACC-03 | The login page should prompt the user for a username/email and password. ⚠ OPEN-9 | BB | LoginView |
| R-ACC-04 | The login page should compare the user's identity to the list of profiles. | WB | AccountController.login, AccountModel.isValidLogin |
| R-ACC-05 | The login page should display an error message if the login credentials don't match an existing profile. | BB | LoginView |
| R-ACC-06 | The login page should redirect to the user's homepage if the credentials match an existing profile. | BB | LoginView, ViewController |
| R-ACC-07 | The **Create a New Account** page should prompt the user for a username/email and password. ⚠ OPEN-9 | BB | CreateAccountView |
| R-ACC-08 | The **Create a New Account** page should ask the user to verify the password entered. | BB | CreateAccountView, AccountController.createAccount |
| R-ACC-09 | The **Create a New Account** page should create a blank account matching the input credentials. | BB | AccountController, AccountModel.createAccount |
| R-ACC-10 | The **Create a New Account** page should display terms of service text describing a policy against fake accounts. | V | CreateAccountView |

## 2. Home Page / Swiping / Matching

| ID | Requirement | Verify | Component(s) |
|---|---|---|---|
| R-HOME-01 | The home page should have access to a library of songs. | BB | SongSuggestionModel (library file) |
| R-HOME-02 | **REMOVED** (tags dropped, OPEN-1). Was: "The matching algorithm should hold a collection of predefined song tags." | — | — |
| R-HOME-03 | A song should be displayed on the homepage at all times. | V | HomeView, SongController.getCurrentSong |
| R-HOME-04 | The album cover of the song should be in the middle of the home page. | V | HomeView |
| R-HOME-05 | The playtime of the song should be displayed at the bottom of the home page, indicating how long the song has been playing. | V | HomeView |
| R-HOME-06 | A pause button should be on the home page to pause the current song. | V | HomeView |
| R-HOME-07 | A play button should replace the pause button when a song is paused. | BB | HomeView.onPauseToggled |
| R-HOME-08 | Pressing the play button should resume the song from the timestamp at which it was paused. | BB | HomeView.onPauseToggled |
| R-HOME-09 | A supporting coloured background should be displayed behind the album cover of the song, occupying the entire home page. | V | HomeView |
| R-HOME-10 | A like button should be displayed directly underneath the album cover, near the play/pause button. | V | HomeView |
| R-HOME-11 | ✎ A song should be given its 7 Audio Features when added to the application. (Was: "…given tags…") | WB | Song rep invariant, SongSuggestionModel constructor |
| R-HOME-12 | ✎ A song's Audio Features should always accompany the song in the matching algorithm. (Was: "Song tags should always accompany…") | WB | Song, MusicTasteModel |
| R-HOME-13 | By default, a song should play a sound preview when displayed on the home page. | V | HomeView.displaySong |
| R-HOME-14 | Users should be able to swipe left to skip the song preview. | BB | HomeView.onSwipeLeft |
| R-HOME-15 | Upon skipping, the home page should generate a preview of a new song from the song library. | BB | SongController.submitFeedback, SongSuggestionModel |
| R-HOME-16 | ✎ Users should be able to swipe right to like the current song and move to a new song. (Was: "…swipe right to listen to the full song.") | BB | HomeView.onSwipeRight, SongController.submitFeedback |
| R-HOME-17 | ✎ The matching algorithm should record the user's music preferences as a 7-number Taste Vector, updated from the Audio Features of each song the user likes or skips. (Was: "…pattern of tags…") | WB | MusicTasteModel.recordListen |
| R-HOME-18 | ✎ The matching algorithm should be able to calculate a percentage from 0% to 100% indicating how closely two users' Taste Vectors match. (Was: "…tag patterns match.") | WB | MatchModel.compatibility |
| R-HOME-19 | The matching algorithm should match a user with the next-highest match among users who have been active in the past 72 hours. | WB | MatchModel.findMatch, MatchModel.updateUser |
| R-HOME-20 | The matching algorithm should present the match to both matched users. | BB | MatchController.getPendingMatches, MatchView |
| R-HOME-21 | When a match is presented, the user should be given the option to accept or reject it. | BB | MatchView |
| R-HOME-22 | If the user rejects the presented match, the matching algorithm should search for the next match found. | WB | MatchModel.recordDecision, MatchModel.findMatch |
| R-HOME-23 | The matching algorithm should create a chat interface between matched users if both users accept the match. ⚠ OPEN-4 | BB | MatchController.confirmMatch, ChatController.openChat |
| R-HOME-24 | ✎ NEW. A left arrow button to the left of the album cover and a right arrow button to its right should do the same as swiping left and swiping right. | BB | HomeView.onSwipeLeft, HomeView.onSwipeRight |
| R-HOME-25 | ✎ NEW. Pressing the like button should record the current song as liked without changing, pausing or restarting the song. | BB | HomeView.onLikePressed, SongController.markLiked |

## 3. Safety / Security

| ID | Requirement | Verify | Component(s) |
|---|---|---|---|
| R-SEC-01 | When a new account is created, a verification link should be sent to the inputted email address. | BB | AccountController.sendConfirmationEmail |
| R-SEC-02 | When the new account link is clicked from the email, the user's account is verified. | BB | AccountController.confirmEmail |
| R-SEC-03 | If the new account link from the email is not clicked, the user's new account cannot be accessed. | BB | AccountController.login (NOT_VERIFIED), LoginView error popup |

## 4. Chat Messaging / Communication with Other Users

| ID | Requirement | Verify | Component(s) |
|---|---|---|---|
| R-CHAT-01 | When a user clicks into a chat from the list of chats page, the specific contents of that chat should be fetched. | BB | MessageLogView, ChatView.openChat, ChatController.getHistory |
| R-CHAT-02 | Chats on the list of chats page should be ordered by the time the last message was most recently sent or received, with chats with more recent activity at the top. | BB | ChatModel.getChatsForUser, MessageLogView |
| R-CHAT-03 | When a chat is opened, the username of the profile the user is communicating with should be displayed at the top of the chat. | BB | ChatView |
| R-CHAT-04 | When a chat is opened, a back button should be displayed to the left of the other profile's username. | BB | ChatView |
| R-CHAT-05 | The back button within a chat should redirect the user to the list of chats page. | BB | ChatView.onClosePressed, ViewController |
| R-CHAT-06 | When a chat is opened, a green dot should be displayed next to the username if the other user is online. | BB | ChatView, ChatController.isUserOnline |
| R-CHAT-07 | When a chat is opened, messages from the other user should be left-aligned. | BB | ChatView.renderMessage |
| R-CHAT-08 | ✎ When a chat is opened, messages from the other user should have a grey background overlay. (Was: "…blue background overlay.") | BB | ChatView.renderMessage |
| R-CHAT-09 | When a chat is opened, the other user's profile picture should be displayed next to each set of messages sent within one minute. | BB | ChatView.startsNewGroup |
| R-CHAT-10 | When a chat is opened, messages from the user should be right-aligned. | BB | ChatView.renderMessage |
| R-CHAT-11 | When a chat is opened, messages from the user should have a blue background overlay. | BB | ChatView.renderMessage |
| R-CHAT-12 | When a chat is opened, a rectangle with rounded edges (text bar) at the bottom of the screen should allow the user to input text. | BB | ChatView |
| R-CHAT-13 | When a chat is opened, a button to the right of the text bar should allow users to send the inputted text. | BB | ChatView.onSendPressed |
| R-CHAT-14 | When a chat is opened, a report button should be displayed to the right of the other profile's username. | BB | ChatView |
| R-CHAT-15 | When a user presses the report button, the chat should disappear from their list of chats. | BB | ChatView.onReportPressed, ChatController.reportChat |
| R-CHAT-16 | When a user presses the report button, the system should flag the reported chat. | BB | ChatController.reportChat, ChatModel.flagChat |

## 5. UI / Design Choices

| ID | Requirement | Verify | Component(s) |
|---|---|---|---|
| R-UI-01 | The font should be readable. | V | all views |
| R-UI-02 | One font should be used for the entire app. | V | all views |
| R-UI-03 | The background colour should contrast with UI elements. | V | all views |
| R-UI-04 | A navigation bar should be present when viewing the home, profile, and list of chats pages. | V | BottomBarView, ViewController.requestView |
| R-UI-05 | The navigation bar should allow users to navigate to the home, profile, or list of chats page. | V | BottomBarView |

**Totals:** 58 active requirements (1 removed, 2 new): 13 Visual, 38 Black-box, 7 White-box.
