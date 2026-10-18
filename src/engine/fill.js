// Compatibility exports for control primitives and verified adapters.
import { setValue as nativeSet, fire as nativeFire, realClick as nativeClick, isFocused as nativeFocus, commit as nativeCommit, key as nativeKey, optionScore as nativeScore, matchOption as nativeMatch, fillCombobox as nativeCombo, fillFile as nativeFile, fillSync as nativeSync, fillAsync as nativeAsync } from "./controls/native.js";
export const setValue = nativeSet;
export const fire = nativeFire;
export const realClick = nativeClick;
export const isFocused = nativeFocus;
export const commit = nativeCommit;
export const key = nativeKey;
export const optionScore = nativeScore;
export const matchOption = nativeMatch;
export const fillCombobox = nativeCombo;
export const fillFile = nativeFile;
export const fillSync = nativeSync;
export const fillAsync = nativeAsync;
