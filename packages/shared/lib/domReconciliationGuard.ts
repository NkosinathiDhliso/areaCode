/**
 * Hardens `Node.prototype.insertBefore` / `removeChild` so a third party that
 * mutates the DOM out from under React cannot white-screen the whole app.
 *
 * The crash this prevents:
 *
 *   NotFoundError: Failed to execute 'insertBefore' on 'Node': The node before
 *   which the new node is to be inserted is not a child of this node.
 *
 * It surfaces deep in React's commit phase (`commitMutationEffects` →
 * `insertOrAppendPlacementNode` → `insertBefore`). React renders against its
 * virtual tree, but between render and commit a browser translation layer
 * (Chrome / Google Translate auto-translate, common for our `lang="en-ZA"`
 * shell when a user's device language isn't English) or an extension such as
 * Grammarly swaps or relocates a text node. React then asks the DOM to insert a
 * node before a reference node that is no longer a child of the expected
 * parent, the native call throws, and the error escapes React's reconciler —
 * taking the entire tree down (a blank screen), not just the affected subtree.
 *
 * The fix, recommended on the long-running React issue
 * https://github.com/facebook/react/issues/11538 , is to make the two DOM
 * mutation primitives resilient: when the reference/child node has already been
 * moved by a third party, degrade to a safe no-op (or a plain append) instead
 * of throwing. React reconciles to the correct DOM on its next render, so the
 * visible cost is nil while the hard crash is eliminated.
 *
 * Install once, before the React root renders (see each app's entry point).
 * Idempotent: a second call is a no-op.
 */

const INSTALLED_FLAG = '__ac_dom_reconciliation_guard__'

type GuardedNode = Node & { [INSTALLED_FLAG]?: boolean }

export function installDomReconciliationGuard(): void {
  if (typeof Node !== 'function' || !Node.prototype) return

  const proto = Node.prototype as GuardedNode
  // Guard against double-patching (HMR, repeated bootstrap, multiple apps on a
  // page) which would otherwise stack wrappers.
  if (proto[INSTALLED_FLAG]) return
  proto[INSTALLED_FLAG] = true

  const originalRemoveChild = Node.prototype.removeChild
  Node.prototype.removeChild = function removeChild<T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      // The node was already detached/relocated by a third party. React thinks
      // it still owns it; swallow the mismatch instead of throwing.
      console.warn('[domReconciliationGuard] skipped removeChild for a node with a different parent')
      return child
    }
    return originalRemoveChild.call(this, child) as T
  }

  const originalInsertBefore = Node.prototype.insertBefore
  Node.prototype.insertBefore = function insertBefore<T extends Node>(
    this: Node,
    newNode: T,
    referenceNode: Node | null,
  ): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      // The reference node has been moved/removed since React planned this
      // insertion. Append to the correct parent rather than throwing, so the
      // commit completes; React re-orders on its next render.
      console.warn('[domReconciliationGuard] insertBefore reference node has a different parent; appending instead')
      return originalInsertBefore.call(this, newNode, null) as T
    }
    return originalInsertBefore.call(this, newNode, referenceNode) as T
  }
}
