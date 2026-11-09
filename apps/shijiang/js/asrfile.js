/* 上传录像的语音转写
 *
 * 浏览器自带的 SpeechRecognition 只能听麦克风，听不了「已经录好的文件」。
 * 所以上传路径要真的转写，只有一条路：把音轨抽出来，送到一个语音识别接口。
 *
 * 这里做四件事：
 *   1. 把解出来的 AudioBuffer 混成单声道、重采样到 16k、编码成 16-bit WAV；
 *   2. 按 25 秒切片——很多接口（SenseVoice 等）只回一整段文字，不返回分段时间，
 *      切片之后至少能以 25 秒为粒度给出时间码，报告里仍可点着跳；
 *   3. POST 到用户配置的接口（OpenAI 兼容 /v1/audio/transcriptions）；
 *   4. 把 text / segments 统一成 {start, end, text} 列表。
 *
 * 没配置接口时返回明确错误，绝不编造逐字稿。
 */
(function (window) {
  'use strict';

  var App = window.App;
  var CHUNK_SECONDS = 25;

  function cfg() {
    var d = (App.settings && App.settings.data) || {};
    return {
      endpoint: String(d.asrEndpoint || '').trim(),
      key: String(d.asrKey || '').trim(),
      model: String(d.asrModel || 'whisper-1').trim() || 'whisper-1'
    };
  }

  function enabled() {
    return !!cfg().endpoint;
  }

  function err(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  /* AudioBuffer → 16k 单声道 WAV（手工线性重采样，比 OfflineAudioContext 快很多） */
  function toWav(buffer, targetRate) {
    var rate = targetRate || 16000;
    var srcRate = buffer.sampleRate;
    var chs = buffer.numberOfChannels;
    var srcLen = buffer.length;
    var ch0 = buffer.getChannelData(0);
    var ch1 = chs > 1 ? buffer.getChannelData(1) : null;

    var ratio = srcRate / rate;
    var outLen = Math.max(1, Math.floor(srcLen / ratio));
    var ab = new ArrayBuffer(44 + outLen * 2);
    var view = new DataView(ab);

    function writeStr(off, s) {
      for (var i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
    }
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + outLen * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, outLen * 2, true);

    for (var i = 0; i < outLen; i++) {
      var pos = i * ratio;
      var i0 = Math.floor(pos);
      var frac = pos - i0;
      var a = ch0[i0] || 0;
      var b = ch0[i0 + 1] != null ? ch0[i0 + 1] : a;
      var v = a + (b - a) * frac;
      if (ch1) {
        var a2 = ch1[i0] || 0;
        var b2 = ch1[i0 + 1] != null ? ch1[i0 + 1] : a2;
        v = (v + (a2 + (b2 - a2) * frac)) / 2;
      }
      v = Math.max(-1, Math.min(1, v));
      view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7FFF, true);
    }
    return new Blob([ab], { type: 'audio/wav' });
  }

  /* 把 16k 单声道 WAV 切成若干片，每片都带完整 WAV 头 */
  function splitWav(blob, seconds) {
    return blob.arrayBuffer().then(function (buf) {
      var dv = new DataView(buf);
      function tag(off) {
        return String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3));
      }
      if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return [{ blob: blob, offset: 0 }];
      var rate = dv.getUint32(24, true);
      var chans = dv.getUint16(22, true);
      var bits = dv.getUint16(34, true);
      var bytesPerSec = Math.max(1, rate * chans * bits / 8);
      var pcm = new Uint8Array(buf, 44);
      var per = Math.floor(bytesPerSec * seconds);
      var pieces = [];
      for (var off = 0, idx = 0; off < pcm.length; off += per, idx++) {
        var end = Math.min(pcm.length, off + per);
        var len = end - off;
        var total = 44 + len;
        var ab = new ArrayBuffer(total);
        var v = new DataView(ab);
        var src = new Uint8Array(buf);
        new Uint8Array(ab).set(src.subarray(0, 44), 0);
        new Uint8Array(ab).set(pcm.subarray(off, end), 44);
        v.setUint32(4, 36 + len, true);
        v.setUint32(40, len, true);
        pieces.push({ blob: new Blob([ab], { type: 'audio/wav' }), offset: idx * seconds });
      }
      return pieces.length ? pieces : [{ blob: blob, offset: 0 }];
    });
  }

  function parseResponse(json, offset) {
    var segs = [];
    if (Array.isArray(json.segments) && json.segments.length) {
      json.segments.forEach(function (s) {
        var text = String(s.text || '').trim();
        if (!text) return;
        segs.push({
          start: (Number(s.start) || 0) + offset,
          end: (Number(s.end) || Number(s.start) || 0) + offset,
          text: text, correctedText: text, raw: text
        });
      });
    }
    if (!segs.length && json.text) {
      var t = String(json.text).trim();
      if (t) segs.push({ start: offset, end: offset, text: t, correctedText: t, raw: t });
    }
    return segs;
  }

  /* 本机打开（127.0.0.1 / localhost）时走同源转发：
     api.openai.com 这类接口不给浏览器跨域许可，直连会被 CORS 拦下；
     本机 server.js 有 /api/asr-proxy，代发一次就没有这个问题。
     公开网址上没有这个转发，就直连——能不能过看对方是否允许跨域。 */
  function useProxy() {
    try {
      var h = location.hostname;
      if (!(h === '127.0.0.1' || h === 'localhost' || h === '[::1]')) return false;
      /* 识别服务本身就在本机（比如 tools/asr-local.py）时，直接调，不用再转一层 */
      return !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/i.test(cfg().endpoint);
    } catch (e) { return false; }
  }

  function postChunk(wav, offset, c) {
    var fd = new FormData();
    fd.append('file', wav, 'audio.wav');
    fd.append('model', c.model);
    fd.append('language', 'zh');
    fd.append('response_format', 'verbose_json');

    var headers = {};
    if (c.key) headers.Authorization = 'Bearer ' + c.key;

    var url = c.endpoint;
    if (useProxy()) {
      headers['x-asr-endpoint'] = c.endpoint;
      url = '/api/asr-proxy';
    }

    var ctrl = null;
    try { ctrl = new AbortController(); } catch (e) { /* 老浏览器 */ }
    var opts = { method: 'POST', headers: headers, body: fd };
    if (ctrl) opts.signal = ctrl.signal;
    var timer = setTimeout(function () { if (ctrl) { try { ctrl.abort(); } catch (e) {} } }, 90000);

    return fetch(url, opts).then(function (res) {
      clearTimeout(timer);
      return res.text().then(function (t) {
        if (!res.ok) {
          var msg = '识别接口返回 ' + res.status;
          if (res.status === 401) msg = '语音识别 Key 无效或已过期（401）';
          else if (res.status === 404) msg = '识别接口地址不对（404）';
          else if (res.status === 402 || res.status === 403) msg = 'Key 余额不足或无权限（' + res.status + '）';
          else if (res.status === 429) msg = '识别请求太频繁被限流（429）';
          else if (res.status >= 500) msg = '识别服务异常（' + res.status + '）';
          var e = err('http', msg);
          e.detail = String(t || '').slice(0, 200);
          throw e;
        }
        var json = null;
        try { json = JSON.parse(t); } catch (e2) { throw err('bad-json', '识别接口返回的不是 JSON'); }
        return parseResponse(json, offset);
      });
    }).catch(function (e) {
      clearTimeout(timer);
      if (e && (e.code === 'http' || e.code === 'bad-json')) throw e;
      if (e && e.name === 'AbortError') throw err('timeout', '语音识别超时');
      throw err('network', '连不上语音识别接口（网络不可达，或接口地址写错、被跨域拦下）');
    });
  }

  function transcribe(blobOrBuffer, onProgress) {
    var c = cfg();
    if (!c.endpoint) return Promise.reject(err('no-endpoint', '没有配置语音识别接口'));

    var wavPromise = (blobOrBuffer instanceof Blob)
      ? Promise.resolve(blobOrBuffer)
      : Promise.resolve(toWav(blobOrBuffer, 16000));

    return wavPromise.then(function (wav) {
      return splitWav(wav, CHUNK_SECONDS);
    }).then(function (pieces) {
      var out = [];
      var done = 0;
      if (onProgress) onProgress(0, pieces.length);
      var chain = Promise.resolve();
      pieces.forEach(function (p, i) {
        chain = chain.then(function () {
          return postChunk(p.blob, p.offset, c).then(function (segs) {
            out = out.concat(segs);
            done++;
            if (onProgress) onProgress(done, pieces.length);
          });
        });
      });
      return chain.then(function () {
        out.sort(function (a, b) { return a.start - b.start; });
        if (!out.length) throw err('empty', '识别接口返回了空结果（可能整段没有语音）');
        return out;
      });
    });
  }

  App.AsrFile = {
    enabled: enabled,
    toWav: toWav,
    splitWav: splitWav,
    transcribe: transcribe,
    chunkSeconds: CHUNK_SECONDS
  };
})(window);
