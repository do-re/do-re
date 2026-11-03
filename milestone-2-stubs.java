/*
 * Milestone 2 — Architecture Stubs
 *
 * Stubs for every component described in architecture.md. Each component has its
 * constructor (showing which other components it talks to) and the full header of every
 * request it can receive, with arguments, return values, preconditions (Requires) and
 * postconditions (Effects). No method has an implementation yet; every body throws
 * UnsupportedOperationException.
 *
 * This file has no public top-level types, so it compiles under this file name.
 * Split each type into its own <TypeName>.java file (and make it public) once implementation begins.
 */

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;

// =====================================================================================
// Shared data types
// =====================================================================================

/**
 * The 7 externally gathered numbers describing a song.
 * Rep invariant: values != null && values.length == AudioFeatures.SIZE.
 */
record AudioFeatures(double[] values) {
    static final int SIZE = 7;
}

/**
 * A user's 7-long music taste profile, in the same space as AudioFeatures.
 * Rep invariant: values != null && values.length == AudioFeatures.SIZE.
 */
record TasteVector(double[] values) {
}

/**
 * A playable song.
 * Rep invariant: id is non-empty and unique; durationSeconds > 0; tags and features are non-null.
 */
record Song(String id, String title, String artist, double durationSeconds,
            List<String> tags, AudioFeatures features) {
}

/** Public profile information for one account. */
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
 */
record Chat(String chatId, String userA, String userB, List<ChatMessage> messages) {
}

/** A proposed match between two users. Rep invariant: userA != userB. */
record Match(String matchId, String userA, String userB) {
}

/** Every screen ViewController can open. */
enum ViewType { LOGIN, HOME, PROFILE, MATCH, CHAT, MESSAGE_LOG }

/** Result of a login attempt. */
enum LoginResult { SUCCESS, WRONG_PASSWORD, NO_ACCOUNT, NOT_VERIFIED }

/** Result of an account creation attempt. */
enum CreateAccountResult { PENDING_VERIFICATION, EMAIL_IN_USE }

// =====================================================================================
// Account components
// =====================================================================================

/**
 * AccountModel: stores email/password combinations, unique user IDs, usernames and
 * profile pictures; validates logins and checks whether an email is already in use.
 * Resides on: server (assumed).
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
     * @return true iff an account exists with this email and its stored password matches
     */
    boolean isValidLogin(String email, String password) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Creates a new, not-yet-activated account and assigns it a unique ID.
     *
     * Requires: email and password are non-empty; isEmailInUse(email) is false.
     * Effects: stores the account as inactive; afterwards isEmailInUse(email) is true
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
 * Resides on: server (assumed).
 * Communicates with: AccountModel, LoginView, ProfileView.
 */
class AccountController {
    private final AccountModel accountModel;

    AccountController(AccountModel accountModel) {
        this.accountModel = accountModel;
    }

    /**
     * Validates submitted login details (called when Enter is pressed on LoginView).
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
     *
     * Requires: email is a well-formed address; password is non-empty.
     * Effects: if the email is not in use, an inactive account is created in AccountModel
     *          and a confirmation email is sent to email; otherwise nothing changes.
     *
     * @param email    the submitted email
     * @param password the submitted password
     * @return PENDING_VERIFICATION if the account was created, EMAIL_IN_USE otherwise
     */
    CreateAccountResult createAccount(String email, String password) {
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
 * Resides on: client.
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
 * LoginView: email box, password box and Enter button; shows the account-creation
 * popup and waits for email verification.
 * Resides on: client.
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
     * Handles a press of the Enter button: synchronously sends the email and password to
     * AccountController.
     *
     * Requires: none.
     * Effects: on SUCCESS, asks ViewController for the HomeView; if no account uses the
     *          email, shows the account-creation popup; otherwise shows an error message.
     */
    void onEnterPressed() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Shows the account-creation popup asking the user to verify their email.
     *
     * Requires: email is the address a confirmation email was just sent to.
     * Effects: the popup is displayed until verification completes or the user closes it.
     *
     * @param email the address awaiting verification
     */
    void showVerificationPopup(String email) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Waits until AccountController reports the account as verified.
     *
     * Requires: email belongs to an account that is awaiting verification.
     * Effects: when verification succeeds, closes the popup and asks ViewController for the
     *          HomeView; returns early if the user closes the popup.
     *
     * @param email the address awaiting verification
     * @return true iff the account was verified
     */
    boolean awaitEmailVerification(String email) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: message is non-empty.
     * Effects: displays message to the user on the login screen.
     *
     * @param message the error to display
     */
    void showError(String message) {
        throw new UnsupportedOperationException("stub");
    }
}

/**
 * ProfileView: displays the username and profile picture; lets the user change both.
 * Resides on: client.
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
 * Resides on: server (assumed).
 * Communicates with: SongController.
 */
class MusicTasteModel {
    static final int HISTORY_SIZE = 100;

    /**
     * Records one listen and folds it into the user's Taste Vector.
     *
     * Requires: userId belongs to an existing account; event is non-null.
     * Effects: event.song() is added as the most recent entry of the user's history; if the
     *          history then exceeds HISTORY_SIZE, the oldest entry is removed. The song's
     *          Audio Features, multiplied by computeWeight(event), are added to the user's
     *          Taste Vector.
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
     * @return a weight that increases with the fraction of the song listened to; positive
     *         for LIKE, and never greater for SKIP than for LIKE at the same listen time
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
     * Effects: if the user has no Taste Vector yet, creates an all-zero one.
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
 * Resides on: server (assumed).
 * Communicates with: SongController.
 */
class SongSuggestionModel {
    static final int CACHE_SIZE = 5;

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
 * Resides on: server (assumed).
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
     *
     * @param userId the user
     * @return the song currently active for this user
     */
    Song getCurrentSong(String userId) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Records the user's reaction to the active song and advances to the next one.
     *
     * Requires: userId belongs to a logged-in user; songId is the user's active song;
     *           0 <= secondsListened <= that song's duration.
     * Effects: sends the like/skip and listen time to MusicTasteModel, sends the updated
     *          Taste Vector to MatchModel, and makes the next suggestion the active song.
     *
     * @param userId          the user
     * @param songId          the song reacted to
     * @param feedback        LIKE (swipe right) or SKIP (swipe left)
     * @param secondsListened how long the user listened before reacting
     * @return the new active song
     */
    Song submitFeedback(String userId, String songId, Feedback feedback, double secondsListened) {
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
 * HomeView: plays the active song, shows its tags, time slider, pause button and
 * swipe left (skip) / swipe right (like) buttons.
 * Resides on: client.
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
     * Effects: shows song and its tags, resets the time slider to 0 and starts playback.
     *
     * @param song the song to display and play
     */
    void displaySong(Song song) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Handles swipe left (skip).
     *
     * Requires: a song is displayed.
     * Effects: sends SKIP and the time listened to SongController and displays the song
     *          it returns.
     */
    void onSwipeLeft() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Handles swipe right (like).
     *
     * Requires: a song is displayed.
     * Effects: sends LIKE and the time listened to SongController and displays the song
     *          it returns.
     */
    void onSwipeRight() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Requires: a song is displayed.
     * Effects: pauses playback if playing, resumes it if paused.
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
 * Resides on: server (assumed).
 * Communicates with: MatchController, SongController, MusicTasteModel.
 */
class MatchModel {

    /**
     * Inserts or updates a user's position in every leaderboard.
     *
     * Requires: userId belongs to an existing account; taste is non-null.
     * Effects: the user's leaderboard positions reflect taste.
     *
     * @param userId the user
     * @param taste  the user's current Taste Vector
     */
    void updateUser(String userId, TasteVector taste) {
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
     * Finds the user whose taste is closest to this user's.
     *
     * Requires: userId belongs to an existing account.
     * Effects: none.
     *
     * @param userId the user
     * @return a match with the closest other user that this user has not already matched
     *         with or declined, or empty if there is none
     */
    Optional<Match> findMatch(String userId) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Records one user's decision on a proposed match.
     *
     * Requires: match was returned by findMatch; userId is match.userA() or match.userB().
     * Effects: stores the decision; a declined pair is never proposed again.
     *
     * @param match    the proposed match
     * @param userId   the deciding user
     * @param accepted true if confirmed, false if declined
     * @return true iff both users have now confirmed this match
     */
    boolean recordDecision(Match match, String userId, boolean accepted) {
        throw new UnsupportedOperationException("stub");
    }
}

/**
 * MatchController: referenced by MatchModel in architecture.md but not yet described there.
 * Checks for matches after swipes, records confirm/decline, and opens a chat when
 * both users confirm.
 * Resides on: server (assumed).
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
     * Requires: userId belongs to a logged-in user; swipeCount >= 0.
     * Effects: none beyond MatchModel.shouldOfferMatch.
     *
     * @param userId     the user who just swiped
     * @param swipeCount number of swipes the user has made this session
     * @return a match to show on MatchView, or empty if none should be offered now
     */
    Optional<Match> checkForMatch(String userId, int swipeCount) {
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
     * Effects: records the confirmation in MatchModel; if both users have confirmed,
     *          creates a chat between them through ChatController.
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
 * Resides on: client.
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
     * Effects: shows both users' profile pictures and usernames.
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
     * Effects: sends the confirmation to MatchController, then asks ViewController for the
     *          ChatView of the resulting chat.
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
 * Resides on: server (assumed).
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
     * @return every chat the user participates in and has not removed from their log
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
}

/**
 * ChatController: sends messages from ChatView to ChatModel and pulls chat history for
 * ChatView and MessageLogView.
 * Resides on: server (assumed).
 * Communicates with: ChatModel, ChatView, MessageLogView, MatchController.
 */
class ChatController {
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
     * @return every chat in the user's message log
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
}

/**
 * ChatView: text box, send button and close button; shows both users' messages with
 * profile pictures, the match's messages left-aligned and the user's right-aligned.
 * Resides on: client.
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
     * Effects: shows the chat's full history from ChatController.
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
     * Effects: draws message with its sender's profile picture, right-aligned if isOwn
     *          and left-aligned otherwise.
     *
     * @param message the message to draw
     * @param isOwn   true iff the logged-in user sent message
     */
    void renderMessage(ChatMessage message, boolean isOwn) {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Handles a press of the send button.
     *
     * Requires: a chat is open.
     * Effects: if the text box is non-empty, sends its text to ChatController, clears the
     *          box and renders the message; otherwise does nothing.
     */
    void onSendPressed() {
        throw new UnsupportedOperationException("stub");
    }

    /**
     * Handles a press of the close-chat button.
     *
     * Requires: a chat is open.
     * Effects: asks ViewController for the MessageLogView.
     */
    void onClosePressed() {
        throw new UnsupportedOperationException("stub");
    }
}

/**
 * MessageLogView: lists every prior match's profile picture and username as buttons,
 * each with a button to remove the chat from the log.
 * Resides on: client.
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
     * Effects: shows one button per chat with the other participant's picture and username.
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
 * Resides on: client.
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
 * MatchView and LoginView and opens the corresponding view.
 * Resides on: client.
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
     *           not LOGIN, a user is logged in.
     * Effects: the requested view is shown and getCurrentView() returns type.
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