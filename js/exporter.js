/* XO LAB — export: records the live canvas + audio track with MediaRecorder */
(function () {
  'use strict';
  const XO = window.XO;
  // Explicit codec strings first so the label always matches what is actually written.
  // (A bare 'video/mp4' lets the browser choose — Chrome then writes VP9/Opus inside MP4.)
  const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg\//.test(navigator.userAgent);
  const CANDIDATES = [
    { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4', label: 'MP4 (H.264 / AAC)' },
    { mime: 'video/mp4;codecs=avc1,mp4a.40.2', ext: 'mp4', label: 'MP4 (H.264 / AAC)' },
    { mime: 'video/mp4;codecs=h264,aac', ext: 'mp4', label: 'MP4 (H.264 / AAC)' },
    { mime: 'video/mp4;codecs=avc1.42E01E,opus', ext: 'mp4', label: 'MP4 (H.264 / Opus)' },
    { mime: 'video/mp4;codecs=avc1,opus', ext: 'mp4', label: 'MP4 (H.264 / Opus)' },
    { mime: 'video/webm;codecs=vp9,opus', ext: 'webm', label: 'WebM (VP9 / Opus)' },
    { mime: 'video/webm;codecs=vp8,opus', ext: 'webm', label: 'WebM (VP8 / Opus)' },
    { mime: 'video/mp4', ext: 'mp4', label: 'MP4 (codecs chosen by browser)' },
    { mime: 'video/webm', ext: 'webm', label: 'WebM (codecs chosen by browser)' },
  ];
  if (isSafari) CANDIDATES.splice(3, 0, { mime: 'video/mp4', ext: 'mp4', label: 'MP4 (Safari default — normally H.264 / AAC)' });

  const E = (XO.exporter = { recorder: null, recording: false, format: null, startedAt: 0, length: 10, timer: 0, lastFile: null, lastUrl: '' });

  E.detect = function (canvas) {
    if (!canvas.captureStream) return { ok: false, reason: 'This browser can\'t capture the canvas (no captureStream).' };
    if (!window.MediaRecorder) return { ok: false, reason: 'This browser has no MediaRecorder, so video export is unavailable.' };
    const f = CANDIDATES.find((c) => { try { return MediaRecorder.isTypeSupported(c.mime); } catch (e) { return false; } });
    if (!f) return { ok: false, reason: 'This browser can\'t record any supported video format.' };
    E.format = f;
    return { ok: true, format: f };
  };

  function stamp() {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  /**
   * opts: { canvas, seconds, audioTracks, onProgress(frac, elapsed), onDone(result), onError(msg) }
   */
  E.start = function (opts) {
    if (E.recording) return;
    const det = E.detect(opts.canvas);
    if (!det.ok) { opts.onError(det.reason); return; }
    const fmt = det.format;
    const stream = opts.canvas.captureStream(30);
    const tracks = opts.audioTracks || [];
    tracks.forEach((t) => stream.addTrack(t));
    let rec;
    const bitrate = Math.round(Math.min(40e6, Math.max(4e6, opts.canvas.width * opts.canvas.height * 30 * 0.12)));
    try {
      rec = new MediaRecorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: bitrate, audioBitsPerSecond: 192000 });
    } catch (e) {
      try { rec = new MediaRecorder(stream, { mimeType: fmt.mime }); }
      catch (e2) { opts.onError('Recorder could not start: ' + (e2.message || e2)); return; }
    }
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onerror = (e) => { finish(); opts.onError('Recording failed: ' + ((e.error && e.error.message) || 'unknown error')); };
    rec.onstop = () => {
      const elapsed = (performance.now() - E.startedAt) / 1000;
      finish();
      const type = (rec.mimeType || fmt.mime).split(';')[0] || fmt.mime.split(';')[0];
      const ext = type.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(chunks, { type });
      if (!blob.size) { opts.onError('The recording came out empty. Try again with the screen kept open.'); return; }
      const name = 'xo-lab_' + stamp() + '_' + opts.canvas.width + 'x' + opts.canvas.height + '.' + ext;
      if (E.lastUrl) URL.revokeObjectURL(E.lastUrl);
      E.lastUrl = URL.createObjectURL(blob);
      E.lastFile = new File([blob], name, { type });
      opts.onDone({ url: E.lastUrl, name, size: blob.size, type, seconds: elapsed, hasAudio: tracks.length > 0, width: opts.canvas.width, height: opts.canvas.height, label: fmt.label, bitrate });
    };
    function finish() {
      E.recording = false;
      clearInterval(E.timer);
      stream.getVideoTracks().forEach((t) => t.stop()); // audio tracks belong to the audio engine; keep them alive
    }
    E.recorder = rec;
    E.recording = true;
    E.length = opts.seconds;
    E.startedAt = performance.now();
    rec.start(1000);
    E.timer = setInterval(() => {
      const el = (performance.now() - E.startedAt) / 1000;
      opts.onProgress(Math.min(1, el / E.length), el);
      if (el >= E.length) E.stop();
    }, 100);
  };

  E.stop = function () {
    if (E.recorder && E.recorder.state !== 'inactive') {
      try { E.recorder.requestData(); } catch (e) {}
      E.recorder.stop();
    }
  };

  E.canShareFile = function () {
    try { return !!(E.lastFile && navigator.canShare && navigator.canShare({ files: [E.lastFile] })); } catch (e) { return false; }
  };
  E.share = function () {
    if (!E.canShareFile()) return Promise.reject(new Error('Sharing files is not supported here.'));
    return navigator.share({ files: [E.lastFile], title: 'XO LAB export' });
  };
})();
