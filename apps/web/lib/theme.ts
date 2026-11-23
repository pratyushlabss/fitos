// Visual preferences stored per device: theme, dither and 3D. Applied as attributes on <html>.
export type ThemePref = "system" | "dark" | "light";
const KEY = "fitos-ui";

export type UiPrefs = { theme: ThemePref; dither: boolean; threeD: boolean; motion: boolean };
const DEFAULTS: UiPrefs = { theme: "system", dither: true, threeD: true, motion: false };

export function readPrefs(): UiPrefs {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<UiPrefs>) };
  } catch {
    return DEFAULTS;
  }
}

export function applyPrefs(prefs: UiPrefs) {
  const root = document.documentElement;
  if (prefs.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", prefs.theme);
  root.toggleAttribute("data-no-dither", !prefs.dither);
  root.toggleAttribute("data-no-3d", !prefs.threeD);
}

export function savePrefs(patch: Partial<UiPrefs>): UiPrefs {
  const next = { ...readPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  applyPrefs(next);
  window.dispatchEvent(new Event("fitos-ui"));
  return next;
}

// Inline, before paint, so there is no flash of the wrong theme.
export const PREFS_SCRIPT = `try{var p=JSON.parse(localStorage.getItem("${KEY}")||"{}"),r=document.documentElement;if(p.theme==="dark"||p.theme==="light")r.setAttribute("data-theme",p.theme);if(p.dither===false)r.setAttribute("data-no-dither","");if(p.threeD===false)r.setAttribute("data-no-3d","")}catch(e){}`;
