/**
 * What to tell someone when a screen crashes, instead of the browser's bare
 * "Application error: a client-side exception has occurred". The cause is
 * read from the error and the connection, and said in plain words with what
 * to do. Pure, so scripts/check-app-error.ts can test it.
 */

export type AppErrorKind = 'offline' | 'new_version' | 'server' | 'unknown'

export interface AppErrorInfo {
  kind: AppErrorKind
  title: string
  message: string
  steps: string[]
  /** The main button: try the screen again, or load the newest version. */
  primary: 'retry' | 'reload_fresh'
  /** A short code to give support, so the office can find it in the logs. */
  code: string
}

type ErrorLike = { name?: string; message?: string; digest?: string } | null | undefined

const NEW_VERSION = /ChunkLoadError|Loading chunk|Loading CSS chunk|dynamically imported module|Unexpected token '<'|is not valid JavaScript|MIME type/i
const NETWORK = /Failed to fetch|NetworkError|Network request failed|Load failed|ERR_INTERNET_DISCONNECTED|The Internet connection appears to be offline/i

/** A short, stable code for the same error (its digest when the server gave one). */
export function errorCode(error: ErrorLike): string {
  if (error?.digest) return String(error.digest).slice(0, 10)
  const text = `${error?.name ?? ''}:${error?.message ?? ''}`
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `E${(h >>> 0).toString(36).toUpperCase().slice(0, 6)}`
}

export function diagnoseAppError(error: ErrorLike, online: boolean): AppErrorInfo {
  const text = `${error?.name ?? ''} ${error?.message ?? ''}`
  const code = errorCode(error)
  if (!online) {
    return {
      kind: 'offline',
      title: 'No internet connection',
      message: 'Xtend needs a connection to open this screen. Anything you saved without signal is safe on this phone.',
      steps: ['Turn on mobile data or Wi-Fi.', 'Check that you have data or airtime.', 'Tap Try again.'],
      primary: 'retry',
      code,
    }
  }
  if (NEW_VERSION.test(text)) {
    return {
      kind: 'new_version',
      title: 'Xtend has just been updated',
      message: 'Your phone still has the old version of this screen. Load the new one to carry on. Your saved work is kept.',
      steps: ['Tap Load the new version.', 'If this screen comes back, close Xtend fully and open it again.'],
      primary: 'reload_fresh',
      code,
    }
  }
  if (NETWORK.test(text)) {
    return {
      kind: 'offline',
      title: 'Xtend could not be reached',
      message: 'The connection dropped while this screen was opening. Anything you saved without signal is safe on this phone.',
      steps: ['Move to where the signal is better, or switch between mobile data and Wi-Fi.', 'Tap Try again.'],
      primary: 'retry',
      code,
    }
  }
  if (error?.digest) {
    return {
      kind: 'server',
      title: 'Xtend had a problem on its side',
      message: 'This is not something you did. It is usually fixed by trying again in a minute.',
      steps: ['Wait a minute, then tap Try again.', `If it keeps happening, tell your supervisor or support the code ${code}.`],
      primary: 'retry',
      code,
    }
  }
  return {
    kind: 'unknown',
    title: 'Something went wrong opening this screen',
    message: 'This is not something you did. Loading the newest version of Xtend usually fixes it. Your saved work is kept.',
    steps: [
      'Tap Load the new version.',
      'Still here? Close Xtend fully and open it again.',
      `If it keeps happening, tell your supervisor or support the code ${code}.`,
    ],
    primary: 'reload_fresh',
    code,
  }
}

/**
 * The script that runs before the app itself: if the phone holds pages from
 * before an update and a file of the app is missing, clear the stored copy
 * and reload once (at most every 30 s), so the white "Application error"
 * screen never shows for that. Kept small and dependency-free.
 */
export const EARLY_RECOVERY_SCRIPT = `(function(){
var V=/ChunkLoadError|Loading chunk|Loading CSS chunk|dynamically imported module/i;
function go(){try{var u=new URL(location.href);u.searchParams.set('_r',String(Date.now()));location.replace(u.toString())}catch(_){location.reload()}}
function h(e){
var t=e&&e.target,bad=false;
if(t&&t!==window&&(t.tagName==='SCRIPT'||t.tagName==='LINK')){bad=/\\/_next\\/static\\//.test(t.src||t.href||'')}
else{var r=e&&(e.reason||e.error);bad=V.test(String((r&&r.name)||'')+' '+String((r&&r.message)||(e&&e.message)||''))}
if(!bad)return;
try{var k='xt_early_reload',l=+sessionStorage.getItem(k)||0;if(Date.now()-l<30000)return;sessionStorage.setItem(k,String(Date.now()))}catch(_){}
if(window.caches&&caches.keys){caches.keys().then(function(ks){return Promise.all(ks.map(function(k){return caches.delete(k)}))}).then(go,go)}else{go()}
}
addEventListener('error',h,true);addEventListener('unhandledrejection',h);
})();`
