/*
 * Architecture Stubs — v2 (implementation starting point)
 *
 * Stubs for every component in docs/project/architecture.md. Each component has its
 * constructor (showing which other components it talks to) and the full header of every
 * request it can receive, with arguments, return values, preconditions (Requires) and
 * postconditions (Effects). No method has an implementation yet; every body throws
 * UnsupportedOperationException.
 *
 * Team decisions of 2026-11-11 are applied (tags dropped, swipe/like behaviour, Chosic
 * data, AWS Lambda + DynamoDB backend, web client); see docs/project/open-issues.md.
 * Deployment: server-side components are Java on AWS Lambda with DynamoDB. Lambda
 * instances share no memory, so all model state lives in DynamoDB and "atomic" below means
 * atomic across concurrent requests (DynamoDB conditional writes / transactions).
 * Client-side components (views, ViewController, client half of each controller) will be
 * React + TypeScript in the web app; their Java stubs here are the behaviour spec to port.
 *
 * v2 reconciles the Milestone 2 stubs (milestone-2-stubs.java, left unchanged) with the
 * golden architecture document, docs/project/requirements.md (requirement IDs in
 * "Satisfies:" lines) and docs/project/testing.md. Changes from v1 are marked "v2:".
 * Where the sources conflict, the stub follows the golden architecture and the conflict
 * is listed in docs/project/open-issues.md (OPEN-n). Do not resolve those silently.
 *
 * This file has no public top-level types, so it compiles under this file name.
 * Split each type into its own <TypeName>.java file (and make it public) once implementation begins.
 */

import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.Set;

// =====================================================================================
// Shared data types
// =====================================================================================

/**
 * The 7 externally gathered numbers describing a song (Spotify-style audio features,
 * taken from Chosic, which reports each as a score out of 100; stored here as score / 100).
 * Index order: VALENCE ("Happiness" on Chosic), DANCEABILITY, ENERGY, ACOUSTICNESS,
 * INSTRUMENTALNESS, LIVENESS, SPEECHINESS.
 *
 * v2: immutable (defensive copies) and normalized, so the Taste Vector proof in
 * docs/project/testing.md can rely on bounded inputs (OPEN-6, OPEN-15).
 *
 * Abstraction function: AF(values) = a song's position in 7-dimensional audio feature
 *   space, one normalized feature per index.
 * Rep invariant: values != null && values.length == SIZE &&
 *   every values[i] is finite and 0 <= values[i] <= 1.
 */
record AudioFeatures(double[] values) {
    static final int SIZE = 7;
    static final int VALENCE = 0;
    static final int DANCEABILITY = 1;
    static final int ENERGY = 2;
    static final int ACOUSTICNESS = 3;
    static final int INSTRUMENTALNESS = 4;
    static final int LIVENESS = 5;
    static final int SPEECHINESS = 6;

    AudioFeatures {
        values = values.clone();
    }

    @Override
    public double[] values() {
        return values.clone();
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof AudioFeatures other && Arrays.equals(values, other.values);
    }

    @Override
    public int hashCode() {
        return Arrays.hashCode(values);
    }
}

/**
 * A user's 7-long music taste profile, in the same space as AudioFeatures.
 *
 * v2: immutable, with the same bounds as AudioFeatures.
 *
 * Abstraction function: AF(values) = the point in audio feature space this user's
 *   listening history pulls toward.
 * Rep invariant: values != null && values.length == AudioFeatures.SIZE &&
 *   every values[i] is finite and 0 <= values[i] <= 1.
 */
record TasteVector(double[] values) {

    TasteVector {
        values = values.clone();
    }

    @Override
    public double[] values() {
        return values.clone();
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof TasteVector other && Arrays.equals(values, other.values);
    }

    @Override
    public int hashCode() {
        return Arrays.hashCode(values);
    }
}

/**
 * A playable song, one row of the song library file (exported from Chosic).
 *
 * Rep invariant: id is non-empty and unique; title and artist are non-empty;
 *   durationSeconds > 0; albumCoverUrl is non-empty; spotifyUri has the form
 *   "spotify:track:<id>"; features is non-null (R-HOME-11).
 * v2: tags removed (team decision, OPEN-1); added albumCoverUrl (R-HOME-04) and spotifyUri,
 * which the client's Spotify embed player uses for playback (OPEN-6).
 */
record Song(String id, String title, String artist, double durationSeconds,
            String albumCoverUrl, String spotifyUri, AudioFeatures features) {
}

/**
 * Public profile information for one account.
 * Note: profilePicture is a mutable array; do not modify an array obtained from a profile.
 */
record UserProfile(String userId, String username, byte[] profilePicture) {
}

/** How the user reacted to a song on the HomeView. */
enum Feedback { LIKE, SKIP }

/**
 * One listen of a song.
 * Rep invariant: 0 <= secondsListened <= song.durationSeconds().
 */
record ListeningEvent(Song song, Feedback feedback, double secondsListened, Instant time) {
}

/** One time-stamped chat message. */
record ChatMessage(String senderId, String text, Instant timestamp) {
}

/**
 * A conversation between two matched users.
 * Rep invariant: userA != userB; messages are in increasing timestamp order.
 * v2: messages is unmodifiable.
 */
record Chat(String chatId, String userA, String userB, List<ChatMessage> messages) {

    Chat {
        messages = List.copyOf(messages);
    }
}

/**
 * A proposed match between two users.
 * Rep invariant: userA != userB; 0 <= compatibilityPercent <= 100.
 * v2: carries the compatibility shown on MatchView ("XX.X% match", R-HOME-18).
 */
record Match(String matchId, String userA, String userB, double compatibilityPercent) {
}

/**
 * v2: what HomeView gets back after a swipe: the next song, plus a match to show if the
 * swipe reached the user's random match interval.
 */
record SwipeResult(Song nextSong, Optional<Match> offeredMatch) {
}

/** Every screen ViewController can open. */
enum ViewType { LOGIN, CREATE_ACCOUNT, HOME, PROFILE, MATCH, CHAT, MESSAGE_LOG }

/** Result of a login attempt. */
enum LoginResult { SUCCESS, WRONG_PASSWORD, NO_ACCOUNT, NOT_VERIFIED }

/** Result of an account creation attempt. v2: added INVALID_EMAIL and PASSWORDS_DO_NOT_MATCH (R-ACC-08). */
enum CreateAccountResult { PENDING_VERIFICATION, EMAIL_IN_USE, INVALID_EMAIL, PASSWORDS_DO_NOT_MATCH }

// =====================================================================================
// Account components
// =====================================================================================

/**
 * AccountModel: stores email / salted-password-hash combinations, unique user IDs, usernames
 * and profile pictures; validates logins and checks whether an email is already in use.
 * v2: passwords are never stored in plaintext; only a per-account random salt and the
 * hash of salt + password are stored (golden architecture, testing.md inspection item 6).
 * Resides on: server.
 * Communicates with: AccountController only.
 */
class AccountModel {

    /**
     * Checks whether an account already uses this email.
     *
     * Requires: email is non-null.
     * Effects: none.
     *
     * @param email the email to look up
     * @return true iff an account (active or not) exists with this email
     */
    boolean isEmailInUse(String email) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Checks whether an email/password combination is valid.
     *
     * Requires: email and password are non-null.
     * Effects: none.
     *
     * @param email    the submitted email
     * @param password the submitted password
     * @return true iff an account exists with this email and hashing password with that
     *         account's stored salt gives the stored hash
     */
    boolean isValidLogin(String email, String password) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Creates a new, not-yet-activated account and assigns it a unique ID.
     *
     * Requires: email and password are non-empty; isEmailInUse(email) is false.
     * Effects: generates a new random salt and stores the account as inactive with
     *          email, salt and hash(salt + password), and an empty username and no profile
     *          picture (a "blank account", R-ACC-09); afterwards isEmailInUse(email) is true
     *          and isActive(returned id) is false.
     *
     * @param email    the new account's email
     * @param password the new account's password
     * @return the new account's unique user ID, never used by any other account
     */
    String createAccount(String email, String password) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Marks an account as activated (email verified).
     *
     * Requires: userId belongs to an existing account.
     * Effects: isActive(userId) is true afterwards.
     *
     * @param userId the account to activate
     */
    void activateAccount(String userId) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: userId belongs to an existing account.
     * Effects: none.
     *
     * @param userId the account to check
     * @return true iff the account's email has been verified
     */
    boolean isActive(String userId) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: isEmailInUse(email) is true.
     * Effects: none.
     *
     * @param email an account's email
     * @return the unique user ID attached to this email
     */
    String getUserId(String email) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: userId belongs to an existing account; username is non-empty.
     * Effects: the account's stored username is replaced with username.
     *
     * @param userId   the account to update
     * @param username the new username
     */
    void setUsername(String userId, String username) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: userId belongs to an existing account; image is a non-empty image file.
     * Effects: the account's stored profile picture is replaced with image.
     *
     * @param userId the account to update
     * @param image  the new profile picture's bytes
     */
    void setProfilePicture(String userId, byte[] image) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: userId belongs to an existing account.
     * Effects: none.
     *
     * @param userId the account to look up
     * @return the account's current username and profile picture
     */
    UserProfile getProfile(String userId) {
        throw new UnsupportedOperationException("stub");
    }
}

/**
 * AccountController: handles every query and update to AccountModel on behalf of
 * LoginView and ProfileView, and sends confirmation emails for new accounts.
 * Resides on: client and server (v2, per the golden architecture: "All controllers perform API
 *   calls"). The client side (React + TypeScript) sends each request as an HTTPS API call; the server
 *   side (Java, AWS Lambda) handles it and calls the models.
 * Communicates with: AccountModel, LoginView, CreateAccountView (v2), ProfileView.
 */
class AccountController {
    private final AccountModel accountModel;

    AccountController(AccountModel accountModel) {
        this.accountModel = accountModel;
    }

    /**
     * Validates submitted login details (called when Enter is pressed on LoginView).
     * Satisfies: R-ACC-03, R-ACC-04.
     *
     * Requires: email and password are non-null.
     * Effects: none.
     *
     * @param email    the submitted email
     * @param password the submitted password
     * @return SUCCESS if valid and verified; NOT_VERIFIED if valid but unverified;
     *         WRONG_PASSWORD if the email exists but the password does not match;
     *         NO_ACCOUNT if no account uses the email
     */
    LoginResult login(String email, String password) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: email is non-null.
     * Effects: none.
     *
     * @param email the email to check
     * @return true iff an account already uses this email
     */
    boolean isEmailInUse(String email) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Creates an inactive account and sends a confirmation email containing a link.
     * v2: takes the confirmation password from the create-account page.
     * Satisfies: R-ACC-02, R-ACC-08, R-ACC-09, R-SEC-01.
     *
     * Requires: email, password and confirmPassword are non-null.
     * Effects: if email is well-formed, password is non-empty, password equals
     *          confirmPassword and the email is not in use, an inactive account is created
     *          in AccountModel and a confirmation email is sent to email; otherwise nothing
     *          changes.
     *
     * @param email           the submitted email
     * @param password        the submitted password
     * @param confirmPassword the password typed a second time
     * @return INVALID_EMAIL if email is not well-formed; otherwise PASSWORDS_DO_NOT_MATCH if
     *         password is empty or differs from confirmPassword; otherwise EMAIL_IN_USE if an
     *         account already uses email; otherwise PENDING_VERIFICATION
     */
    CreateAccountResult createAccount(String email, String password, String confirmPassword) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Sends an email containing a single-use confirmation link for an account.
     *
     * Requires: userId belongs to an existing, inactive account whose email is email.
     * Effects: one confirmation email is sent to email.
     *
     * @param email  the destination address
     * @param userId the account being confirmed
     */
    void sendConfirmationEmail(String email, String userId) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Handles a click on a confirmation link.
     * Satisfies: R-SEC-02.
     *
     * Requires: userId and token are non-null.
     * Effects: if token is the valid, unused token for userId, the account is activated
     *          and the token is consumed; otherwise nothing changes.
     *
     * @param userId the account named in the link
     * @param token  the token in the link
     * @return true iff the account was activated
     */
    boolean confirmEmail(String userId, String token) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: email belongs to an existing account.
     * Effects: none.
     *
     * @param email an account's email
     * @return true iff the account's email has been verified
     */
    boolean isVerified(String email) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: isEmailInUse(email) is true.
     * Effects: none.
     *
     * @param email an account's email
     * @return the account's unique user ID
     */
    String getUserId(String email) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: userId belongs to an existing account; newUsername is non-empty.
     * Effects: the username stored in AccountModel is replaced with newUsername.
     *
     * @param userId      the account to update
     * @param newUsername the new username
     */
    void updateUsername(String userId, String newUsername) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: userId belongs to an existing account; image is a non-empty image file.
     * Effects: the profile picture stored in AccountModel is replaced with image.
     *
     * @param userId the account to update
     * @param image  the uploaded image file's bytes
     */
    void updateProfilePicture(String userId, byte[] image) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: userId belongs to an existing account.
     * Effects: none.
     *
     * @param userId the account to look up
     * @return the account's username and profile picture
     */
    UserProfile getProfile(String userId) {
        throw new UnsupportedOperationException("stub");
    }
}

// =====================================================================================
// Views shared base
// =====================================================================================

/**
 * Common base for every view. Every view contains a BottomBarView.
 * Resides on: client (React + TypeScript web app; this Java stub is the behaviour spec).
 */
abstract class View {
    protected final BottomBarView bottomBar;
    protected final ViewController viewController;

    View(BottomBarView bottomBar, ViewController viewController) {
        this.bottomBar = bottomBar;
        this.viewController = viewController;
    }

    /**
     * Makes this view visible to the user.
     *
     * Requires: none.
     * Effects: this view and its bottom bar are shown; any other view is hidden.
     */
    abstract void show();
}

/**
 * LoginView: the "/login" page. Email box, password box and Enter (arrow) button, plus a
 * "Create an account" link to CreateAccountView. Errors appear as popups on this page.
 * v2 (team decision 2026-11-11, OPEN-3): account creation moved to its own page.
 * Resides on: client (React + TypeScript web app; this Java stub is the behaviour spec).
 * Communicates with: AccountController, ViewController.
 */
class LoginView extends View {
    private final AccountController accountController;

    LoginView(BottomBarView bottomBar, ViewController viewController,
              AccountController accountController) {
        super(bottomBar, viewController);
        this.accountController = accountController;
    }

    @Override
    void show() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: none.
     * Effects: none.
     *
     * @return the current contents of the email box
     */
    String getEmailInput() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: none.
     * Effects: none.
     *
     * @return the current contents of the password box
     */
    String getPasswordInput() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Handles a press of the Enter button (or the Enter key in either box): sends the email
     * and password to AccountController.
     * Satisfies: R-ACC-01, R-ACC-03, R-ACC-05, R-ACC-06, R-SEC-03.
     *
     * Requires: none.
     * Effects: disables the Enter button until the reply arrives; then on SUCCESS, tells
     *          ViewController the login succeeded (which opens HomeView); on NOT_VERIFIED,
     *          shows the "Account not verified, please try again" error popup with an OK
     *          button; on NO_ACCOUNT or WRONG_PASSWORD, shows an error popup "Email or
     *          password is incorrect" with an OK button. On any error the typed email is
     *          kept and the password box is cleared.
     */
    void onEnterPressed() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * v2: handles the "Create an account" link.
     * Satisfies: R-ACC-02.
     *
     * Requires: none.
     * Effects: asks ViewController for the CreateAccountView, passing the typed email (if
     *          any) so that page can pre-fill it.
     */
    void onCreateAccountLinkPressed() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Shows an error popup (a modal dialog) on the login page.
     *
     * Requires: message is non-empty.
     * Effects: displays a popup with message and an OK button that closes it; focus moves to
     *          the popup and returns to the page when it closes.
     *
     * @param message the error to display
     */
    void showErrorPopup(String message) {
        throw new UnsupportedOperationException("stub");
    }
}

/**
 * CreateAccountView: v2, the "/signup" page (team decision 2026-11-11, OPEN-3). Email box,
 * password box, confirm-password box, the terms-of-service text describing the policy
 * against fake accounts, a "Create account" button and a "Back to login" link. Errors and
 * the "check your email" confirmation appear as popups on this page.
 * Owner [DERIVED]: Gavin (owns LoginView).
 * Resides on: client (React + TypeScript web app; this Java stub is the behaviour spec).
 * Communicates with: AccountController, ViewController.
 */
class CreateAccountView extends View {
    private final AccountController accountController;

    CreateAccountView(BottomBarView bottomBar, ViewController viewController,
                      AccountController accountController) {
        super(bottomBar, viewController);
        this.accountController = accountController;
    }

    @Override
    void show() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Shows the page with every box empty except the email.
     * Satisfies: R-ACC-07, R-ACC-10.
     *
     * Requires: prefilledEmail is non-null (may be empty).
     * Effects: the email box contains prefilledEmail; the password and confirm-password boxes
     *          are empty; the terms-of-service text is visible.
     *
     * @param prefilledEmail the email typed on the login page, or "" if none
     */
    void showWithEmail(String prefilledEmail) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: none.
     * Effects: none.
     *
     * @return the current contents of the email box
     */
    String getEmailInput() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: none.
     * Effects: none.
     *
     * @return the current contents of the password box
     */
    String getPasswordInput() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: none.
     * Effects: none.
     *
     * @return the current contents of the confirm-password box
     */
    String getConfirmPasswordInput() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Handles the "Create account" button (or the Enter key in any box).
     * Satisfies: R-ACC-02, R-ACC-08, R-ACC-09, R-SEC-01.
     *
     * Requires: none.
     * Effects: disables the button until the reply arrives (so one press creates at most one
     *          account); sends the three boxes to AccountController.createAccount; then on
     *          PENDING_VERIFICATION, shows the verification popup; on INVALID_EMAIL,
     *          PASSWORDS_DO_NOT_MATCH or EMAIL_IN_USE, shows an error popup naming the problem.
     *          On any error the email is kept and both password boxes are cleared.
     */
    void onCreateAccountPressed() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Shows the "check your email" popup after an account is created.
     *
     * Requires: email is the address a confirmation email was just sent to.
     * Effects: displays a popup saying a verification link was sent to email, with a
     *          "Back to login" button; waits for verification as awaitEmailVerification
     *          describes.
     *
     * @param email the address awaiting verification
     */
    void showVerificationPopup(String email) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Waits until AccountController reports the account as verified.
     * Satisfies: R-SEC-02, R-SEC-03.
     *
     * Requires: email belongs to an account that is awaiting verification.
     * Effects: when verification succeeds, closes the popup and asks ViewController for the
     *          LoginView so the user can log in; returns early if the user closes the popup.
     *
     * @param email the address awaiting verification
     * @return true iff the account was verified
     */
    boolean awaitEmailVerification(String email) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Shows an error popup (a modal dialog) on the create-account page.
     *
     * Requires: message is non-empty.
     * Effects: displays a popup with message and an OK button that closes it; focus moves to
     *          the popup and returns to the page when it closes.
     *
     * @param message the error to display
     */
    void showErrorPopup(String message) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Handles the "Back to login" link.
     *
     * Requires: none.
     * Effects: asks ViewController for the LoginView.
     */
    void onBackToLoginPressed() {
        throw new UnsupportedOperationException("stub");
    }
}

/**
 * ProfileView: displays the username and profile picture; lets the user change both.
 * Resides on: client (React + TypeScript web app; this Java stub is the behaviour spec).
 * Communicates with: AccountController, ViewController (via BottomBarView).
 */
class ProfileView extends View {
    private final AccountController accountController;

    ProfileView(BottomBarView bottomBar, ViewController viewController,
                AccountController accountController) {
        super(bottomBar, viewController);
        this.accountController = accountController;
    }

    @Override
    void show() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: profile is non-null.
     * Effects: shows profile's username and profile picture.
     *
     * @param profile the logged-in user's profile
     */
    void displayProfile(UserProfile profile) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Handles a submission from the username-change box.
     *
     * Requires: newUsername is non-empty.
     * Effects: sends newUsername to AccountController and refreshes the displayed username.
     *
     * @param newUsername the username typed by the user
     */
    void onUsernameSubmitted(String newUsername) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Handles a press of the change-profile-picture button.
     *
     * Requires: none.
     * Effects: opens the popup prompting the user to upload an image file.
     */
    void onChangePicturePressed() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Handles an image uploaded through the popup.
     *
     * Requires: image is a non-empty image file.
     * Effects: sends image to AccountController (which stores it in AccountModel), closes
     *          the popup and refreshes the displayed picture.
     *
     * @param image the uploaded image file's bytes
     */
    void onImageUploaded(byte[] image) {
        throw new UnsupportedOperationException("stub");
    }
}

// =====================================================================================
// Song and taste components
// =====================================================================================

/**
 * MusicTasteModel: stores each user's latest 100 songs and their Audio Features, and
 * maintains each user's 7-long Taste Vector.
 * Resides on: server.
 * Communicates with: SongController.
 */
class MusicTasteModel {
    static final int HISTORY_SIZE = 100;
    /** v2: largest fraction of the distance a single listen may move the Taste Vector. */
    static final double MAX_STEP = 0.2;

    /**
     * Records one listen and folds it into the user's Taste Vector.
     *
     * Requires: userId belongs to an existing account; event is non-null.
     * Effects: event.song() is added as the most recent entry of the user's history; if the
     *          history then exceeds HISTORY_SIZE, the oldest entry is removed. With
     *          w = computeWeight(event), f = the song's Audio Features and t = the old Taste
     *          Vector, each entry of the new Taste Vector is clamp(t[i] + w * (f[i] - t[i]), 0, 1).
     *          v2: this bounded form replaces "add w * f", which can grow without limit; it
     *          moves the vector toward liked songs and away from skipped ones and keeps the
     *          TasteVector rep invariant (the property proved in testing.md, OPEN-15).
     * Satisfies: R-HOME-12, R-HOME-17.
     *
     * @param userId the listener
     * @param event  the song, like/skip, and time listened
     */
    void recordListen(String userId, ListeningEvent event) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Computes how strongly one listen should change a Taste Vector.
     *
     * Requires: event is non-null.
     * Effects: none.
     *
     * @param event the listen to weigh
     * @return a weight w with -MAX_STEP <= w <= MAX_STEP that increases with the fraction of
     *         the song listened to; w > 0 for LIKE, w <= 0 for SKIP
     */
    double computeWeight(ListeningEvent event) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: userId belongs to an existing account.
     * Effects: none.
     *
     * @param userId the user to look up
     * @return the user's listened songs, most recent first, at most HISTORY_SIZE long
     */
    List<Song> getRecentSongs(String userId) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: userId belongs to an existing account.
     * Effects: if the user has no Taste Vector yet, creates one with every entry 0.5
     *          (the centre of feature space; v2, an all-zero start biases matching).
     *
     * @param userId the user to look up
     * @return the user's current Taste Vector
     */
    TasteVector getTasteVector(String userId) {
        throw new UnsupportedOperationException("stub");
    }
}

/**
 * SongSuggestionModel: finds songs near a user's music taste and caches the next 5
 * suggestions when the app opens.
 * Resides on: server.
 * Communicates with: SongController.
 */
class SongSuggestionModel {
    static final int CACHE_SIZE = 5;
    private final List<Song> library;

    /**
     * v2: the song library, loaded from the song data file (Chosic CSV export) when the
     * backend starts (course C-TECH-2).
     * Satisfies: R-HOME-01, R-HOME-11.
     *
     * Requires: library has more than CACHE_SIZE songs; every song satisfies the Song rep
     *           invariant (so every song has its 7 Audio Features); song IDs are unique.
     * Effects: stores an unmodifiable copy of library.
     *
     * @param library every song the app can suggest
     */
    SongSuggestionModel(List<Song> library) {
        this.library = List.copyOf(library);
    }

    /**
     * v2.
     * Requires: none.
     * Effects: none.
     *
     * @return every song in the library (unmodifiable)
     */
    List<Song> getLibrary() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Fills the user's suggestion cache (called when the app opens).
     *
     * Requires: userId belongs to an existing account; taste is non-null.
     * Effects: the user's cache holds CACHE_SIZE songs near taste, replacing previous contents.
     *
     * @param userId the user
     * @param taste  the user's current Taste Vector
     */
    void preloadCache(String userId, TasteVector taste) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Returns the next suggested song.
     *
     * Requires: userId belongs to an existing account; taste is non-null.
     * Effects: removes the returned song from the user's cache and adds a new suggestion
     *          near taste so the cache stays at CACHE_SIZE.
     *
     * @param userId the user
     * @param taste  the user's current Taste Vector
     * @return a song the user has not been suggested in their recent history
     */
    Song nextSuggestion(String userId, TasteVector taste) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: taste is non-null; count > 0; exclude is non-null.
     * Effects: none.
     *
     * @param taste   the Taste Vector to search near
     * @param count   the number of songs wanted
     * @param exclude IDs of songs that must not be returned
     * @return up to count songs, none in exclude, ordered from closest to farthest from taste
     */
    List<Song> findNearest(TasteVector taste, int count, Set<String> exclude) {
        throw new UnsupportedOperationException("stub");
    }
}

/**
 * SongController: serves songs to HomeView, forwards like/skip and listen time to
 * MusicTasteModel, and passes Taste Vectors to SongSuggestionModel and MatchModel.
 * Resides on: client and server (v2, per the golden architecture: "All controllers perform API
 *   calls"). The client side (React + TypeScript) sends each request as an HTTPS API call; the server
 *   side (Java, AWS Lambda) handles it and calls the models.
 * Communicates with: HomeView, MusicTasteModel, SongSuggestionModel, MatchModel.
 */
class SongController {
    private final MusicTasteModel tasteModel;
    private final SongSuggestionModel suggestionModel;
    private final MatchModel matchModel;

    SongController(MusicTasteModel tasteModel, SongSuggestionModel suggestionModel,
                   MatchModel matchModel) {
        this.tasteModel = tasteModel;
        this.suggestionModel = suggestionModel;
        this.matchModel = matchModel;
    }

    /**
     * Prepares suggestions when the user opens the app.
     *
     * Requires: userId belongs to a logged-in user.
     * Effects: pulls the user's Taste Vector and asks SongSuggestionModel to preload its cache.
     *
     * @param userId the user
     */
    void onAppOpened(String userId) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: userId belongs to a logged-in user.
     * Effects: if no song is active, makes the next suggestion the active song.
     * Satisfies: R-HOME-03.
     *
     * @param userId the user
     * @return the song currently active for this user
     */
    Song getCurrentSong(String userId) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * v2: handles the like button. Records that the user likes the active song without
     * leaving it; playback continues. The like reaches the Taste Vector once, when the user
     * leaves the song (see submitFeedback).
     * Satisfies: R-HOME-25.
     *
     * Requires: userId belongs to a logged-in user; songId is the user's active song.
     * Effects: the active song is marked liked for this user (idempotent).
     *
     * @param userId the user
     * @param songId the active song
     */
    void markLiked(String userId, String songId) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Records the user's reaction to the active song and advances to the next one.
     * v2: also asks MatchModel whether this swipe triggers a match (the golden architecture's
     * SongController -> MatchModel path), so HomeView can open MatchView. Replaces v1's
     * MatchController.checkForMatch, which no client component could reach.
     * Satisfies: R-HOME-15, R-HOME-17, R-HOME-19.
     *
     * Requires: userId belongs to a logged-in user; songId is the user's active song;
     *           0 <= secondsListened <= that song's duration.
     * Effects: sends the listen to MusicTasteModel with feedback LIKE if swipe is LIKE or the
     *          song was marked liked, SKIP otherwise (so a song counts once); sends the updated
     *          Taste Vector and the current time to MatchModel.updateUser; increments the
     *          user's session swipe count; makes the next suggestion the active song.
     *
     * @param userId          the user
     * @param songId          the song reacted to
     * @param swipe           LIKE (swipe right or right arrow) or SKIP (swipe left or left arrow)
     * @param secondsListened how long the user listened before reacting
     * @return the new active song, and MatchModel.findMatch(userId, now) if
     *         MatchModel.shouldOfferMatch(userId, swipe count) is true (otherwise empty)
     */
    SwipeResult submitFeedback(String userId, String songId, Feedback swipe,
                               double secondsListened) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: userId belongs to an existing account.
     * Effects: none.
     *
     * @param userId the user
     * @return the user's current Taste Vector, pulled from MusicTasteModel
     */
    TasteVector getTasteVector(String userId) {
        throw new UnsupportedOperationException("stub");
    }
}

/**
 * HomeView: plays the active song with its time slider, pause button and like button.
 * Swipe left (or the left arrow button) skips; swipe right (or the right arrow button)
 * likes and moves on; the like button likes and keeps playing.
 * Layout (docs/assets/ui-sketch.png, tags removed): song name and artist at top; album
 * cover centred on a full-screen coloured background, with a left arrow button on its left
 * and a right arrow button on its right; slider under the cover with elapsed time; like
 * button directly under the cover next to play/pause. Playback uses the Spotify embed
 * player for song.spotifyUri (a preview for listeners not logged in to Spotify).
 * Resides on: client (React + TypeScript web app; this Java stub is the behaviour spec).
 * Communicates with: SongController, ViewController.
 */
class HomeView extends View {
    private final SongController songController;

    HomeView(BottomBarView bottomBar, ViewController viewController,
             SongController songController) {
        super(bottomBar, viewController);
        this.songController = songController;
    }

    @Override
    void show() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: song is non-null.
     * Effects: shows song's title, artist and album cover on the full-screen coloured
     *          background, resets the time slider and elapsed time to 0, shows the like
     *          button as not liked, and starts playing song.
     * Satisfies: R-HOME-03, R-HOME-04, R-HOME-05, R-HOME-09, R-HOME-13.
     *
     * @param song the song to display and play
     */
    void displaySong(Song song) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Handles a swipe left or a press of the left arrow button (skip).
     *
     * Requires: a song is displayed.
     * Effects: sends SKIP and the time listened to SongController (which still counts the
     *          song as liked if the like button was pressed) and displays the song it
     *          returns; if a match was offered, asks ViewController to open it.
     * Satisfies: R-HOME-14, R-HOME-15, R-HOME-24.
     */
    void onSwipeLeft() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Handles a swipe right or a press of the right arrow button (like and move on).
     *
     * Requires: a song is displayed.
     * Effects: sends LIKE and the time listened to SongController and displays the song
     *          it returns; if a match was offered, asks ViewController to open it.
     * Satisfies: R-HOME-16, R-HOME-24.
     */
    void onSwipeRight() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * v2: handles the like button (team decision, OPEN-2).
     *
     * Requires: a song is displayed.
     * Effects: asks SongController to mark the song liked and shows the like button as
     *          liked; the same song keeps playing without pausing or restarting.
     * Satisfies: R-HOME-10, R-HOME-25.
     */
    void onLikePressed() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: a song is displayed.
     * Effects: pauses playback if playing and shows the play button; if paused, resumes
     *          from the paused position and shows the pause button.
     * Satisfies: R-HOME-06, R-HOME-07, R-HOME-08.
     */
    void onPauseToggled() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: 0 <= seconds <= the displayed song's duration.
     * Effects: playback position becomes seconds.
     *
     * @param seconds the new playback position
     */
    void onSliderMoved(double seconds) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: a song is displayed.
     * Effects: none.
     *
     * @return total seconds of the displayed song actually played so far
     */
    double getSecondsListened() {
        throw new UnsupportedOperationException("stub");
    }
}

// =====================================================================================
// Match components
// =====================================================================================

/**
 * MatchModel: stores users in leaderboards according to Taste Vector metrics and
 * proposes matches at random swipe intervals.
 * v2 concurrency: many users swipe and decide at once, each request possibly in a
 * different Lambda instance, so every public method is atomic across concurrent requests.
 * State lives in DynamoDB; decisions use conditional writes / transactions, never an
 * in-memory lock. In particular, two users confirming the same match at the same moment
 * must produce exactly one "completed" result, so exactly one chat is created. This is the
 * project's main concurrency argument (course C-TECH-5).
 * Resides on: server.
 * Communicates with: MatchController, SongController, MusicTasteModel.
 */
class MatchModel {
    /** v2: only users active within this window are matched (R-HOME-19). */
    static final Duration ACTIVE_WINDOW = Duration.ofHours(72);

    /**
     * Inserts or updates a user's position in every leaderboard.
     * v2: also records when the user was last active.
     *
     * Requires: userId belongs to an existing account; taste and activeAt are non-null.
     * Effects: the user's leaderboard positions reflect taste; the user's last-active time
     *          becomes activeAt if later than the stored one.
     *
     * @param userId   the user
     * @param taste    the user's current Taste Vector
     * @param activeAt when the user last swiped
     */
    void updateUser(String userId, TasteVector taste, Instant activeAt) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: 0 <= metric < AudioFeatures.SIZE; limit > 0.
     * Effects: none.
     *
     * @param metric index of the Taste Vector entry this leaderboard ranks by
     * @param limit  maximum number of users to return
     * @return up to limit user IDs, highest value for that metric first
     */
    List<String> getLeaderboard(int metric, int limit) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * v2: matches proposed to this user that this user has not decided on yet. Lets the
     * other user of a match see it too (R-HOME-20).
     *
     * Requires: userId belongs to an existing account.
     * Effects: none.
     *
     * @param userId the user
     * @return every pending match involving userId that userId has not accepted or declined
     */
    List<Match> getPendingMatches(String userId) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Decides whether a match should be offered after this swipe.
     *
     * Requires: userId belongs to an existing account; swipeCount >= 0.
     * Effects: may advance the user's randomly chosen next-match swipe count.
     *
     * @param userId     the user
     * @param swipeCount number of swipes the user has made this session
     * @return true iff swipeCount has reached the user's randomly chosen interval
     */
    boolean shouldOfferMatch(String userId, int swipeCount) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * v2: how closely two users' tastes match, as shown on MatchView.
     * Satisfies: R-HOME-18.
     *
     * Requires: userA and userB are in the leaderboards.
     * Effects: none.
     *
     * @param userA one user
     * @param userB another user
     * @return a percentage in [0, 100]: 100 iff the two Taste Vectors are equal, decreasing
     *         as the Euclidean distance between them grows, symmetric in userA and userB
     */
    double compatibility(String userA, String userB) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Finds the next-highest match for a user.
     * Satisfies: R-HOME-19, R-HOME-22.
     *
     * Requires: userId belongs to an existing account; now is non-null.
     * Effects: the returned pair is recorded as proposed (pending both users' decisions).
     *
     * @param userId the user
     * @param now    the current time
     * @return a match with the other user of highest compatibility(userId, other) among users
     *         who were active within ACTIVE_WINDOW before now and with whom userId has no
     *         pending, confirmed or declined match; ties broken by user ID; empty if no user
     *         qualifies
     */
    Optional<Match> findMatch(String userId, Instant now) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Records one user's decision on a proposed match.
     *
     * Requires: match was returned by findMatch; userId is match.userA() or match.userB().
     * Effects: stores the decision atomically; a declined pair is never proposed again.
     *
     * v2: among concurrent calls on the same match, at most one returns true.
     *
     * @param match    the proposed match
     * @param userId   the deciding user
     * @param accepted true if confirmed, false if declined
     * @return true iff this call's confirmation completed the match (both users have now
     *         confirmed and the other user's confirmation came earlier)
     */
    boolean recordDecision(Match match, String userId, boolean accepted) {
        throw new UnsupportedOperationException("stub");
    }
}

/**
 * MatchController: referenced by MatchModel in the golden architecture but not described
 * there (OPEN-14). Serves pending matches to MatchView, records confirm/decline, and opens
 * a chat when both users confirm.
 * Resides on: client and server (v2, per the golden architecture: "All controllers perform API
 *   calls"). The client side (React + TypeScript) sends each request as an HTTPS API call; the server
 *   side (Java, AWS Lambda) handles it and calls the models.
 * Communicates with: MatchModel, MatchView, ChatController, AccountController.
 */
class MatchController {
    private final MatchModel matchModel;
    private final ChatController chatController;
    private final AccountController accountController;

    MatchController(MatchModel matchModel, ChatController chatController,
                    AccountController accountController) {
        this.matchModel = matchModel;
        this.chatController = chatController;
        this.accountController = accountController;
    }

    /**
     * v2: replaces checkForMatch (swipe-triggered matches now come back through
     * SongController.submitFeedback). Used when a user opens the app or HomeView, so the
     * second user of a match is shown it too.
     * Satisfies: R-HOME-20.
     *
     * Requires: userId belongs to a logged-in user.
     * Effects: none.
     *
     * @param userId the user
     * @return MatchModel.getPendingMatches(userId)
     */
    List<Match> getPendingMatches(String userId) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: userId is one of match's users.
     * Effects: none.
     *
     * @param match  the proposed match
     * @param userId the viewing user
     * @return the other user's username and profile picture
     */
    UserProfile getOtherProfile(Match match, String userId) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: userId is one of match's users.
     * Effects: records the confirmation in MatchModel; if that completed the match,
     *          creates exactly one chat between the two users through ChatController.
     * Satisfies: R-HOME-21, R-HOME-23.
     *
     * @param match  the proposed match
     * @param userId the confirming user
     * @return the ID of the chat for this match, or empty if the other user has not confirmed yet
     */
    Optional<String> confirmMatch(Match match, String userId) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: userId is one of match's users.
     * Effects: records the decline in MatchModel; the pair is never proposed again.
     *
     * @param match  the proposed match
     * @param userId the declining user
     */
    void declineMatch(Match match, String userId) {
        throw new UnsupportedOperationException("stub");
    }
}

/**
 * MatchView: displays two matched users' pictures and usernames with confirm and
 * decline buttons.
 * Resides on: client (React + TypeScript web app; this Java stub is the behaviour spec).
 * Communicates with: MatchController, ViewController.
 */
class MatchView extends View {
    private final MatchController matchController;

    MatchView(BottomBarView bottomBar, ViewController viewController,
              MatchController matchController) {
        super(bottomBar, viewController);
        this.matchController = matchController;
    }

    @Override
    void show() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: self and other are non-null and belong to the users in match.
     * Effects: shows "You matched with <other's username>!", both users' profile pictures,
     *          match.compatibilityPercent() to one decimal place followed by "% match!",
     *          and the skip (decline) and play (confirm) buttons (docs/assets/ui-sketch.png).
     * Satisfies: R-HOME-20, R-HOME-21.
     *
     * @param match the proposed match
     * @param self  the logged-in user's profile
     * @param other the matched user's profile
     */
    void displayMatch(Match match, UserProfile self, UserProfile other) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Handles a press of the confirm button.
     *
     * Requires: a match is displayed.
     * Effects: sends the confirmation to MatchController; if it returns a chat ID, asks
     *          ViewController to open that chat; otherwise asks ViewController for the
     *          HomeView (the chat appears in MessageLogView once the other user confirms).
     *          v2: the golden architecture always moves to ChatView; see OPEN-4.
     */
    void onConfirmPressed() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Handles a press of the decline button.
     *
     * Requires: a match is displayed.
     * Effects: sends the decline to MatchController, then asks ViewController for the HomeView.
     */
    void onDeclinePressed() {
        throw new UnsupportedOperationException("stub");
    }
}

// =====================================================================================
// Chat components
// =====================================================================================

/**
 * ChatModel: stores every chat, each with its time-stamped, message-by-message history.
 * v2 concurrency: both participants send messages concurrently (possibly through different
 * Lambda instances), so addMessage and every read are atomic across requests (DynamoDB
 * conditional writes); no message is lost and a reader never sees a partly appended chat.
 * Resides on: server.
 * Communicates with: ChatController.
 */
class ChatModel {

    /**
     * Requires: userA and userB belong to existing accounts; userA != userB.
     * Effects: stores a new chat with an empty history.
     *
     * @param userA one participant
     * @param userB the other participant
     * @return the new chat's unique ID
     */
    String createChat(String userA, String userB) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: chatId names an existing chat; message.senderId() is a participant;
     *           message.timestamp() is not earlier than the chat's last message.
     * Effects: appends message to the end of the chat's history.
     *
     * @param chatId  the chat
     * @param message the message to store
     */
    void addMessage(String chatId, ChatMessage message) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: chatId names an existing chat.
     * Effects: none.
     *
     * @param chatId the chat
     * @return the chat, with messages in increasing timestamp order
     */
    Chat getChat(String chatId) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: userId belongs to an existing account.
     * Effects: none.
     *
     * @param userId the user
     * @return every chat the user participates in and has neither removed from nor reported
     *         out of their log, ordered by the time of the chat's latest message (or its
     *         creation time if it has none), most recent first (v2, R-CHAT-02)
     */
    List<Chat> getChatsForUser(String userId) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: chatId names an existing chat; userId is a participant.
     * Effects: the chat no longer appears in getChatsForUser(userId).
     *
     * @param chatId the chat
     * @param userId the user removing it from their log
     */
    void removeChatForUser(String chatId, String userId) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * v2: marks a chat as reported, for moderation.
     * Satisfies: R-CHAT-16.
     *
     * Requires: chatId names an existing chat; reporterId is a participant.
     * Effects: isFlagged(chatId) is true afterwards; records reporterId and the time.
     *
     * @param chatId     the chat
     * @param reporterId the participant who reported it
     */
    void flagChat(String chatId, String reporterId) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * v2.
     * Requires: chatId names an existing chat.
     * Effects: none.
     *
     * @param chatId the chat
     * @return true iff any participant has reported the chat
     */
    boolean isFlagged(String chatId) {
        throw new UnsupportedOperationException("stub");
    }
}

/**
 * ChatController: sends messages from ChatView to ChatModel and pulls chat history for
 * ChatView and MessageLogView.
 * Resides on: client and server (v2, per the golden architecture: "All controllers perform API
 *   calls"). The client side (React + TypeScript) sends each request as an HTTPS API call; the server
 *   side (Java, AWS Lambda) handles it and calls the models.
 * Communicates with: ChatModel, ChatView, MessageLogView, MatchController.
 */
class ChatController {
    /** v2: a user counts as online if their app sent a heartbeat this recently. */
    static final Duration ONLINE_WINDOW = Duration.ofSeconds(30);
    private final ChatModel chatModel;

    ChatController(ChatModel chatModel) {
        this.chatModel = chatModel;
    }

    /**
     * Requires: userA and userB belong to existing accounts that both confirmed a match.
     * Effects: a new chat between them is stored in ChatModel.
     *
     * @param userA one participant
     * @param userB the other participant
     * @return the new chat's ID
     */
    String openChat(String userA, String userB) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: chatId names an existing chat; senderId is a participant; text is non-empty.
     * Effects: stores the message in ChatModel, time-stamped with the current time.
     *
     * @param chatId   the chat
     * @param senderId the sending user
     * @param text     the message text
     * @return the stored message
     */
    ChatMessage sendMessage(String chatId, String senderId, String text) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: chatId names an existing chat.
     * Effects: none.
     *
     * @param chatId the chat
     * @return the chat's full message history, oldest first
     */
    List<ChatMessage> getHistory(String chatId) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: userId belongs to an existing account.
     * Effects: none.
     *
     * @param userId the user
     * @return every chat in the user's message log, most recent activity first (v2, R-CHAT-02)
     */
    List<Chat> getChatLog(String userId) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: chatId names an existing chat; userId is a participant.
     * Effects: the chat is removed from the user's message log in ChatModel.
     *
     * @param userId the user
     * @param chatId the chat to remove
     */
    void removeChatFromLog(String userId, String chatId) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * v2: handles the report button.
     * Satisfies: R-CHAT-15, R-CHAT-16.
     *
     * Requires: chatId names an existing chat; userId is a participant.
     * Effects: flags the chat in ChatModel and removes it from userId's message log.
     *
     * @param userId the reporting user
     * @param chatId the reported chat
     */
    void reportChat(String userId, String chatId) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * v2: the client calls this every few seconds while the app is open (it is also the
     * chat polling call; see architecture.md, real-time chat).
     *
     * Requires: userId belongs to a logged-in user; at is non-null.
     * Effects: the user's last-seen time becomes at if later than the stored one.
     *
     * @param userId the user whose app is open
     * @param at     the current time
     */
    void recordHeartbeat(String userId, Instant at) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * v2: drives the green online dot.
     * Satisfies: R-CHAT-06.
     *
     * Requires: userId belongs to an existing account; now is non-null.
     * Effects: none.
     *
     * @param userId the user to check
     * @param now    the current time
     * @return true iff the user's last heartbeat was at most ONLINE_WINDOW before now
     */
    boolean isUserOnline(String userId, Instant now) {
        throw new UnsupportedOperationException("stub");
    }
}

/**
 * ChatView: text box, send button and close button; shows both users' messages with
 * profile pictures, the match's messages left-aligned and the user's right-aligned.
 * v2 header (requirements): back button (the golden "close chat" button), the other user's
 * username, a green dot if they are online, and a report button, left to right.
 * Resides on: client (React + TypeScript web app; this Java stub is the behaviour spec).
 * Communicates with: ChatController, ViewController.
 */
class ChatView extends View {
    private final ChatController chatController;

    ChatView(BottomBarView bottomBar, ViewController viewController,
             ChatController chatController) {
        super(bottomBar, viewController);
        this.chatController = chatController;
    }

    @Override
    void show() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: chatId names an existing chat between self and other.
     * Effects: fetches and shows the chat's full history from ChatController, and the header
     *          with other's username and the online dot if ChatController reports other online.
     * Satisfies: R-CHAT-01, R-CHAT-03, R-CHAT-04, R-CHAT-06, R-CHAT-14.
     *
     * @param chatId the chat to open
     * @param self   the logged-in user's profile
     * @param other  the match's profile
     */
    void openChat(String chatId, UserProfile self, UserProfile other) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: message belongs to the open chat.
     * Effects: draws message right-aligned if isOwn and left-aligned otherwise, with the
     *          sender's profile picture beside it iff showAvatar.
     *          Own messages are drawn in blue bubbles and the other user's in grey (OPEN-8).
     * Satisfies: R-CHAT-07, R-CHAT-08, R-CHAT-10, R-CHAT-11.
     *
     * @param message    the message to draw
     * @param isOwn      true iff the logged-in user sent message
     * @param showAvatar true iff the sender's profile picture is drawn beside message
     */
    void renderMessage(ChatMessage message, boolean isOwn, boolean showAvatar) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * v2: groups messages for the profile-picture rule (one picture per set of messages a
     * sender sends within one minute). Pure function, so it gets white-box tests.
     * Satisfies: R-CHAT-09.
     *
     * Requires: current is non-null; if previous is non-null it is the message directly
     *           before current in the chat.
     * Effects: none.
     *
     * @param previous the message before current, or null if current is the first
     * @param current  the message being drawn
     * @return true iff previous is null, or previous was sent by a different user, or
     *         current.timestamp() is more than 60 seconds after previous.timestamp()
     */
    static boolean startsNewGroup(ChatMessage previous, ChatMessage current) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * v2: handles the report button.
     *
     * Requires: a chat is open.
     * Effects: asks ChatController to report the chat, then asks ViewController for the
     *          MessageLogView (where the chat no longer appears).
     * Satisfies: R-CHAT-15.
     */
    void onReportPressed() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Handles a press of the send button.
     *
     * Requires: a chat is open.
     * Effects: if the text box is non-empty, sends its text to ChatController, clears the
     *          box and renders the message; otherwise does nothing.
     * Satisfies: R-CHAT-12, R-CHAT-13.
     */
    void onSendPressed() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Handles a press of the close-chat (back) button.
     *
     * Requires: a chat is open.
     * Effects: asks ViewController for the MessageLogView.
     * Satisfies: R-CHAT-05.
     */
    void onClosePressed() {
        throw new UnsupportedOperationException("stub");
    }
}

/**
 * MessageLogView: lists every prior match's profile picture and username as buttons,
 * each with a button to remove the chat from the log.
 * Resides on: client (React + TypeScript web app; this Java stub is the behaviour spec).
 * Communicates with: ChatController, ViewController.
 */
class MessageLogView extends View {
    private final ChatController chatController;

    MessageLogView(BottomBarView bottomBar, ViewController viewController,
                   ChatController chatController) {
        super(bottomBar, viewController);
        this.chatController = chatController;
    }

    @Override
    void show() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: chats and profiles are non-null; profiles has an entry for the other
     *           participant of every chat, in the same order.
     * Effects: shows one button per chat, in the given order (most recent activity first),
     *          with the other participant's picture and username.
     * Satisfies: R-CHAT-02.
     *
     * @param chats    the user's chats
     * @param profiles the other participant of each chat
     */
    void displayLog(List<Chat> chats, List<UserProfile> profiles) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: chatId is shown in the log.
     * Effects: asks ViewController to open the ChatView for chatId.
     *
     * @param chatId the chat that was pressed
     */
    void onChatSelected(String chatId) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: chatId is shown in the log.
     * Effects: asks ChatController to remove the chat from the user's log and removes its button.
     *
     * @param chatId the chat to remove
     */
    void onRemoveChatPressed(String chatId) {
        throw new UnsupportedOperationException("stub");
    }
}

// =====================================================================================
// Navigation components
// =====================================================================================

/**
 * BottomBarView: contained in every view; has buttons for HomeView, MessageLogView and
 * ProfileView.
 * Resides on: client (React + TypeScript web app; this Java stub is the behaviour spec).
 * Communicates with: ViewController.
 */
class BottomBarView {
    private final ViewController viewController;

    BottomBarView(ViewController viewController) {
        this.viewController = viewController;
    }

    /**
     * Requires: a user is logged in.
     * Effects: asks ViewController for the HomeView.
     */
    void onHomePressed() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: a user is logged in.
     * Effects: asks ViewController for the MessageLogView.
     */
    void onMessagesPressed() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: a user is logged in.
     * Effects: asks ViewController for the ProfileView.
     */
    void onProfilePressed() {
        throw new UnsupportedOperationException("stub");
    }
}

/**
 * ViewController: receives view requests from BottomBarView, ChatView, MessageLogView,
 * MatchView, LoginView and CreateAccountView (v2) and opens the corresponding view. In the
 * React app this is the router: each ViewType is a URL route (e.g. /login, /signup, /home),
 * so browser back/forward and page refresh work.
 * Resides on: client (React + TypeScript web app; this Java stub is the behaviour spec).
 * Communicates with: every view.
 */
class ViewController {

    /**
     * Registers the view instance to open for a view type.
     *
     * Requires: view is non-null and is the view for type.
     * Effects: later requests for type open view.
     *
     * @param type the view type
     * @param view the view to show for it
     */
    void registerView(ViewType type, View view) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Records the logged-in user after a successful login or account verification.
     *
     * Requires: userId belongs to a verified account.
     * Effects: userId becomes the current user and the HomeView is opened.
     *
     * @param userId the logged-in user
     */
    void onLoginSuccess(String userId) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Opens a view.
     *
     * Requires: type is not CHAT (use openChat); a view is registered for type; if type is
     *           neither LOGIN nor CREATE_ACCOUNT, a user is logged in.
     * Effects: the requested view is shown and getCurrentView() returns type. v2: the
     *          bottom bar is shown on HOME, PROFILE, MESSAGE_LOG, CHAT and MATCH, and hidden
     *          on LOGIN and CREATE_ACCOUNT (no user is logged in yet; OPEN-10). Satisfies: R-UI-04, R-UI-05.
     *
     * @param type the view requested
     */
    void requestView(ViewType type) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Opens the ChatView for a chat.
     *
     * Requires: a user is logged in and participates in chatId.
     * Effects: the ChatView is shown with chatId open; getCurrentView() returns CHAT.
     *
     * @param chatId the chat to open
     */
    void openChat(String chatId) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Opens the MatchView for a proposed match.
     *
     * Requires: a user is logged in and is one of match's users.
     * Effects: the MatchView is shown for match; getCurrentView() returns MATCH.
     *
     * @param match the proposed match
     */
    void openMatch(Match match) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: none.
     * Effects: none.
     *
     * @return the view currently shown
     */
    ViewType getCurrentView() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: a user is logged in.
     * Effects: none.
     *
     * @return the logged-in user's ID
     */
    String getCurrentUserId() {
        throw new UnsupportedOperationException("stub");
    }
}