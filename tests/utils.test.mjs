import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCount, getPageInfo, getVideoId } from '../src/shared/utils.js';
import { isCacheFresh, parseVotes } from '../src/shared/ryd.js';

const nbsp = (text) => text.replaceAll(String.fromCharCode(0xa0), ' ');

test('formatCount: čeština a angličtina', () => {
  assert.equal(nbsp(formatCount(1234, 'cs')), '1,2 tis.');
  assert.equal(nbsp(formatCount(254321, 'cs-CZ')), '254 tis.');
  assert.equal(nbsp(formatCount(1_500_000, 'cs')), '1,5 mil.');
  assert.equal(formatCount(1234, 'en'), '1.2K');
  assert.equal(formatCount(522100, 'en-US'), '522K');
  assert.equal(formatCount(999, 'en'), '999');
  assert.equal(formatCount(0, 'cs'), '0');
});

test('formatCount: neplatná čísla a jazyk', () => {
  assert.equal(formatCount(NaN, 'cs'), '–');
  assert.equal(formatCount(-5, 'cs'), '–');
  assert.equal(formatCount(undefined, 'cs'), '–');
  assert.doesNotThrow(() => formatCount(1234, 'neplatny jazyk!!'));
});

test('getVideoId', () => {
  assert.equal(getVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'), 'dQw4w9WgXcQ');
  assert.equal(getVideoId('https://www.youtube.com/shorts/abcdefghijk'), 'abcdefghijk');
  assert.equal(getVideoId('https://www.youtube.com/live/abcdefghijk?si=x'), 'abcdefghijk');
  assert.equal(getVideoId('https://www.youtube-nocookie.com/embed/abcdefghijk?rel=0'), 'abcdefghijk');
  assert.equal(getVideoId('https://www.youtube.com/watch?v=kratke'), null);
  assert.equal(getVideoId('https://www.youtube.com/'), null);
  assert.equal(getVideoId('nesmysl'), null);
});

test('getPageInfo', () => {
  assert.deepEqual(getPageInfo('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), { pageType: 'watch', videoId: 'dQw4w9WgXcQ' });
  assert.deepEqual(getPageInfo('https://www.youtube.com/live/abcdefghijk'), { pageType: 'watch', videoId: 'abcdefghijk' });
  assert.deepEqual(getPageInfo('https://www.youtube.com/shorts/abcdefghijk'), { pageType: 'shorts', videoId: 'abcdefghijk' });
  assert.deepEqual(getPageInfo('https://www.youtube.com/embed/abcdefghijk'), { pageType: 'embed', videoId: 'abcdefghijk' });
  assert.deepEqual(getPageInfo('https://www.youtube.com/feed/subscriptions'), { pageType: 'other', videoId: null });
  assert.deepEqual(getPageInfo('https://www.youtube.com/shorts'), { pageType: 'other', videoId: null });
});

test('parseVotes: skutečná odpověď API (ověřeno 2026-11)', () => {
  const json = {
    id: 'dQw4w9WgXcQ',
    dateCreated: '2022-04-09T22:01:38.222268Z',
    likes: 19512169,
    rawDislikes: 6730,
    rawLikes: 130844,
    dislikes: 522100,
    rating: 4.895758612405574,
    viewCount: 1838795583,
    deleted: false,
  };
  assert.deepEqual(parseVotes(json), { likes: 19512169, dislikes: 522100 });
  assert.equal(parseVotes({ likes: 5 }), null);
  assert.equal(parseVotes({ dislikes: -1 }), null);
  assert.equal(parseVotes({ dislikes: '5' }), null);
  assert.deepEqual(parseVotes({ dislikes: 3, likes: 'x' }), { likes: 0, dislikes: 3 });
  assert.equal(parseVotes(null), null);
});

test('isCacheFresh: TTL 10 minut', () => {
  const now = 1_000_000_000;
  assert.equal(isCacheFresh({ t: now - 5 * 60_000, d: {} }, now), true);
  assert.equal(isCacheFresh({ t: now - 11 * 60_000, d: {} }, now), false);
  assert.equal(isCacheFresh({ t: now + 1000, d: {} }, now), false);
  assert.equal(isCacheFresh(undefined, now), false);
});

test('snímek a smyčka: název souboru a formát času', async () => {
  globalThis.chrome ??= { i18n: { getMessage: (key) => key } };
  const { screenshotFileName } = await import('../src/content/screenshot.js');
  const { formatTime } = await import('../src/content/loop.js');
  assert.equal(screenshotFileName('Rick Astley: Never <Gonna> Give/You Up? - YouTube', 83.4), 'Rick Astley Never Gonna Give You Up – 1-23.png');
  assert.equal(screenshotFileName('', 3725), 'YouTube – 1-02-05.png');
  assert.equal(screenshotFileName('A\u0007B', 0), 'A B – 0-00.png');
  assert.equal(formatTime(83.9), '1:23');
  assert.equal(formatTime(3725), '1:02:05');
  assert.equal(formatTime(-5), '0:00');
});

test('getPageInfo: živá stránka kanálu bez ID v adrese', () => {
  assert.deepEqual(getPageInfo('https://www.youtube.com/@LofiGirl/live', 'jfKfPfyJRdk'), { pageType: 'watch', videoId: 'jfKfPfyJRdk' });
  assert.deepEqual(getPageInfo('https://www.youtube.com/@LofiGirl/live'), { pageType: 'other', videoId: null });
  assert.deepEqual(getPageInfo('https://www.youtube.com/channel/UCSJ4gkVC6NrvII8umztf0Ow/live', 'jfKfPfyJRdk').pageType, 'watch');
  assert.deepEqual(getPageInfo('https://www.youtube.com/@LofiGirl/videos', 'jfKfPfyJRdk'), { pageType: 'other', videoId: null });
});
