// Runs on the audio thread. Plain JS because addModule() fetches this file as-is:
// it is never bundled, so there is nothing to compile it from TypeScript.

const FRAME = 1024;

class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(FRAME);
    this.filled = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0) {
      return true;
    }

    const length = channels[0].length;
    for (let i = 0; i < length; i++) {
      let sum = 0;
      for (let c = 0; c < channels.length; c++) {
        sum += channels[c][i];
      }
      this.frame[this.filled++] = sum / channels.length;

      if (this.filled === FRAME) {
        // Transferring detaches the buffer, so a new one is allocated here, on the audio
        // thread, about fifty times a second. That is a real-time smell and it is deliberate:
        // the allocation-free version needs a SharedArrayBuffer ring with atomics, and no
        // dropout has turned up yet to justify one. If one does, that is the fix.
        this.port.postMessage(this.frame, [this.frame.buffer]);
        this.frame = new Float32Array(FRAME);
        this.filled = 0;
      }
    }

    return true;
  }
}

registerProcessor('capture', Capture);
