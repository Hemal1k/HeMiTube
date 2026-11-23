import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCodecConfig,
  codecConfigKey,
  codecsOf,
  framerateOf,
  isBlocked,
  isDecodingConfigBlocked,
  parseCodecConfig,
} from '../src/shared/codec-logic.js';
import { defaultSettings } from '../src/shared/settings.js';

test('codecsOf rozpozná kodeky v MIME', () => {
  assert.deepEqual(codecsOf('video/mp4; codecs="av01.0.08M.08"'), ['av1']);
  assert.deepEqual(codecsOf('video/webm; codecs="vp9"'), ['vp9']);
  assert.deepEqual(codecsOf('video/webm; codecs="vp09.00.51.08.01.01.01.01.00"'), ['vp9']);
  assert.deepEqual(codecsOf('video/mp4; codecs="avc1.640028, mp4a.40.2"'), ['h264', 'aac']);
  assert.deepEqual(codecsOf('audio/webm; codecs="opus"'), ['opus']);
  assert.deepEqual(codecsOf('video/webm; codecs=vp8'), ['vp8']);
  assert.deepEqual(codecsOf('video/mp4'), []);
  assert.deepEqual(codecsOf('video/mp4; codecs="hev1.1.6.L93"'), ['other']);
  assert.deepEqual(codecsOf(undefined), []);
});

test('framerateOf', () => {
  assert.equal(framerateOf('video/webm; codecs="vp9"; width=1920; height=1080; framerate=60'), 60);
  assert.equal(framerateOf('video/mp4; codecs="avc1.4d401f"'), null);
});

test('isBlocked: vypnuté kodeky a cap30', () => {
  const cfg = { blocked: ['av1', 'opus'], cap30: false };
  assert.equal(isBlocked('video/mp4; codecs="av01.0.08M.08"', cfg), true);
  assert.equal(isBlocked('video/webm; codecs="vp9"', cfg), false);
  assert.equal(isBlocked('audio/webm; codecs="opus"', cfg), true);
  assert.equal(isBlocked('video/mp4; codecs="avc1.640028"; framerate=60', cfg), false);
  const capped = { blocked: [], cap30: true };
  assert.equal(isBlocked('video/mp4; codecs="avc1.640028"; framerate=60', capped), true);
  assert.equal(isBlocked('video/mp4; codecs="avc1.640028"; framerate=30', capped), false);
  assert.equal(isBlocked('video/mp4; codecs="avc1.640028"', null), false);
});

test('isDecodingConfigBlocked (mediaCapabilities)', () => {
  const cfg = { blocked: ['vp9'], cap30: true };
  assert.equal(isDecodingConfigBlocked({ type: 'media-source', video: { contentType: 'video/webm; codecs="vp09.00.51.08"' } }, cfg), true);
  assert.equal(isDecodingConfigBlocked({ video: { contentType: 'video/mp4; codecs="avc1.640028"', framerate: 60 } }, cfg), true);
  assert.equal(isDecodingConfigBlocked({ video: { contentType: 'video/mp4; codecs="avc1.640028"', framerate: 30 } }, cfg), false);
  assert.equal(isDecodingConfigBlocked({ audio: { contentType: 'audio/mp4; codecs="mp4a.40.2"' } }, cfg), false);
  assert.equal(isDecodingConfigBlocked(null, cfg), false);
});


test('buildCodecConfig: modul vypnutý → nic se neblokuje', () => {
  const settings = defaultSettings();
  settings.codecs.disabled = ['av1'];
  assert.deepEqual(buildCodecConfig(settings), { v: 1, blocked: [], cap30: false });
});

test('buildCodecConfig: vypnuté video a audio kodeky + cap30', () => {
  const settings = defaultSettings();
  settings.codecs.enabled = true;
  settings.codecs.disabled = ['av1', 'vp9'];
  settings.codecs.audioDisabled = ['opus'];
  settings.quality.fps = 'cap30';
  assert.deepEqual(buildCodecConfig(settings), { v: 1, blocked: ['av1', 'vp9', 'opus'], cap30: true });
});

test('buildCodecConfig: vždy zůstane aspoň jeden video a audio kodek', () => {
  const settings = defaultSettings();
  settings.codecs.enabled = true;
  settings.codecs.order = ['h264', 'av1', 'vp9'];
  settings.codecs.disabled = ['av1', 'h264', 'vp9'];
  settings.codecs.audioDisabled = ['opus', 'aac'];
  const cfg = buildCodecConfig(settings);
  assert.ok(!cfg.blocked.includes('vp9'), 'poslední kodek v pořadí zůstane');
  assert.ok(!cfg.blocked.includes('aac'));
});

test('codecConfigKey a parseCodecConfig', () => {
  assert.equal(codecConfigKey(null), 'none');
  assert.equal(codecConfigKey({ blocked: [], cap30: false }), 'none');
  assert.equal(codecConfigKey({ blocked: ['vp9', 'av1'], cap30: false }), codecConfigKey({ blocked: ['av1', 'vp9'], cap30: false }));
  assert.deepEqual(parseCodecConfig('{"v":1,"blocked":["av1","x"],"cap30":true}'), { v: 1, blocked: ['av1'], cap30: true });
  assert.equal(parseCodecConfig('{"v":2,"blocked":[]}'), null);
  assert.equal(parseCodecConfig('nejson'), null);
  assert.equal(parseCodecConfig(null), null);
});

