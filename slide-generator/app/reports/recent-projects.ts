// Browser-local convenience only; never stores States, drafts or credentials.
const key = 'report-workspace:recent-project-ids:v1';
const changed = 'report-workspace:recent-project-ids-changed';

export function readRecentProjects() {
  try { return window.localStorage.getItem(key) || '[]'; }
  catch { return '[]'; }
}

export function parseRecentProjects(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((id): id is string => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{1,62}$/.test(id)))].slice(0, 10)
      : [];
  } catch { return []; }
}

export function subscribeRecentProjects(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener(changed, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(changed, callback);
  };
}

export function rememberProject(id: string) {
  try {
    const ids = [id, ...parseRecentProjects(readRecentProjects()).filter(previous => previous !== id)].slice(0, 10);
    window.localStorage.setItem(key, JSON.stringify(ids));
    window.dispatchEvent(new Event(changed));
  } catch { /* Browser storage restrictions must not prevent loading a project. */ }
}
