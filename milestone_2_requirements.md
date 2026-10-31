# Design Specification

## 1. Login / Account Creation

- Users should be able to log in to a pre-existing account by inputting the correct login credentials on the login screen.
- Users without a pre-existing account should be able to create a new account using the **Create a New Account** page.
- The login page should prompt the user for a username/email and password.
- The login page should compare the user's identity to the list of profiles.
- The login page should display an error message if the login credentials don't match an existing profile.
- The login page should redirect to the user's homepage if the credentials match an existing profile.
- The **Create a New Account** page should prompt the user for a username/email and password.
- The **Create a New Account** page should ask the user to verify the password entered.
- The **Create a New Account** page should create a blank account matching the input credentials.
- The **Create a New Account** page should display terms of service text describing a policy against fake accounts.

## 2. Home Page / Swiping

- The home page should have access to a library of songs.
- The matching algorithm should hold a collection of predefined song tags.
- A song should be displayed on the homepage at all times.
- The album cover of the song should be in the middle of the home page.
- The playtime of the song should be displayed at the bottom of the home page, indicating how long the song has been playing.
- A pause button should be on the home page to pause the current song.
- A play button should replace the pause button when a song is paused.
- Pressing the play button should resume the song from the timestamp at which it was paused.
- A supporting coloured background should be displayed behind the album cover of the song, occupying the entire home page.
- A like button should be displayed directly underneath the album cover, near the play/pause button.
- A song should be given tags when added to the application.
- Song tags should always accompany a song in the matching algorithm.
- By default, a song should play a sound preview when displayed on the home page.
- Users should be able to swipe left to skip the song preview.
- Upon skipping, the home page should generate a preview of a new song from the song library.
- Users should be able to swipe right to listen to the full song.
- The matching algorithm should record the pattern of tags that the user prefers, based on their music preferences.
- The matching algorithm should be able to calculate a percentage from 0% to 100% indicating how much two users' tag patterns match.
- The matching algorithm should match a user with the next-highest match among users who have been active in the past 72 hours.
- The matching algorithm should present the match to both matched users.
- When a match is presented, the user should be given the option to accept or reject it.
- If the user rejects the presented match, the matching algorithm should search for the next match found.
- The matching algorithm should create a chat interface between matched users if both users accept the match.

## 3. Safety / Security

- When a new account is created, a verification link should be sent to the inputted email address.
- When the new account link is clicked from the email, the user's account is verified.
- If the new account link from the email is not clicked, the user's new account cannot be accessed.
- If the new account link from the email is not clicked, the user's new account is flagged as unverified.
- Any unverified accounts should be deleted after 48 hours.
- Unverified accounts cannot receive matches.
- Users should receive an email requesting reverification if no account activity has been recorded in the three months since their last detected activity.
- If users receive a reverification request and do not click the link in the email within one week, their account is deleted.

## 4. Chat Messaging / Communication with Other Users

- When a user clicks into a chat from the list of chats page, the specific contents of that chat should be fetched.
- Chats on the list of chats page should be ordered by the time the last message was most recently sent or received, with chats with more recent activity at the top.
- When a chat is opened, the username of the profile the user is communicating with should be displayed at the top of the chat.
- When a chat is opened, a back button should be displayed to the left of the other profile's username.
- The back button within a chat should redirect the user to the list of chats page.
- When a chat is opened, a green dot should be displayed next to the username if the other user is online.
- When a chat is opened, messages from the other user should be left-aligned.
- When a chat is opened, messages from the other user should have a blue background overlay.
- When a chat is opened, the other user's profile picture should be displayed next to each set of messages sent within one minute.
- When a chat is opened, messages from the user should be right-aligned.
- When a chat is opened, messages from the user should have a blue background overlay.
- When a chat is opened, a rectangle with rounded edges (text bar) at the bottom of the screen should allow the user to input text.
- When a chat is opened, a button to the right of the text bar should allow users to send the inputted text.
- When a chat is opened, a report button should be displayed to the right of the other profile's username.
- When a user presses the report button, the chat should disappear from their list of chats.
- When a user presses the report button, the system should flag the reported chat.

## 5. UI / Design Choices

- The font should be readable.
- One font should be used for the entire app.
- The background colour should contrast with UI elements.
- A navigation bar should be present when viewing the home, profile, and list of chats pages.
- The navigation bar should allow users to navigate to the home, profile, or list of chats page.
