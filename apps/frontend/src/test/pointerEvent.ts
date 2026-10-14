// jsdom har ingen PointerEvent: fireEvent.pointerEnter(el, { pointerType: 'touch' }) skapar då en vanlig Event och `pointerType` försvinner,
// så en handler som väljer på touch/mus ser alltid `undefined`. Den här filen lägger en minimal PointerEvent (en MouseEvent med pointerId/
// pointerType) när den saknas. Importeras av tester som provar pekar-gester: `import '@/test/pointerEvent';`.
if (typeof window !== 'undefined' && typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? '';
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}
