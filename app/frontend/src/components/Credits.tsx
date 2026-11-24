/**
 * The app's credits (app-spec.md): the logo's attribution must appear wherever the logo does, and
 * Chosic and Spotify are credited for song data and playback.
 */

/**
 * Requires: none.
 * Effects: renders the logo and credits.
 */
export function Credits() {
  return (
    <section className="credits" aria-labelledby="credits-title">
      <img className="credits__logo" src="/logo.png" alt="Do~Re logo: two music notes in a speech bubble" />
      <div>
        <h2 id="credits-title" className="credits__title">
          About Do~Re
        </h2>
        <p>Logo: Created by BEARicons from Noun Project (Creative Commons).</p>
        <p>Song data: Chosic, from Spotify. Playback and album art: Spotify.</p>
      </div>
    </section>
  );
}
