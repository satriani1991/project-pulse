/**
 * Minimal gitignore-style matcher.
 *  - "name/"        matches a directory with that name at any depth
 *  - "a/b/"         matches the directory a/b relative to project root
 *  - "*.log"        matches file basenames anywhere
 *  - "src/*.gen.js" matches relative paths
 *  - "!pattern"     is not supported (kept simple and predictable)
 */
function globToRe(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i++; }
      } else re += '[^/]*';
    }
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$', 'i');
}

export { globToRe };
export interface IgnoreMatcher { dir(rel: string, name: string): boolean; file(rel: string, name: string): boolean }

export function compileIgnore(patterns: string[]): IgnoreMatcher {
  const dirName: RegExp[] = [], dirPath: RegExp[] = [], fileName: RegExp[] = [], filePath: RegExp[] = [];
  for (let raw of patterns) {
    raw = raw.trim().replace(/\\/g, '/');
    if (!raw || raw.startsWith('#') || raw.startsWith('!')) continue;
    const anchored = raw.startsWith('/');
    if (anchored) raw = raw.slice(1);
    if (raw.endsWith('/')) {
      const body = raw.slice(0, -1);
      if (body.includes('/') || anchored) dirPath.push(globToRe(body)); else dirName.push(globToRe(body));
    } else if (raw.includes('/') || anchored) {
      filePath.push(globToRe(raw));
      dirPath.push(globToRe(raw)); // allow "assets/raw" to exclude a directory too
    } else {
      fileName.push(globToRe(raw));
      dirName.push(globToRe(raw));
    }
  }
  return {
    dir: (rel, name) => dirName.some((r) => r.test(name)) || dirPath.some((r) => r.test(rel)),
    file: (rel, name) => fileName.some((r) => r.test(name)) || filePath.some((r) => r.test(rel)),
  };
}
