/**
 * Text follows the phone's text-size setting (2026-11-26, Apple's
 * "Support larger text sizes"). Sizes in Xtend are in rem, so scaling the
 * page's root size scales every text and the room around it together.
 *
 * iPhone and iPad (the app and Safari): the system body style
 * (-apple-system-body) is 17 px at the standard setting and grows or shrinks
 * with the setting, so the root size is 16 px times that over 17: unchanged
 * at the standard setting, up to twice as large; never smaller, so text
 * boxes stay at 16 px and the iPhone does not zoom in when one is tapped. Measured again whenever
 * Xtend comes back to the screen. A browser that does not know the style
 * (not WebKit) is left alone. Android is done in the app
 * (MainActivity: the WebView's text zoom follows the font scale), and other
 * browsers already follow their own setting.
 */

/** The page's root size for a measured iOS body size (px). */
export function rootSizeFor(bodyPx: number): number | null {
  if (!(bodyPx > 0)) return null
  const ratio = Math.min(2, Math.max(1, bodyPx / 17))
  return Math.round(16 * ratio * 100) / 100
}

/** Runs in <head> before the page paints; kept small and dependency-free. */
export const TEXT_SIZE_SCRIPT = `(function(){try{
var ua=navigator.userAgent||'';
if(!(/iPhone|iPad|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)))return;
if(!(window.CSS&&CSS.supports&&CSS.supports('font','-apple-system-body')))return;
function apply(){var p=document.createElement('span');p.style.font='-apple-system-body';p.style.position='absolute';p.style.visibility='hidden';p.textContent='x';document.documentElement.appendChild(p);
var px=parseFloat(getComputedStyle(p).fontSize);p.parentNode.removeChild(p);
if(!(px>0))return;var r=Math.min(2,Math.max(1,px/17));document.documentElement.style.fontSize=(Math.round(1600*r)/100)+'px';}
apply();document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')apply()});
}catch(e){}})();`
