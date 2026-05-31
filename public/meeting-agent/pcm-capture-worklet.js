const SAMPLE_RATE = 16_000
const FRAME_MS = 100
const FRAME_SAMPLES = Math.floor((SAMPLE_RATE * FRAME_MS) / 1000)

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.inputSampleRate = sampleRate
    this.pending = []
  }

  process(inputs) {
    const input = inputs[0]
    const channel = input && input[0]
    if (!channel || channel.length === 0) return true

    const resampled = this.resample(channel, this.inputSampleRate, SAMPLE_RATE)
    for (let i = 0; i < resampled.length; i += 1) this.pending.push(resampled[i])

    while (this.pending.length >= FRAME_SAMPLES) {
      const frame = this.pending.splice(0, FRAME_SAMPLES)
      const pcm = new Int16Array(frame.length)
      for (let i = 0; i < frame.length; i += 1) {
        const value = Math.max(-1, Math.min(1, frame[i]))
        pcm[i] = value < 0 ? value * 0x8000 : value * 0x7fff
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer])
    }

    return true
  }

  resample(input, fromRate, toRate) {
    if (fromRate === toRate) return Array.from(input)
    const ratio = fromRate / toRate
    const length = Math.floor(input.length / ratio)
    const output = new Array(length)
    for (let i = 0; i < length; i += 1) {
      const index = i * ratio
      const before = Math.floor(index)
      const after = Math.min(before + 1, input.length - 1)
      const weight = index - before
      output[i] = input[before] * (1 - weight) + input[after] * weight
    }
    return output
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor)
