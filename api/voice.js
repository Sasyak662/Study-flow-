// StudyStarx read-aloud voice: Supertonic 3 (Supertone, OpenRAIL-M) run here with sherpa-onnx (Apache-2.0).
// GET /api/voice?v=girl|boy&t=<text>  ->  audio/wav. Same text = same audio, so the CDN caches it.
const path = require('path');
let tts = null;
function engine() {
  if (tts) return tts;
  const sherpa = require('sherpa-onnx-node');
  const M = path.join(__dirname, '_voice') + '/';
  tts = new sherpa.OfflineTts({
    model: { supertonic: { durationPredictor: M + 'duration_predictor.onnx', textEncoder: M + 'text_encoder.onnx', vectorEstimator: M + 'vector_estimator.onnx', vocoder: M + 'vocoder.onnx', ttsJson: M + 'tts.json', unicodeIndexer: M + 'unicode_indexer.bin', voiceStyle: M + 'voice.bin' }, numThreads: Number(process.env.VOICE_THREADS || 1), debug: false, provider: 'cpu' },
    maxNumSentences: 1,
  });
  return tts;
}
function wav(samples, rate) {
  // 44.1 kHz -> 22.05 kHz (average pairs) to halve the download; speech stays clear
  const n = Math.floor(samples.length / 2), b = Buffer.alloc(44 + n * 2), r = rate / 2;
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(r, 24); b.writeUInt32LE(r * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const v = Math.max(-1, Math.min(1, (samples[2 * i] + samples[2 * i + 1]) / 2)); b.writeInt16LE(v < 0 ? v * 32768 : v * 32767, 44 + i * 2); }
  return b;
}
module.exports = async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    let text = String(u.searchParams.get('t') || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 420);
    const sid = u.searchParams.get('v') === 'boy' ? 6 : 1;
    if (!text) { res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); return res.end('{"error":"no text"}'); }
    const a = engine().generate({ text, sid, speed: 1, generationConfig: { sid, speed: 1, numSteps: Math.max(3, Math.min(8, Number(u.searchParams.get('s')) || 8)), extra: { lang: 'en' } } });
    const out = wav(a.samples, a.sampleRate);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(out);
  } catch (e) {
    res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'voice failed' }));
  }
};
