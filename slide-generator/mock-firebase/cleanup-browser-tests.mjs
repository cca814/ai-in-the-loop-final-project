// Remove only the browser checks' timestamp-labelled datasets and their own drafts.
import { mockStore } from './store.js';
const store = mockStore();
const removed = await store.removeBrowserTestDatasets();
console.log(`Removed ${removed.length} browser test datasets.`);
console.log(`Retained ${(await store.listDatasets()).length} datasets; other drafts are unchanged.`);
