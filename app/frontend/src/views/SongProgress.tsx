/**
 * The song's time slider and elapsed time. The player only reports its position a few times a
 * second, so between reports the slider moves itself on every animation frame. It writes straight
 * to the input, so the rest of the page doesn't re-render 60 times a second.
 *
 * While the user drags, the slider follows them and the song seeks once on release. Keyboard
 * changes seek immediately.
 *
 * Satisfies: R-HOME-05 (stub onSliderMoved).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type PointerEvent } from 'react';
import { formatTime, nextAnchorPosition, projectPosition, type PlaybackAnchor } from './homeLogic';

export interface SongProgressProps {
  /** The position the player last reported, in seconds. */
  readonly positionSeconds: number;
  readonly durationSeconds: number;
  readonly isPaused: boolean;
  readonly disabled: boolean;
  /** Called with the position the user chose. */
  readonly onSeek: (seconds: number) => void;
}

/**
 * Requires: 0 <= positionSeconds <= durationSeconds.
 * Effects: shows the slider and time, moving smoothly while playing.
 */
export function SongProgress({ positionSeconds, durationSeconds, isPaused, disabled, onSeek }: SongProgressProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Set properly by the layout effect below, before the first paint.
  const anchorRef = useRef<PlaybackAnchor>({ positionSeconds, at: 0, isMoving: false });
  const draggingRef = useRef(false);
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const isDragging = dragPosition !== null;

  // A new report from the player: continue from it.
  useLayoutEffect(() => {
    const now = performance.now();
    const shown = projectPosition(anchorRef.current, now, durationSeconds);
    const position = nextAnchorPosition(shown, positionSeconds, isPaused);
    anchorRef.current = { positionSeconds: position, at: now, isMoving: !isPaused };
    if (!draggingRef.current) inputRef.current!.value = String(position);
  }, [positionSeconds, durationSeconds, isPaused]);

  // Between reports: move the slider on every frame.
  useEffect(() => {
    if (isPaused || disabled || isDragging) return;
    let frame = requestAnimationFrame(function step() {
      const input = inputRef.current;
      if (input === null) return; // React has just removed the slider
      input.value = String(projectPosition(anchorRef.current, performance.now(), durationSeconds));
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [isPaused, disabled, isDragging, durationSeconds]);

  function handlePointerDown(event: PointerEvent<HTMLInputElement>) {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragPosition(Number(event.currentTarget.value));
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const seconds = Number(event.target.value);
    if (draggingRef.current) {
      setDragPosition(seconds);
    } else {
      anchorRef.current = { positionSeconds: seconds, at: performance.now(), isMoving: !isPaused };
      onSeek(seconds);
    }
  }

  function finishDrag(event: PointerEvent<HTMLInputElement>) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const seconds = Number(event.currentTarget.value);
    anchorRef.current = { positionSeconds: seconds, at: performance.now(), isMoving: !isPaused };
    setDragPosition(null);
    onSeek(seconds);
  }

  const shownTime = dragPosition ?? positionSeconds;

  return (
    <div className="home__progress">
      <input
        ref={inputRef}
        type="range"
        className="home__slider"
        aria-label="Playback position"
        aria-valuetext={`${formatTime(shownTime)} of ${formatTime(durationSeconds)}`}
        min={0}
        max={Math.max(durationSeconds, 1)}
        step="any"
        defaultValue={positionSeconds}
        onChange={handleChange}
        onPointerDown={handlePointerDown}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        disabled={disabled}
      />
      <p className="home__time">
        <span>{formatTime(shownTime)}</span>
        <span>{formatTime(durationSeconds)}</span>
      </p>
    </div>
  );
}
