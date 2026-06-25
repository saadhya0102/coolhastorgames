/** Unified keyboard / mouse / touch input manager.
 * Pointer coordinates are reported in the game's logical coordinate space. */
export class InputManager {
  private keys = new Set<string>();
  private justPressed = new Set<string>();
  private justReleased = new Set<string>();
  /** virtual keys injected by on-screen controls */
  private virtual = new Set<string>();

  pointer = { x: 0, y: 0, down: false, justDown: false, justUp: false };
  /** active pointers (multi-touch) keyed by pointerId */
  pointers = new Map<number, { x: number; y: number }>();

  private el: HTMLElement;
  private toLogical: (clientX: number, clientY: number) => { x: number; y: number };
  private listeners: Array<[EventTarget, string, EventListener]> = [];

  constructor(
    el: HTMLElement,
    toLogical: (clientX: number, clientY: number) => { x: number; y: number },
  ) {
    this.el = el;
    this.toLogical = toLogical;
    this.attach();
  }

  private add(target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions) {
    target.addEventListener(type, fn, opts);
    this.listeners.push([target, type, fn]);
  }

  private attach() {
    this.add(window, "keydown", (e) => {
      const ev = e as KeyboardEvent;
      // prevent page scroll on arrows / space while playing
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "Spacebar"].includes(ev.key)) {
        ev.preventDefault();
      }
      const k = this.norm(ev.key);
      if (!this.keys.has(k)) this.justPressed.add(k);
      this.keys.add(k);
    });
    this.add(window, "keyup", (e) => {
      const k = this.norm((e as KeyboardEvent).key);
      this.keys.delete(k);
      this.justReleased.add(k);
    });

    const onDown = (e: PointerEvent) => {
      const p = this.toLogical(e.clientX, e.clientY);
      this.pointers.set(e.pointerId, p);
      this.pointer.x = p.x;
      this.pointer.y = p.y;
      this.pointer.down = true;
      this.pointer.justDown = true;
      this.el.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const p = this.toLogical(e.clientX, e.clientY);
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
      this.pointer.x = p.x;
      this.pointer.y = p.y;
    };
    const onUp = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      this.pointer.down = this.pointers.size > 0;
      this.pointer.justUp = true;
    };
    this.add(this.el, "pointerdown", onDown as EventListener);
    this.add(this.el, "pointermove", onMove as EventListener);
    this.add(window, "pointerup", onUp as EventListener);
    this.add(window, "pointercancel", onUp as EventListener);
  }

  private norm(key: string): string {
    if (key === " " || key === "Spacebar") return "Space";
    if (key.length === 1) return key.toLowerCase();
    return key;
  }

  /** called by on-screen controls */
  setVirtual(key: string, down: boolean) {
    const k = this.norm(key);
    if (down) {
      if (!this.virtual.has(k) && !this.keys.has(k)) this.justPressed.add(k);
      this.virtual.add(k);
    } else {
      this.virtual.delete(k);
      this.justReleased.add(k);
    }
  }

  isDown(...keys: string[]): boolean {
    return keys.some((k) => {
      const n = this.norm(k);
      return this.keys.has(n) || this.virtual.has(n);
    });
  }

  pressed(...keys: string[]): boolean {
    return keys.some((k) => this.justPressed.has(this.norm(k)));
  }

  released(...keys: string[]): boolean {
    return keys.some((k) => this.justReleased.has(this.norm(k)));
  }

  /** call at the end of every frame */
  endFrame() {
    this.justPressed.clear();
    this.justReleased.clear();
    this.pointer.justDown = false;
    this.pointer.justUp = false;
  }

  destroy() {
    for (const [t, type, fn] of this.listeners) t.removeEventListener(type, fn);
    this.listeners = [];
    this.keys.clear();
    this.virtual.clear();
  }
}
