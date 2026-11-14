// StudyStarx free voice: Supertonic 3 (Supertone, OpenRAIL-M) running on the phone
// through sherpa-onnx's WebAssembly text to speech (Apache-2.0, built by @3sln/donki-lle, MIT).
// Files come from the jsDelivr npm CDN (free) and are kept in this browser's cache after the first download.
const CDN = 'https://cdn.jsdelivr.net/npm/';
const RT = CDN + '@3sln/donki-lle@0.2.2/vendor/sherpa/runtime.js';
const API = CDN + '@3sln/donki-lle@0.2.2/vendor/sherpa/api.js';
const FILES = {"duration_predictor.onnx": ["@3sln/donki-lle-voice-multi@0.1.1/c/000.js"], "text_encoder.onnx": ["@3sln/donki-lle-voice-multi@0.1.1/c/001.js", "@3sln/donki-lle-voice-multi@0.1.1/c/002.js", "@3sln/donki-lle-voice-multi@0.1.1/c/003.js", "@3sln/donki-lle-voice-multi@0.1.1/c/004.js"], "vector_estimator.onnx": ["@3sln/donki-lle-voice-multi@0.1.1/c/005.js", "@3sln/donki-lle-voice-multi@0.1.1/c/006.js", "@3sln/donki-lle-voice-multi@0.1.1/c/007.js", "@3sln/donki-lle-voice-multi-2@0.1.1/c/000.js", "@3sln/donki-lle-voice-multi-2@0.1.1/c/001.js", "@3sln/donki-lle-voice-multi-2@0.1.1/c/002.js", "@3sln/donki-lle-voice-multi-2@0.1.1/c/003.js", "@3sln/donki-lle-voice-multi-2@0.1.1/c/004.js", "@3sln/donki-lle-voice-multi-2@0.1.1/c/005.js"], "vocoder.onnx": ["@3sln/donki-lle-voice-multi-2@0.1.1/c/006.js", "@3sln/donki-lle-voice-multi-2@0.1.1/c/007.js", "@3sln/donki-lle-voice-multi-3@0.1.1/c/000.js"], "tts.json": ["@3sln/donki-lle-voice-multi-3@0.1.1/c/001.js"], "unicode_indexer.bin": ["@3sln/donki-lle-voice-multi-3@0.1.1/c/002.js"], "voice.bin": ["@3sln/donki-lle-voice-multi-3@0.1.1/c/003.js"]};
const CACHE = 'sf-voice-v1';
// rough download sizes (bytes) so the progress bar moves smoothly
const PART_MB = 26;
let ready = null, tts = null;

async function getPart(url) {
  let c = null;
  try { c = await caches.open(CACHE); const hit = await c.match(url); if (hit) return await hit.text(); } catch (e) {}
  const r = await fetch(url);
  if (!r.ok) throw new Error('download failed ' + r.status);
  const t = await r.text();
  try { if (c) await c.put(url, new Response(t, { headers: { 'content-type': 'text/javascript' } })); } catch (e) {}
  return t;
}
async function partBytes(url) {
  const t = await getPart(url);
  const a = t.indexOf('"'), b = t.lastIndexOf('"');
  const r = await fetch('data:application/octet-stream;base64,' + t.slice(a + 1, b));
  return new Uint8Array(await r.arrayBuffer());
}
async function cachedAlready() {
  try { const c = await caches.open(CACHE); const all = Object.values(FILES).flat(); for (const p of all) { if (!(await c.match(CDN + p))) return false } return true } catch (e) { return false }
}

function load() {
  if (ready) return ready;
  ready = (async () => {
    const [rt, api] = await Promise.all([import(RT), import(API)]);
    const Module = await rt.default({ print: () => {}, printErr: () => {} });
    Module.FS.mkdirTree('/v');
    const parts = Object.values(FILES).flat().length; let done = 0;
    for (const [name, list] of Object.entries(FILES)) {
      const bufs = [];
      for (const p of list) { bufs.push(await partBytes(CDN + p)); done++; postMessage({ type: 'progress', p: done / parts }); }
      let n = 0; bufs.forEach(b => n += b.length); const all = new Uint8Array(n); let o = 0; bufs.forEach(b => { all.set(b, o); o += b.length });
      Module.FS.writeFile('/v/' + name, all);
    }
    const at = n => '/v/' + n;
    tts = api.createOfflineTts(Module, {
      offlineTtsModelConfig: { numThreads: 1, debug: 0, provider: 'cpu', offlineTtsSupertonicModelConfig: { durationPredictor: at('duration_predictor.onnx'), textEncoder: at('text_encoder.onnx'), vectorEstimator: at('vector_estimator.onnx'), vocoder: at('vocoder.onnx'), ttsJson: at('tts.json'), unicodeIndexer: at('unicode_indexer.bin'), voiceStyle: at('voice.bin') } },
      ruleFsts: '', ruleFars: '', maxNumSentences: 1,
    });
    for (const n of Object.keys(FILES)) { try { Module.FS.unlink(at(n)) } catch (e) {} }
    return true;
  })();
  ready.catch(() => { ready = null });
  return ready;
}

onmessage = async (e) => {
  const m = e.data || {};
  try {
    if (m.type === 'check') { postMessage({ type: 'cached', id: m.id, v: await cachedAlready() }); return }
    if (m.type === 'load') { await load(); postMessage({ type: 'ready', id: m.id }); return }
    if (m.type === 'say') {
      await load();
      const a = tts.generateWithConfig(m.text, { sid: m.sid || 0, speed: m.speed || 1, numSteps: m.steps || 5, extra: { lang: 'en' } });
      const s = a.samples instanceof Float32Array ? a.samples : Float32Array.from(a.samples);
      postMessage({ type: 'audio', id: m.id, samples: s, rate: a.sampleRate }, [s.buffer]);
    }
  } catch (err) { postMessage({ type: 'error', id: m.id, error: String(err && err.message || err) }) }
};
