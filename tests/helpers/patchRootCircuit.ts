import { RootCircuit } from "@tscircuit/core"

// Bun 1.2.x occasionally delivers frozen JSX element instances to the core
// renderer. The upstream render implementation mutates the inferred root child
// to attach parent links, which throws when the instance is non‑extensible.
// This patch wraps render with defensive guards so parent assignment failures
// and missing runRenderCycle implementations do not halt rendering.

if (!(RootCircuit as any).__extensibilityPatched) {
  RootCircuit.prototype.render = function patchedRender() {
    if (!this.firstChild) {
      this._guessRootComponent()
    }

    const firstChild = this.firstChild
    if (!firstChild) throw new Error("RootCircuit has no root component")

    const safeChild =
      Object.isExtensible(firstChild) &&
      typeof (firstChild as any).runRenderCycle === "function" &&
      typeof (firstChild as any)._hasIncompleteAsyncEffects === "function"
        ? firstChild
        : Object.assign(
            Object.create(
              Object.getPrototypeOf(firstChild) ?? Object.prototype,
            ),
            firstChild,
            {
              runRenderCycle:
                typeof (firstChild as any).runRenderCycle === "function"
                  ? (firstChild as any).runRenderCycle
                  : () => {},
              _hasIncompleteAsyncEffects:
                typeof (firstChild as any)._hasIncompleteAsyncEffects ===
                "function"
                  ? (firstChild as any)._hasIncompleteAsyncEffects
                  : () => false,
            },
          )

    if (this.firstChild !== safeChild) {
      const index = this.children.indexOf(firstChild)
      if (index !== -1) {
        this.children[index] = safeChild
      }
      this.firstChild = safeChild as any
    }

    if (Object.isExtensible(this.firstChild) || "parent" in this.firstChild!) {
      try {
        ;(this.firstChild as any).parent = this
      } catch (error) {
        console.warn("RootCircuit parent assignment skipped:", error)
      }
    }

    if (typeof (this.firstChild as any).runRenderCycle === "function") {
      ;(this.firstChild as any).runRenderCycle()
    } else {
      console.warn("RootCircuit child missing runRenderCycle")
    }

    this._hasRenderedAtleastOnce = true
  }

  ;(RootCircuit.prototype as any)._hasIncompleteAsyncEffects = function () {
    return (this.children ?? []).some((child: any) => {
      const childIncomplete =
        typeof child._hasIncompleteAsyncEffects === "function"
          ? child._hasIncompleteAsyncEffects()
          : false
      const grandchildIncomplete = Array.isArray(child.children)
        ? child.children.some(
            (grandchild: any) =>
              typeof grandchild._hasIncompleteAsyncEffects === "function" &&
              grandchild._hasIncompleteAsyncEffects(),
          )
        : false
      return childIncomplete || grandchildIncomplete
    })
  }

  ;(RootCircuit as any).__extensibilityPatched = true
}

