/**
 * Pure gesture classification and index stepping for the Peek_Carousel.
 *
 * These functions are deterministic and total: they never throw on
 * finite-numeric input and always return a defined result. They form the
 * decidable core that the React/gesture layer routes against, so the same
 * gesture always yields the same interpretation (Requirement 7.4).
 */

/** Result of dominant-axis drag classification. */
export type DragAxis = 'horizontal' | 'vertical' | 'indeterminate'

/**
 * Classifies a drag displacement by its dominant axis.
 *
 * Returns `'horizontal'` when the horizontal displacement dominates the
 * vertical by more than `threshold` (`|dx| - |dy| > threshold`),
 * `'vertical'` when the vertical displacement dominates by more than
 * `threshold` (`|dy| - |dx| > threshold`), and `'indeterminate'` otherwise
 * (when neither axis dominates by more than the threshold).
 *
 * The classification is symmetric in sign — only magnitudes matter — so the
 * same gesture always yields the same interpretation. An `'indeterminate'`
 * result means the caller should take no selection or state-change action.
 *
 * @param dx horizontal displacement in pixels
 * @param dy vertical displacement in pixels
 * @param threshold the dominance margin in pixels (e.g. DRAG_AXIS_THRESHOLD)
 *
 * Validates: Requirements 7.1, 7.2, 7.4, 7.5
 */
export function classifyDrag(dx: number, dy: number, threshold: number): DragAxis {
  const absDx = Math.abs(dx)
  const absDy = Math.abs(dy)

  if (absDx - absDy > threshold) return 'horizontal'
  if (absDy - absDx > threshold) return 'vertical'
  return 'indeterminate'
}

/**
 * Steps an index forward or backward in a circular list of `length` items,
 * wrapping at both ends.
 *
 * The next index is `(current + dir + length) mod length`, which wraps past
 * either end (e.g. stepping back from index 0 lands on `length - 1`, and
 * stepping forward from `length - 1` lands on 0).
 *
 * For a list of length <= 1 there is nothing to step to, so the input
 * `current` index is returned unchanged. The function is total: it does not
 * throw for empty or single-element lists.
 *
 * @param current the current index
 * @param dir the step direction: +1 (next) or -1 (previous)
 * @param length the number of items in the list
 *
 * Validates: Requirements 3.2, 3.3, 7.x stepping
 */
export function stepIndex(current: number, dir: 1 | -1, length: number): number {
  if (length <= 1) return current
  return (current + dir + length) % length
}
