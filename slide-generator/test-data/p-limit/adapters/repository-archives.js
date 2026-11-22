// Keep each asset URL literal: Turbopack can incorrectly fold a templated
// new URL into the first matching asset. Lookup happens after URL resolution.
// This module is server-side only; do not import it into the report UI.
export const historicalArchiveUrls = {
  '001-pr-1.json': new URL('../inputs/001-pr-1.json', import.meta.url),
  '002-pr-4.json': new URL('../inputs/002-pr-4.json', import.meta.url),
  '003-pr-7.json': new URL('../inputs/003-pr-7.json', import.meta.url),
  '004-pr-8.json': new URL('../inputs/004-pr-8.json', import.meta.url),
  '005-pr-9.json': new URL('../inputs/005-pr-9.json', import.meta.url),
  '006-pr-11.json': new URL('../inputs/006-pr-11.json', import.meta.url),
  '007-pr-12.json': new URL('../inputs/007-pr-12.json', import.meta.url),
  '008-pr-20.json': new URL('../inputs/008-pr-20.json', import.meta.url),
  '009-pr-28.json': new URL('../inputs/009-pr-28.json', import.meta.url),
  '010-pr-30.json': new URL('../inputs/010-pr-30.json', import.meta.url),
  '011-pr-35.json': new URL('../inputs/011-pr-35.json', import.meta.url),
  '012-pr-47.json': new URL('../inputs/012-pr-47.json', import.meta.url),
  '013-pr-50.json': new URL('../inputs/013-pr-50.json', import.meta.url),
  '014-pr-71.json': new URL('../inputs/014-pr-71.json', import.meta.url),
  '015-pr-83.json': new URL('../inputs/015-pr-83.json', import.meta.url),
  '016-pr-79.json': new URL('../inputs/016-pr-79.json', import.meta.url),
  '017-pr-88.json': new URL('../inputs/017-pr-88.json', import.meta.url),
  '018-pr-93.json': new URL('../inputs/018-pr-93.json', import.meta.url),
  '019-pr-98.json': new URL('../inputs/019-pr-98.json', import.meta.url),
  '020-pr-108.json': new URL('../inputs/020-pr-108.json', import.meta.url),
  '021-pr-109.json': new URL('../inputs/021-pr-109.json', import.meta.url),
};

